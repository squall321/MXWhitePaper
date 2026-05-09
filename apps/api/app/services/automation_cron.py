"""Automation cron ticker (Cycle 0029).

Time-driven sibling of ``automation_dispatcher`` (Cycle 0025). Where the
dispatcher fires rules in response to *events*, this runner fires rules
on a *schedule* — the rule carries a 5-field cron expression and a
precomputed ``next_cron_run_at`` timestamp; we sweep every 30s for due
rows.

Lifecycle::

    every 30s
      ↓
    SELECT id, cron_expression, action_kind, action_payload, name
      FROM automation_rules
      WHERE trigger_kind='cron' AND enabled AND next_cron_run_at <= NOW()
      ↓
    for each due rule:
      run_rule via existing automation_dispatcher.run_rule
        (kind='cron', payload={rule_id, scheduled_at})
      next_run = cron_parser.next_run(parsed, NOW())
      UPDATE automation_rules SET next_cron_run_at = :next

The rule's ``last_fired_at`` + ``fire_count`` are bumped by ``run_rule``
itself (same code path as event dispatch), and the per-run row is appended
to ``automation_run_log`` exactly as it would be for an event-fired rule.

NOTE — single-replica only. Same caveat as the other in-process tickers
(backup_runner, digest_runner, retention_runner, reminder_runner).
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import session_scope
from app.services import automation_dispatcher
from app.services.cron_parser import next_run, parse_cron


def _resolve_tz(name: str | None) -> ZoneInfo:
    """Resolve an IANA tz name. Falls back to UTC for empty / unknown names
    so a poison value never crashes the ticker."""
    if not name or name == "UTC":
        return ZoneInfo("UTC")
    try:
        return ZoneInfo(name)
    except ZoneInfoNotFoundError:
        logger.warning("automation_cron: unknown timezone %r — falling back to UTC", name)
        return ZoneInfo("UTC")

logger = logging.getLogger(__name__)


TICK_INTERVAL_SECONDS = 30


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


async def _due_rules(s: AsyncSession, *, now: datetime) -> list[dict[str, Any]]:
    rows = (await s.execute(
        text(
            """
            SELECT id, name, cron_expression, action_kind,
                   action_payload, next_cron_run_at, cron_timezone
            FROM automation_rules
            WHERE trigger_kind = 'cron'
              AND enabled = TRUE
              AND cron_expression IS NOT NULL
              AND (next_cron_run_at IS NULL OR next_cron_run_at <= :now)
            ORDER BY next_cron_run_at NULLS FIRST
            LIMIT 100
            """
        ),
        {"now": now},
    )).all()
    out: list[dict[str, Any]] = []
    for r in rows:
        ap = r[4]
        if isinstance(ap, str):
            try:
                ap = json.loads(ap)
            except json.JSONDecodeError:
                ap = {}
        if not isinstance(ap, dict):
            ap = {}
        out.append({
            "id": str(r[0]),
            "name": r[1],
            "cron_expression": r[2],
            "action_kind": r[3],
            "action_payload": ap,
            "next_cron_run_at": r[5],
            "cron_timezone": r[6] or "UTC",
        })
    return out


async def tick_once() -> int:
    """Run one scheduler pass. Returns number of rules fired (for tests)."""
    if os.environ.get("MXWP_SKIP_AUTOMATION") == "1":
        return 0
    now = _utcnow()
    fired = 0

    # Snapshot due rules in one read txn so the writes below run in their
    # own per-rule sessions (matches the dispatcher's pattern).
    async with session_scope() as s:
        due = await _due_rules(s, now=now)

    for rule in due:
        try:
            parsed = parse_cron(rule["cron_expression"])
        except ValueError as e:
            # Bad expression — clear the schedule so we don't loop on a
            # poison rule. Admin sees the error in the run log.
            logger.warning(
                "automation_cron: bad expression on rule %s: %s",
                rule["id"], e,
            )
            async with session_scope() as s:
                await s.execute(
                    text(
                        """
                        INSERT INTO automation_run_log
                          (rule_id, trigger_payload, status, error_message)
                        VALUES
                          (CAST(:r AS uuid), CAST(:p AS jsonb), 'failed', :em)
                        """
                    ),
                    {
                        "r": rule["id"],
                        "p": json.dumps({"rule_id": rule["id"]}),
                        "em": f"invalid cron_expression: {e}",
                    },
                )
                # Disable the rule so it doesn't keep flooding the log.
                await s.execute(
                    text(
                        "UPDATE automation_rules SET enabled = FALSE "
                        "WHERE id = CAST(:r AS uuid)"
                    ),
                    {"r": rule["id"]},
                )
                await s.commit()
            continue

        scheduled_at = (
            rule["next_cron_run_at"].isoformat()
            if rule["next_cron_run_at"]
            else now.isoformat()
        )
        payload = {
            "rule_id": rule["id"],
            "scheduled_at": scheduled_at,
        }
        # Run the rule's action via the existing dispatcher path. This
        # writes the run-log row and bumps fire_count for us.
        async with session_scope() as s:
            try:
                await automation_dispatcher.run_rule(
                    s,
                    rule={
                        "id": rule["id"],
                        "name": rule["name"],
                        "action_kind": rule["action_kind"],
                        "action_payload": rule["action_payload"],
                    },
                    trigger_kind="cron",
                    payload=payload,
                    dry_run=False,
                )
                fired += 1
            except Exception:  # noqa: BLE001
                logger.exception(
                    "automation_cron: rule %s crashed during dispatch",
                    rule["id"],
                )
            # Always advance the schedule — even on crash — so a poison
            # action doesn't loop. Start from the planned firing time
            # (catches up missed ticks) but keep advancing until the
            # result is strictly in the future. Without this guard,
            # stale schedules (e.g. test fixtures or ticker downtime)
            # produce a `nxt` still in the past, so the next tick fires
            # again immediately and the run-loop spins.
            base = rule["next_cron_run_at"] or now
            tz = _resolve_tz(rule.get("cron_timezone"))
            try:
                nxt = next_run(parsed, base, tz=tz)
                # Cap at a few iterations so a misconfigured rule can't
                # spin forever; 1440 = "one day's worth of minutes".
                for _ in range(1440):
                    if nxt > now:
                        break
                    nxt = next_run(parsed, nxt, tz=tz)
            except ValueError:
                nxt = next_run(parsed, now, tz=tz)
            await s.execute(
                text(
                    "UPDATE automation_rules "
                    "SET next_cron_run_at = :nxt "
                    "WHERE id = CAST(:r AS uuid)"
                ),
                {"nxt": nxt, "r": rule["id"]},
            )
            await s.commit()

    return fired


async def cron_ticker() -> None:
    """Long-running asyncio task. Spawned from app.main lifespan."""
    logger.info("automation_cron_ticker started")
    while True:
        try:
            await tick_once()
        except Exception:  # noqa: BLE001
            logger.exception("automation_cron tick failed")
        from datetime import timedelta as _td; from app.services.ticker_state import report_tick as _rt; _rt("automation_cron", next_due_at=_utcnow() + _td(seconds=TICK_INTERVAL_SECONDS))
        await asyncio.sleep(TICK_INTERVAL_SECONDS)
