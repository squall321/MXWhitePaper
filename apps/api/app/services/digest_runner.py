"""Subscription dispatcher + digest runner (Cycle 0018).

Two halves:

  1. `dispatch_subscription_event` — called from the document/comment/approval
     write paths next to `fire_webhook`. Looks up subscriptions for the doc
     whose `events` array contains the kind, then either:

       - inserts a `notifications` row directly (kind=`subscription_event`)
         for `digest_cadence='instant'`, or
       - inserts a `pending_digest_items` row for daily / weekly cadences.

  2. `digest_ticker` — long-running asyncio task spawned from app.main lifespan
     (mirrors `backup_runner.py`). Every 60s it scans `pending_digest_items`
     grouped by user, and for each user whose subscription's `last_digest_at`
     is older than the cutoff (1 day for daily, 7 days for weekly), it bundles
     the buffered items into a single `subscription_digest` notification, then
     deletes those items and updates `last_digest_at`.

Like `webhook_dispatcher.dispatch`, this never raises into the caller — its
own session is opened, errors are logged, and a failure here must never undo
the originating mutation.

Test isolation: `MXWP_SKIP_SUBSCRIPTIONS=1` → dispatch is a no-op (so unrelated
test_documents / test_comments suites don't accidentally seed subscription
rows). The digest_runner ticker gates on `settings.subscription_digest_enabled`
which defaults to False so production opts-in.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.db import session_factory, session_scope
from app.services import notification_prefs as prefs_svc

logger = logging.getLogger(__name__)


TICK_INTERVAL_SECONDS = 60

# How long after `last_digest_at` (or subscription creation) we wait before
# the next digest fires for a given cadence.
CADENCE_CUTOFF: dict[str, timedelta] = {
    "daily": timedelta(days=1),
    "weekly": timedelta(days=7),
}


# ── Dispatch (called from write paths) ───────────────────────────────────


async def dispatch_subscription_event(
    event_kind: str,
    *,
    document_id: str,
    payload: dict[str, Any],
    actor_user_id: str | None = None,
) -> int:
    """Fan-out a doc event to every subscriber that asked for `event_kind`.

    Returns the number of rows inserted across notifications + pending_digest
    (mostly for tests). The actor is excluded so users don't get notified of
    their own edits.
    """
    if os.environ.get("MXWP_SKIP_SUBSCRIPTIONS") == "1":
        return 0
    try:
        sf = session_factory()
        async with sf() as s:
            return await _dispatch_inner(
                s,
                event_kind=event_kind,
                document_id=document_id,
                payload=payload,
                actor_user_id=actor_user_id,
            )
    except Exception as e:
        logger.warning("subscription dispatch (%s) skipped: %s", event_kind, e)
        return 0


async def _dispatch_inner(
    s: AsyncSession,
    *,
    event_kind: str,
    document_id: str,
    payload: dict[str, Any],
    actor_user_id: str | None,
) -> int:
    rows = (await s.execute(
        text(
            """
            SELECT id, user_id, digest_cadence
            FROM subscriptions
            WHERE document_id = CAST(:d AS uuid)
              AND events @> CAST(:k AS jsonb)
            """
        ),
        {"d": document_id, "k": json.dumps([event_kind])},
    )).all()
    inserted = 0
    payload_json = json.dumps({**payload, "event": event_kind, "kind": event_kind})
    for r in rows:
        sub_id = str(r[0])
        user_id = str(r[1])
        cadence = r[2]
        if actor_user_id and user_id == actor_user_id:
            continue
        if cadence == "instant":
            # Honour subscription_event in-app preference. Daily/weekly buffers
            # always queue (so the eventual digest can still fire even if the
            # user only wants the bundled view).
            if not await prefs_svc.is_channel_enabled(
                s,
                user_id=user_id,
                kind="subscription_event",
                channel="in_app",
            ):
                continue
            await s.execute(
                text(
                    """
                    INSERT INTO notifications (user_id, kind, payload)
                    VALUES (CAST(:u AS uuid), 'subscription_event',
                            CAST(:p AS jsonb))
                    """
                ),
                {"u": user_id, "p": payload_json},
            )
        else:
            await s.execute(
                text(
                    """
                    INSERT INTO pending_digest_items
                      (subscription_id, user_id, document_id,
                       event_kind, payload)
                    VALUES (CAST(:sid AS uuid), CAST(:u AS uuid),
                            CAST(:d AS uuid), :k, CAST(:p AS jsonb))
                    """
                ),
                {
                    "sid": sub_id,
                    "u": user_id,
                    "d": document_id,
                    "k": event_kind,
                    "p": payload_json,
                },
            )
        inserted += 1
    if inserted:
        await s.commit()
    return inserted


# ── Digest runner ────────────────────────────────────────────────────────


async def emit_digests_for_user(
    s: AsyncSession,
    *,
    user_id: str,
    now: datetime | None = None,
) -> int:
    """Bundle all matured pending items for one user into a single digest
    notification. Returns the bundled item count (0 if nothing matured).

    A subscription "matures" when `last_digest_at` is older than its cadence
    cutoff — or NULL (never digested before). We bundle items per subscription
    (so daily and weekly subs that happened to share a user don't mix).
    """
    cur = now or datetime.now(UTC)
    # Pull subs that have at least one buffered item + are due to fire.
    rows = (await s.execute(
        text(
            """
            SELECT s.id, s.digest_cadence, s.last_digest_at
            FROM subscriptions s
            WHERE s.user_id = CAST(:u AS uuid)
              AND s.digest_cadence IN ('daily', 'weekly')
              AND EXISTS (
                SELECT 1 FROM pending_digest_items p
                WHERE p.subscription_id = s.id
              )
            """
        ),
        {"u": user_id},
    )).all()

    bundled_total = 0
    for r in rows:
        sub_id = str(r[0])
        cadence = r[1]
        last = r[2]
        cutoff = CADENCE_CUTOFF.get(cadence)
        if cutoff is None:
            continue
        if last is not None and (cur - last) < cutoff:
            continue

        items_rows = (await s.execute(
            text(
                """
                SELECT document_id, event_kind, payload, queued_at
                FROM pending_digest_items
                WHERE subscription_id = CAST(:sid AS uuid)
                ORDER BY queued_at ASC
                """
            ),
            {"sid": sub_id},
        )).all()
        if not items_rows:
            continue

        items = []
        for ir in items_rows:
            p = ir[2]
            if isinstance(p, str):
                try:
                    p = json.loads(p)
                except json.JSONDecodeError:
                    p = {}
            items.append({
                "document_id": str(ir[0]),
                "event_kind": ir[1],
                "payload": p if isinstance(p, dict) else {},
                "queued_at": ir[3].isoformat() if ir[3] else None,
            })

        since = items_rows[0][3].isoformat() if items_rows[0][3] else None
        until = items_rows[-1][3].isoformat() if items_rows[-1][3] else None
        digest_payload = {
            "subscription_id": sub_id,
            "cadence": cadence,
            "since": since,
            "until": until,
            "item_count": len(items),
            "items": items,
        }
        # Honour the recipient's subscription_digest in-app preference. Even
        # when in-app is off we still drain the buffer + advance last_digest_at
        # so the cadence pacing stays consistent and the buffer doesn't grow
        # unboundedly. Email is gated separately below.
        digest_in_app = await prefs_svc.is_channel_enabled(
            s,
            user_id=user_id,
            kind="subscription_digest",
            channel="in_app",
        )
        if digest_in_app:
            await s.execute(
                text(
                    """
                    INSERT INTO notifications (user_id, kind, payload)
                    VALUES (CAST(:u AS uuid), 'subscription_digest',
                            CAST(:p AS jsonb))
                    """
                ),
                {"u": user_id, "p": json.dumps(digest_payload)},
            )
        await s.execute(
            text(
                "DELETE FROM pending_digest_items "
                "WHERE subscription_id = CAST(:sid AS uuid)"
            ),
            {"sid": sub_id},
        )
        await s.execute(
            text(
                "UPDATE subscriptions SET last_digest_at = :now "
                "WHERE id = CAST(:sid AS uuid)"
            ),
            {"now": cur, "sid": sub_id},
        )
        # Best-effort email — never break the digest tx if SMTP / template fails.
        digest_email_enabled = await prefs_svc.is_channel_enabled(
            s,
            user_id=user_id,
            kind="subscription_digest",
            channel="email",
        )
        if digest_email_enabled:
            try:
                await _maybe_send_digest_email(s, user_id=user_id, items=items)
            except Exception:
                logger.exception("digest email skipped for user %s", user_id)
        bundled_total += len(items)

    if bundled_total:
        await s.commit()
    return bundled_total


async def _maybe_send_digest_email(
    s: AsyncSession, *, user_id: str, items: list[dict[str, Any]]
) -> None:
    """Look up the user's email/name and dispatch a digest email.

    Silent no-op if the user row is missing or has no email. Imported lazily so
    `digest_runner` keeps no top-level dependency on the email service (lets
    test_subscriptions monkeypatch via app.services.email cleanly)."""
    row = (await s.execute(
        text("SELECT email, name FROM users WHERE id = CAST(:u AS uuid)"),
        {"u": user_id},
    )).first()
    if not row or not row[0]:
        return
    from app.services.email import send_digest_email

    await send_digest_email(
        user_email=row[0], user_name=row[1] or "", items=items
    )


async def tick_once() -> int:
    """One scheduler pass — collect distinct users with buffered items, then
    call `emit_digests_for_user` for each. Returns the total number of items
    bundled (across all users) for visibility in tests."""
    settings = get_settings()
    if not getattr(settings, "subscription_digest_enabled", False):
        return 0
    total = 0
    async with session_scope() as s:
        users = (await s.execute(
            text(
                "SELECT DISTINCT user_id FROM pending_digest_items"
            )
        )).all()
        user_ids = [str(u[0]) for u in users]
    for uid in user_ids:
        try:
            async with session_scope() as s2:
                total += await emit_digests_for_user(s2, user_id=uid)
        except Exception:
            logger.exception("digest emit failed for user %s", uid)
    return total


async def digest_ticker() -> None:
    """Long-running asyncio task. Spawned from app.main lifespan."""
    logger.info("digest_ticker started")
    while True:
        try:
            await tick_once()
        except Exception:
            logger.exception("digest tick failed")
        from app.services.ticker_state import report_tick as _rt; _rt("digest", next_due_at=datetime.now(UTC) + timedelta(seconds=TICK_INTERVAL_SECONDS))
        await asyncio.sleep(TICK_INTERVAL_SECONDS)
