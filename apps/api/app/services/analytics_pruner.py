"""analytics_pruner — daily prune of `anchor_samples` rows older than 30 days.

Cycle 0016. Mirrors the in-process `backup_runner.backup_ticker` shape — a
long-running asyncio task spawned from `app.main` lifespan. Single-replica
only; production multi-replica should swap for k8s CronJob.

The TTL is 30 days. Pruning is cheap (a single DELETE) but we run it once
per `TICK_INTERVAL_SECONDS` and bail early if the last run is fresher than
that. The first tick runs immediately so a freshly-deployed instance
trims any leftover rows.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import text

from app.core.db import session_scope

logger = logging.getLogger(__name__)


TICK_INTERVAL_SECONDS = 60 * 60 * 24  # daily
TTL_DAYS = 30


async def prune_once() -> int:
    """Delete anchor_samples rows older than TTL_DAYS. Returns rowcount."""
    async with session_scope() as s:
        res = await s.execute(
            text(
                "DELETE FROM anchor_samples "
                "WHERE sampled_at < NOW() - (:n || ' days')::interval"
            ),
            {"n": str(TTL_DAYS)},
        )
        await s.commit()
        # rowcount may be -1 on async dialects that don't surface it; treat
        # as 0 for the audit log. getattr keeps pyright quiet — abstract
        # `Result` doesn't expose `rowcount`, only `CursorResult` does.
        deleted = max(int(getattr(res, "rowcount", 0) or 0), 0)
        logger.info("analytics_pruner: deleted %d anchor_samples rows", deleted)
        return deleted


async def analytics_pruner() -> None:
    """Long-running asyncio task. Spawned from app.main lifespan."""
    logger.info("analytics_pruner started (TTL=%d days)", TTL_DAYS)
    last_run: datetime | None = None
    while True:
        try:
            now = datetime.now(UTC)
            if (
                last_run is None
                or now - last_run >= timedelta(seconds=TICK_INTERVAL_SECONDS)
            ):
                await prune_once()
                last_run = now
        except Exception:
            logger.exception("analytics_pruner tick failed")
        # Sleep in 60s slices so cancel propagates quickly on shutdown.
        await asyncio.sleep(60)
