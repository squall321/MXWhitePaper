"""Process-local ticker state registry.

Each in-process asyncio ticker (backup, digest, automation-event,
automation-cron, retention, reminder, audit-pruner) calls
``report_tick(name, next_due_at=...)`` once per iteration so the admin
health dashboard can render "마지막 tick / 다음 예정" rows.

Single-replica only — same caveat as the tickers themselves. With multiple
replicas each replica would maintain its own registry; the dashboard would
need to aggregate over Redis. Flagged for future work.

The registry is intentionally a plain dict guarded by an asyncio-friendly
threading.Lock — writes are microseconds, snapshots are read in the admin
endpoint at low cadence, so contention is a non-issue.
"""
from __future__ import annotations

import threading
from datetime import UTC, datetime
from typing import Any

_LOCK = threading.Lock()
_STATE: dict[str, dict[str, Any]] = {}


def report_tick(name: str, *, next_due_at: datetime | None = None) -> None:
    """Record a tick for ``name``.

    ``last_tick_at`` is set to ``now()``; ``next_due_at`` is optional and
    overwrites the previous value. Callers that don't know their next
    deadline (e.g. the digest runner, which fires on a per-user matur-
    ation) may omit it.
    """
    if not name:
        return
    now = datetime.now(UTC)
    with _LOCK:
        _STATE[name] = {
            "last_tick_at": now,
            "next_due_at": next_due_at,
        }


def snapshot() -> list[dict[str, Any]]:
    """Return a stable, JSON-serialisable list sorted by ticker name.

    Each row::

        {
          "name": "backup",
          "running": True,           # `running` = ticked at least once
          "last_tick_at": "<ISO>",
          "next_due_at": "<ISO>" | None,
        }

    A ticker that never reported is simply absent from the snapshot —
    consumers that need to display "all tickers known to the app" pass
    an explicit list and merge.
    """
    with _LOCK:
        items = sorted(_STATE.items())
        return [
            {
                "name": name,
                "running": True,
                "last_tick_at": (
                    state["last_tick_at"].isoformat()
                    if state.get("last_tick_at") is not None
                    else None
                ),
                "next_due_at": (
                    state["next_due_at"].isoformat()
                    if state.get("next_due_at") is not None
                    else None
                ),
            }
            for name, state in items
        ]


def reset_for_tests() -> None:
    """Drop all recorded ticks — used by pytest cases."""
    with _LOCK:
        _STATE.clear()


__all__ = ["report_tick", "reset_for_tests", "snapshot"]
