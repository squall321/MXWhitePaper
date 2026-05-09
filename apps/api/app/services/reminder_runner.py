"""Reminder runner — fires due `reminders` rows (Cycle 0028).

Asyncio in-process ticker (every 60s, mirrors `digest_runner`/`backup_runner`).
On each tick:

  1. SELECT reminders WHERE fired_at IS NULL AND remind_at <= NOW()
  2. For each row:
       - honour `notification_prefs.reminder.in_app` (defaults to True for
         unknown kinds — see `notification_prefs.is_channel_enabled`)
       - INSERT a `notifications` row of kind 'reminder' (payload includes the
         doc slug, title, and the user's optional message)
       - UPDATE fired_at = NOW() so the row never fires twice
       - if the user opts in to email, send a best-effort email

The dispatcher never raises into the caller — its own session is opened, errors
are logged + swallowed, and a single bad row must not stall the ticker. Same
single-replica caveat as the other in-process runners.
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.db import session_scope
from app.services import notification_prefs as prefs_svc

logger = logging.getLogger(__name__)


TICK_INTERVAL_SECONDS = 60


async def _fire_one(
    s: AsyncSession,
    *,
    reminder_id: str,
    user_id: str,
    document_id: str,
    message: str | None,
    slug: str,
    title: str | None,
) -> int:
    """Insert the notification + email best-effort + stamp fired_at.

    Returns 1 if the in-app notification was inserted, else 0. Always stamps
    fired_at so a user with in-app=off doesn't get the same reminder retried
    forever (mirrors the digest runner's "drain even if recipient muted" rule).
    """
    payload = {
        "reminder_id": reminder_id,
        "document_id": document_id,
        "slug": slug,
        "title": title,
        "message": message,
    }
    inserted = 0
    in_app = await prefs_svc.is_channel_enabled(
        s, user_id=user_id, kind="reminder", channel="in_app"
    )
    if in_app:
        await s.execute(
            text(
                """
                INSERT INTO notifications (user_id, kind, payload)
                VALUES (CAST(:u AS uuid), 'reminder', CAST(:p AS jsonb))
                """
            ),
            {"u": user_id, "p": json.dumps(payload)},
        )
        inserted = 1
    await s.execute(
        text(
            "UPDATE reminders SET fired_at = NOW() "
            "WHERE id = CAST(:id AS uuid)"
        ),
        {"id": reminder_id},
    )
    email_enabled = await prefs_svc.is_channel_enabled(
        s, user_id=user_id, kind="reminder", channel="email"
    )
    if email_enabled:
        try:
            await _maybe_send_reminder_email(
                s, user_id=user_id, slug=slug, title=title, message=message
            )
        except Exception:  # noqa: BLE001
            logger.exception("reminder email skipped for user %s", user_id)
    return inserted


async def _maybe_send_reminder_email(
    s: AsyncSession,
    *,
    user_id: str,
    slug: str,
    title: str | None,
    message: str | None,
) -> None:
    """Best-effort outbound email. Silent no-op when email service is muted
    or the user row has no email."""
    row = (await s.execute(
        text("SELECT email, name FROM users WHERE id = CAST(:u AS uuid)"),
        {"u": user_id},
    )).first()
    if not row or not row[0]:
        return
    from app.services.email import send_email

    subject = f"[MX White Paper] 리마인더 — {title or slug}"
    body_lines = [
        f"안녕하세요 {row[1] or ''},".strip(),
        "",
        f"문서 '{title or slug}' 에 대해 예약하신 리마인더입니다.",
    ]
    if message:
        body_lines += ["", "메모:", message]
    body_lines += [
        "",
        f"문서 바로가기: /docs/{slug}",
    ]
    await send_email(
        to=row[0], subject=subject, body_text="\n".join(body_lines)
    )


async def tick_once() -> int:
    """One scheduler pass. Returns the number of reminders fan-outed (mostly
    for tests). Honours `settings.reminder_runner_enabled` (default True so
    production opts-out only if explicitly disabled)."""
    settings = get_settings()
    if not getattr(settings, "reminder_runner_enabled", True):
        return 0

    fired = 0
    async with session_scope() as s:
        rows = (await s.execute(
            text(
                """
                SELECT r.id, r.user_id, r.document_id, r.message,
                       d.slug, d.title
                FROM reminders r
                JOIN documents d ON d.id = r.document_id
                WHERE r.fired_at IS NULL AND r.remind_at <= NOW()
                ORDER BY r.remind_at ASC
                """
            )
        )).all()
        for row in rows:
            try:
                fired += await _fire_one(
                    s,
                    reminder_id=str(row[0]),
                    user_id=str(row[1]),
                    document_id=str(row[2]),
                    message=row[3],
                    slug=row[4],
                    title=row[5],
                )
            except Exception:  # noqa: BLE001
                logger.exception(
                    "reminder fire failed (id=%s)", row[0]
                )
                # Don't let one bad row block the rest. The DB transaction is
                # session-scoped — `_fire_one` flushed + the session will
                # commit at the end of the with-block.
                continue
        await s.commit()
    return fired


async def reminder_ticker() -> None:
    """Long-running asyncio task. Spawned from app.main lifespan."""
    logger.info("reminder_ticker started")
    while True:
        try:
            await tick_once()
        except Exception:  # noqa: BLE001
            logger.exception("reminder tick failed")
        from datetime import datetime as _dt, timezone as _tz, timedelta as _td; from app.services.ticker_state import report_tick as _rt; _rt("reminder", next_due_at=_dt.now(_tz.utc) + _td(seconds=TICK_INTERVAL_SECONDS))
        await asyncio.sleep(TICK_INTERVAL_SECONDS)
