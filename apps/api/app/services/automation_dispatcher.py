"""Automation dispatcher (Cycle 0025).

Looks up enabled `automation_rules` whose `trigger_kind` matches a fired
event and whose `trigger_filter` is satisfied by the event payload, then
runs the configured action and appends a row to `automation_run_log`.

Designed to sit *next to* `webhook_dispatcher.dispatch` — call this from
`fire_webhook` so a single mutation feeds both legacy webhooks and the
new automation rules.

Like the webhook + subscription dispatchers, this is best-effort:

  - never raises into the caller
  - opens its own session (`session_factory()`)
  - failures are logged + recorded in `automation_run_log` (status=failed)
  - `MXWP_SKIP_AUTOMATION=1` env disables the entire dispatcher (used in
    unrelated test suites that don't want automation side-effects)

Trigger × action matrix
=======================

trigger_kind     | usable filter keys                  | actions
-----------------|-------------------------------------|------------------------
doc_published    | part_id, slug, document_id          | all 6
doc_archived     | part_id, slug, document_id          | all 6
review_decided   | status, slug, document_id           | all 6
status_transition| from, to, slug, document_id         | all 6
comment_added    | slug, document_id, anchor_kind      | all 6
tag_added        | tag, slug, document_id              | all 6

Filter matching is *simple equality* per key — if the rule's
`trigger_filter` has key `K` with value `V`, the payload must have
`payload[K] == V` for the rule to fire. Missing keys mean "match any".
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import session_factory

logger = logging.getLogger(__name__)


VALID_TRIGGERS: set[str] = {
    "doc_published",
    "doc_archived",
    "review_decided",
    "status_transition",
    "comment_added",
    "tag_added",
    # Cycle 0029 — schedule-driven trigger fired by `automation_cron`. Event
    # callers never use this kind directly; only the cron ticker dispatches
    # via this trigger. Listed here so router validation accepts it on CRUD.
    "cron",
}

VALID_ACTIONS: set[str] = {
    "webhook",
    "notification_blast",
    "add_tag",
    "remove_tag",
    "transition",
    "email_subscribers",
    # Cycle 18 — fan out to a workflow_chain (multi-step automation).
    # action_payload: { chain_id: str }. The chain is fired async so the
    # firing rule's run_log row is written promptly.
    "trigger_chain",
}


# ── Filter matching ──────────────────────────────────────────────────────


def filter_matches(trigger_filter: dict[str, Any], payload: dict[str, Any]) -> bool:
    """Simple per-key equality match.

    Empty filter = match-any. A filter key whose value is a list is treated
    as ``payload[k] in list``; everything else is direct ``==``.
    """
    if not isinstance(trigger_filter, dict) or not trigger_filter:
        return True
    for k, v in trigger_filter.items():
        got = payload.get(k)
        if isinstance(v, list):
            if got not in v:
                return False
        else:
            if got != v:
                return False
    return True


# ── Lookup ───────────────────────────────────────────────────────────────


async def _list_matching_rules(
    s: AsyncSession,
    *,
    trigger_kind: str,
    payload: dict[str, Any],
) -> list[dict[str, Any]]:
    rows = (await s.execute(
        text(
            """
            SELECT id, name, trigger_kind, trigger_filter,
                   action_kind, action_payload
            FROM automation_rules
            WHERE enabled = TRUE
              AND trigger_kind = :tk
            """
        ),
        {"tk": trigger_kind},
    )).all()
    out: list[dict[str, Any]] = []
    for r in rows:
        tf = r[3] if isinstance(r[3], dict) else (
            json.loads(r[3]) if isinstance(r[3], str) else {}
        )
        ap = r[5] if isinstance(r[5], dict) else (
            json.loads(r[5]) if isinstance(r[5], str) else {}
        )
        if not filter_matches(tf, payload):
            continue
        out.append({
            "id": str(r[0]),
            "name": r[1],
            "trigger_kind": r[2],
            "trigger_filter": tf,
            "action_kind": r[4],
            "action_payload": ap,
        })
    return out


# ── Action handlers ──────────────────────────────────────────────────────


async def _action_webhook(
    s: AsyncSession,
    *,
    action_payload: dict[str, Any],
    trigger_kind: str,
    payload: dict[str, Any],
) -> tuple[str, str | None]:
    """Reuse `webhook_dispatcher`'s sign + POST primitives but skip the
    `webhook_deliveries` insert (which expects a real UUID).

    `action_payload`: { url: str, secret?: str }
    """
    from app.services import webhook_dispatcher as wd

    url = action_payload.get("url")
    secret = action_payload.get("secret") or ""
    if not isinstance(url, str) or not url.strip():
        return "skipped", "action_payload.url required"

    body_obj = {"event": trigger_kind, **payload}
    body = json.dumps(body_obj, ensure_ascii=False).encode("utf-8")
    signature = wd.sign_payload(secret, body)
    factory = wd._client_factory
    try:
        async with factory() as client:
            status, snippet, timed_out = await wd._post(
                client, url, body, signature,
            )
    except Exception as e:  # noqa: BLE001
        return "failed", f"webhook error: {e}"
    last_status = wd._classify(status, timed_out=timed_out)
    if last_status == "ok":
        return "ok", None
    return "failed", f"webhook last_status={last_status}"


async def _action_notification_blast(
    s: AsyncSession,
    *,
    action_payload: dict[str, Any],
    trigger_kind: str,
    payload: dict[str, Any],
) -> tuple[str, str | None]:
    """Insert a `notifications` row for every active user.

    action_payload: { kind?: str, message_template?: str, scope?: 'all' }
    """
    kind = action_payload.get("kind") or "automation_blast"
    template = action_payload.get("message_template") or ""
    rows = (await s.execute(
        text("SELECT id FROM users WHERE is_active = TRUE"),
    )).all()
    if not rows:
        return "skipped", "no active users"
    body = {
        "trigger": trigger_kind,
        "message": template,
        "payload": payload,
    }
    body_json = json.dumps(body, ensure_ascii=False)
    for r in rows:
        await s.execute(
            text(
                """
                INSERT INTO notifications (user_id, kind, payload)
                VALUES (CAST(:u AS uuid), :k, CAST(:p AS jsonb))
                """
            ),
            {"u": str(r[0]), "k": kind, "p": body_json},
        )
    return "ok", None


def _extract_doc_id(payload: dict[str, Any]) -> str | None:
    did = payload.get("document_id")
    if isinstance(did, str) and did:
        return did
    return None


async def _mutate_doc_tags(
    s: AsyncSession,
    *,
    doc_id: str,
    add: list[str] | None = None,
    remove: list[str] | None = None,
) -> bool:
    """Read-modify-write of `documents.content_json.metadata.tags`.

    Returns True if a write happened. Idempotent — silently no-ops if the
    target tag is already present (add) or absent (remove).
    """
    row = (await s.execute(
        text(
            "SELECT content_json FROM documents WHERE id = CAST(:d AS uuid)"
        ),
        {"d": doc_id},
    )).first()
    if not row:
        return False
    content = row[0]
    if isinstance(content, str):
        try:
            content = json.loads(content)
        except json.JSONDecodeError:
            return False
    if not isinstance(content, dict):
        return False
    metadata = content.get("metadata") or {}
    if not isinstance(metadata, dict):
        metadata = {}
    tags = metadata.get("tags") or []
    if not isinstance(tags, list):
        tags = []
    new_tags = [t for t in tags if isinstance(t, str)]
    changed = False
    for t in add or []:
        if t and t not in new_tags:
            new_tags.append(t)
            changed = True
    for t in remove or []:
        if t in new_tags:
            new_tags = [x for x in new_tags if x != t]
            changed = True
    if not changed:
        return False
    metadata["tags"] = new_tags
    content["metadata"] = metadata
    await s.execute(
        text(
            """
            UPDATE documents
            SET content_json = CAST(:c AS jsonb),
                updated_at = NOW()
            WHERE id = CAST(:d AS uuid)
            """
        ),
        {"c": json.dumps(content, ensure_ascii=False), "d": doc_id},
    )
    return True


async def _action_add_tag(
    s: AsyncSession,
    *,
    action_payload: dict[str, Any],
    trigger_kind: str,
    payload: dict[str, Any],
) -> tuple[str, str | None]:
    tag = action_payload.get("tag")
    if not isinstance(tag, str) or not tag.strip():
        return "skipped", "action_payload.tag required"
    doc_id = _extract_doc_id(payload)
    if not doc_id:
        return "skipped", "payload.document_id missing"
    ok = await _mutate_doc_tags(s, doc_id=doc_id, add=[tag.strip()])
    return ("ok", None) if ok else ("skipped", "tag already present or doc missing")


async def _action_remove_tag(
    s: AsyncSession,
    *,
    action_payload: dict[str, Any],
    trigger_kind: str,
    payload: dict[str, Any],
) -> tuple[str, str | None]:
    tag = action_payload.get("tag")
    if not isinstance(tag, str) or not tag.strip():
        return "skipped", "action_payload.tag required"
    doc_id = _extract_doc_id(payload)
    if not doc_id:
        return "skipped", "payload.document_id missing"
    ok = await _mutate_doc_tags(s, doc_id=doc_id, remove=[tag.strip()])
    return ("ok", None) if ok else ("skipped", "tag absent or doc missing")


async def _action_transition(
    s: AsyncSession,
    *,
    action_payload: dict[str, Any],
    trigger_kind: str,
    payload: dict[str, Any],
) -> tuple[str, str | None]:
    """Flip `documents.status` to a target value (admin-equivalent)."""
    target = action_payload.get("status")
    if not isinstance(target, str) or target not in {
        "draft", "in_review", "approved", "published", "archived",
    }:
        return "skipped", "action_payload.status must be a valid status"
    doc_id = _extract_doc_id(payload)
    if not doc_id:
        return "skipped", "payload.document_id missing"
    res = await s.execute(
        text(
            """
            UPDATE documents
            SET status = :st, updated_at = NOW()
            WHERE id = CAST(:d AS uuid)
              AND status != :st
            """
        ),
        {"st": target, "d": doc_id},
    )
    if (res.rowcount or 0) == 0:
        return "skipped", "doc missing or already at target status"
    return "ok", None


async def _action_email_subscribers(
    s: AsyncSession,
    *,
    action_payload: dict[str, Any],
    trigger_kind: str,
    payload: dict[str, Any],
) -> tuple[str, str | None]:
    """Loop subscriptions for the doc and dispatch a one-off email each."""
    from app.services.email import send_email

    doc_id = _extract_doc_id(payload)
    if not doc_id:
        return "skipped", "payload.document_id missing"
    subject = action_payload.get("subject") or f"[자동화] {trigger_kind}"
    body = action_payload.get("body") or (
        f"트리거: {trigger_kind}\n문서: {payload.get('slug') or doc_id}"
    )
    rows = (await s.execute(
        text(
            """
            SELECT u.email
            FROM subscriptions sub
            JOIN users u ON u.id = sub.user_id
            WHERE sub.document_id = CAST(:d AS uuid)
              AND u.is_active = TRUE
              AND COALESCE(u.email, '') <> ''
            """
        ),
        {"d": doc_id},
    )).all()
    if not rows:
        return "skipped", "no subscribers"
    sent = 0
    for r in rows:
        addr = r[0]
        if not isinstance(addr, str) or not addr:
            continue
        try:
            ok = await send_email(addr, subject, body)
            if ok:
                sent += 1
        except Exception as e:  # noqa: BLE001 — best-effort
            logger.warning("email_subscribers send failed: %s", e)
    return ("ok", None) if sent else ("failed", "all sends failed")


async def _action_trigger_chain(
    s: AsyncSession,
    *,
    action_payload: dict[str, Any],
    trigger_kind: str,
    payload: dict[str, Any],
) -> tuple[str, str | None]:
    """Fire a workflow_chain (Cycle 18).

    ``action_payload``: ``{ chain_id: str }``. The chain runs in the
    background; we return ``ok`` as soon as the task is scheduled so the
    triggering rule's run-log row is written promptly.
    """
    chain_id = action_payload.get("chain_id")
    if not isinstance(chain_id, str) or not chain_id.strip():
        return "skipped", "action_payload.chain_id required"
    # Imported lazily to avoid an import cycle at module load.
    from app.services import workflow_chain as wc

    try:
        loop = asyncio.get_running_loop()
        loop.create_task(
            wc.run_chain(chain_id.strip(), {"trigger": trigger_kind, **payload})
        )
    except Exception as e:  # noqa: BLE001
        return "failed", f"chain schedule error: {e}"
    return "ok", None


_ACTIONS: dict[str, Any] = {
    "webhook": _action_webhook,
    "notification_blast": _action_notification_blast,
    "add_tag": _action_add_tag,
    "remove_tag": _action_remove_tag,
    "transition": _action_transition,
    "email_subscribers": _action_email_subscribers,
    "trigger_chain": _action_trigger_chain,
}


# ── Run a single rule ────────────────────────────────────────────────────


async def run_rule(
    s: AsyncSession,
    *,
    rule: dict[str, Any],
    trigger_kind: str,
    payload: dict[str, Any],
    dry_run: bool = False,
) -> dict[str, Any]:
    """Execute one rule's action and (unless dry_run) persist the run log
    + bump the rule's `fire_count`.

    Returns ``{ status, error_message? }``.
    """
    action_kind = rule.get("action_kind")
    handler = _ACTIONS.get(action_kind or "")
    if handler is None:
        result = ("skipped", f"unknown action_kind={action_kind}")
    else:
        try:
            result = await handler(
                s,
                action_payload=rule.get("action_payload") or {},
                trigger_kind=trigger_kind,
                payload=payload,
            )
        except Exception as e:  # noqa: BLE001
            logger.warning(
                "automation rule %s action %s failed: %s",
                rule.get("id"), action_kind, e,
            )
            result = ("failed", f"{type(e).__name__}: {e}")

    status, err = result

    if not dry_run:
        try:
            await s.execute(
                text(
                    """
                    INSERT INTO automation_run_log
                      (rule_id, trigger_payload, status, error_message)
                    VALUES (CAST(:r AS uuid), CAST(:p AS jsonb), :s, :em)
                    """
                ),
                {
                    "r": rule["id"],
                    "p": json.dumps(payload, ensure_ascii=False),
                    "s": status,
                    "em": err,
                },
            )
            await s.execute(
                text(
                    """
                    UPDATE automation_rules
                    SET fire_count = fire_count + 1,
                        last_fired_at = NOW()
                    WHERE id = CAST(:r AS uuid)
                    """
                ),
                {"r": rule["id"]},
            )
            await s.commit()
        except Exception as e:  # noqa: BLE001
            logger.warning("run-log persist failed: %s", e)

    return {"status": status, "error_message": err}


# ── Public entrypoint ────────────────────────────────────────────────────


async def dispatch_event(
    trigger_kind: str,
    payload: dict[str, Any],
) -> int:
    """Find + run all matching rules. Returns count fired (incl. failed)."""
    if os.environ.get("MXWP_SKIP_AUTOMATION") == "1":
        return 0
    if trigger_kind not in VALID_TRIGGERS:
        return 0
    try:
        sf = session_factory()
        async with sf() as s:
            rules = await _list_matching_rules(
                s, trigger_kind=trigger_kind, payload=payload
            )
    except Exception as e:  # noqa: BLE001
        logger.warning("automation lookup (%s) skipped: %s", trigger_kind, e)
        return 0

    fired = 0
    for rule in rules:
        try:
            sf2 = session_factory()
            async with sf2() as s2:
                await run_rule(
                    s2, rule=rule, trigger_kind=trigger_kind, payload=payload,
                )
            fired += 1
        except Exception as e:  # noqa: BLE001
            logger.warning(
                "automation rule %s skipped: %s", rule.get("id"), e,
            )
    return fired
