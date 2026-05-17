"""Audit log retention pruner — daily DELETE of stale `audit_logs` rows.

Cycle 0032. Reads the singleton ``audit_retention_config`` row (id=1) and,
when ``enabled`` is true, runs::

    DELETE FROM audit_logs WHERE created_at < NOW() - retain_days INTERVAL

Updates ``last_run_at`` and accumulates ``rows_pruned_total``. Mirrors
``analytics_pruner`` (Cycle 0016) shape — a long-running asyncio task
spawned from `app.main` lifespan. Single-replica only; production
multi-replica should swap for k8s CronJob.

Honours ``settings.audit_retention_enabled`` — when False, the ticker
loop returns immediately so ``tick_once()`` is a no-op.

Defaults to retain_days=365 — typical legal-hold window.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.db import session_scope

logger = logging.getLogger(__name__)


TICK_INTERVAL_SECONDS = 60 * 60 * 24  # daily — once a day


# ── Read config ──────────────────────────────────────────────────────────


async def read_config(s: AsyncSession) -> dict[str, Any]:
    """Return the singleton config row, materialising it on first read.

    The migration seeds id=1 — but be defensive in case a fresh DB skipped
    the seed (e.g., a partial migration). Returns the canonical shape.
    """
    row = (await s.execute(
        text(
            """
            SELECT id, retain_days, enabled, last_run_at,
                   rows_pruned_total, updated_at
            FROM audit_retention_config
            WHERE id = 1
            """
        )
    )).first()
    if row is None:
        await s.execute(
            text(
                "INSERT INTO audit_retention_config (id, retain_days) "
                "VALUES (1, 365) ON CONFLICT (id) DO NOTHING"
            )
        )
        await s.commit()
        row = (await s.execute(
            text(
                """
                SELECT id, retain_days, enabled, last_run_at,
                       rows_pruned_total, updated_at
                FROM audit_retention_config
                WHERE id = 1
                """
            )
        )).first()
    assert row is not None
    return {
        "id": int(row[0]),
        "retain_days": int(row[1]),
        "enabled": bool(row[2]),
        "last_run_at": row[3].isoformat() if row[3] else None,
        "rows_pruned_total": int(row[4]),
        "updated_at": row[5].isoformat() if row[5] else None,
    }


# ── Prune ────────────────────────────────────────────────────────────────


async def prune_once(*, force: bool = False) -> int:
    """Delete `audit_logs` rows older than `retain_days`. Returns rowcount.

    Skips when the config row says ``enabled = false`` unless ``force`` is
    True (used by the admin run-now endpoint). Always advances
    ``last_run_at`` on a real run and accumulates ``rows_pruned_total``.
    """
    async with session_scope() as s:
        cfg = await read_config(s)
        if not cfg["enabled"] and not force:
            logger.info("audit_pruner: disabled — skipping")
            return 0

        retain_days = int(cfg["retain_days"])
        # Bind days as text to dodge asyncpg's int→text cast refusal — same
        # trick the retention_runner uses.
        res = await s.execute(
            text(
                "DELETE FROM audit_logs "
                "WHERE created_at < NOW() - "
                "(CAST(:days AS text) || ' days')::interval"
            ),
            {"days": str(retain_days)},
        )
        deleted = max(int(getattr(res, "rowcount", 0) or 0), 0)

        await s.execute(
            text(
                """
                UPDATE audit_retention_config
                SET last_run_at = NOW(),
                    rows_pruned_total = rows_pruned_total + :n,
                    updated_at = NOW()
                WHERE id = 1
                """
            ),
            {"n": deleted},
        )
        await s.commit()
        logger.info(
            "audit_pruner: deleted %d audit_logs rows (retain_days=%d)",
            deleted, retain_days,
        )
        return deleted


async def tick_once() -> int:
    """One scheduler pass. Returns deleted rowcount.

    Honours ``settings.audit_retention_enabled`` — returns 0 when False.
    """
    settings = get_settings()
    if not getattr(settings, "audit_retention_enabled", True):
        return 0
    return await prune_once(force=False)


async def audit_pruner_ticker() -> None:
    """Long-running asyncio task. Spawned from app.main lifespan."""
    logger.info("audit_pruner started")
    last_run: datetime | None = None
    while True:
        try:
            now = datetime.now(UTC)
            if (
                last_run is None
                or now - last_run >= timedelta(seconds=TICK_INTERVAL_SECONDS)
            ):
                await tick_once()
                last_run = now
        except Exception:
            logger.exception("audit_pruner tick failed")
        from app.services.ticker_state import report_tick as _rt; _rt("audit_pruner", next_due_at=(last_run + timedelta(seconds=TICK_INTERVAL_SECONDS)) if last_run else None)
        # Sleep in 60s slices so cancel propagates quickly on shutdown.
        await asyncio.sleep(60)
