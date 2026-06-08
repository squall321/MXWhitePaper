"""Housekeeping ticker — images_pending TTL sweep + document_versions compaction.

B-1 (2026-06-08). Wraps two of the three helpers from
``app.services.maintenance`` as an in-process asyncio ticker (the third,
``purge_old_audit_logs``, is already covered by Cycle 0032's
``audit_pruner_ticker``).

Two passes inside one tick to keep cadence simple:

* ``purge_expired_pending_uploads`` — fast (single DELETE on a TTL index).
* ``compact_versions`` — heavier (per-doc walk), but the helper iterates
  itself; we delegate the schedule decision to the helper's idempotent
  policy.

Mirrors ``audit_pruner_ticker`` exactly — settings flag gates the tick,
``tick_once`` is a no-op when disabled so admin CLI (`apps/api/app/scripts/
sweep_pending.py` / `compact_versions.py`) keeps working regardless.

Cadence: 1h (housekeeping doesn't need second-resolution and the heavier
``compact_versions`` pass is per-doc so the cost grows with the corpus).
Single-replica only — multi-replica should swap for k8s CronJob.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime, timedelta

from app.core.config import get_settings
from app.core.db import session_scope
from app.services.maintenance import (
    compact_versions,
    purge_expired_pending_uploads,
)

logger = logging.getLogger(__name__)


TICK_INTERVAL_SECONDS = 60 * 60  # hourly


async def tick_once() -> dict[str, int]:
    """One scheduler pass. Returns counts.

    Honours ``settings.maintenance_runner_enabled`` — no-ops when False.
    """
    settings = get_settings()
    if not getattr(settings, "maintenance_runner_enabled", True):
        return {"pending_uploads_purged": 0, "versions_compacted": 0}
    pending = 0
    compacted = 0
    async with session_scope() as s:
        pending = await purge_expired_pending_uploads(s)
    # Separate session for the heavier per-doc walk so the TTL sweep above
    # commits and releases its locks before the compaction begins.
    async with session_scope() as s:
        compacted = await compact_versions(s)
    return {"pending_uploads_purged": pending, "versions_compacted": compacted}


async def maintenance_ticker() -> None:
    """Long-running asyncio task. Spawned from app.main lifespan."""
    logger.info("maintenance_runner started")
    last_run: datetime | None = None
    while True:
        try:
            now = datetime.now(UTC)
            if (
                last_run is None
                or now - last_run >= timedelta(seconds=TICK_INTERVAL_SECONDS)
            ):
                counts = await tick_once()
                if counts.get("pending_uploads_purged") or counts.get(
                    "versions_compacted"
                ):
                    logger.info(
                        "maintenance tick: %s", counts,
                    )
                last_run = now
        except Exception:
            logger.exception("maintenance_runner tick failed")
        from app.services.ticker_state import report_tick as _rt
        _rt(
            "maintenance_runner",
            next_due_at=(
                last_run + timedelta(seconds=TICK_INTERVAL_SECONDS)
            )
            if last_run
            else None,
        )
        # 60s slices keep cancel propagation fast on shutdown.
        await asyncio.sleep(60)
