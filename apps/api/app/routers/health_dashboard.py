"""Admin health/status dashboard router.

GET ``/api/v1/admin/health-dashboard`` returns a comprehensive operational
snapshot for admins:

  - process uptime + version (git sha + commit date when available)
  - DB connection-pool stats (size / checked-out / overflow)
  - MinIO endpoint reachability + per-bucket object count + total size
  - Meilisearch index sizes
  - In-process ticker registry (last_tick_at + next_due_at per ticker)
  - 24h error count (audit_logs ``*.error*`` action match — best signal we
    have without a separate metrics store)
  - Rate-limit telemetry (active buckets + active blocks)
  - Queue depths for the three batch surfaces (automation rules pending,
    webhook deliveries pending, subscription digest buffer)

Each subsection is computed under its own ``try/except`` so a single
broken downstream (e.g. MinIO unreachable) doesn't break the entire
response — the failing section reports ``ok: false`` instead.

Single-replica only — same caveat as the tickers themselves. Future work
includes Prometheus exporter / alerting hooks.
"""
from __future__ import annotations

import os
import subprocess
import time
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import require_admin
from app.core.config import get_settings
from app.core.db import engine, get_db
from app.core.errors import envelope
from app.middleware.rate_limit import get_limiter
from app.search import meili_indexer
from app.services import ticker_state
from app.storage import minio_adapter


router = APIRouter(prefix="/api/v1", tags=["admin"])


# Module-level start time — first import of this module = process start
# (close enough for an operational dashboard; the tickers' lifespan kicks
# in after this anyway).
_PROCESS_STARTED_AT = time.monotonic()

# Tickers we expect to be running. Used to merge with `ticker_state.snapshot()`
# so a ticker that hasn't reported yet still shows up as "running: false".
KNOWN_TICKERS: tuple[str, ...] = (
    "backup",
    "digest",
    "automation_event",
    "automation_cron",
    "retention",
    "reminder",
    "audit_pruner",
)


def _git_version() -> str:
    """Best-effort short git sha + commit date.

    Falls back to ``"unknown"`` outside a working tree (e.g. inside a
    minimal Docker image where ``.git`` is not bundled).
    """
    try:
        out = subprocess.check_output(
            ["git", "log", "-1", "--format=%h %cI"],
            stderr=subprocess.DEVNULL,
            cwd=os.path.dirname(os.path.abspath(__file__)),
            timeout=2,
        ).decode("utf-8", "replace").strip()
        return out or "unknown"
    except Exception:  # noqa: BLE001
        return "unknown"


# ── Section: database pool ───────────────────────────────────────────────


def _database_section() -> dict[str, Any]:
    try:
        eng = engine()
        pool = eng.pool
        # SQLAlchemy ``QueuePool`` exposes integer attrs. ``AsyncAdaptedQueue
        # Pool`` (asyncpg) is the common case here.
        size = int(getattr(pool, "size", lambda: 0)() or 0)
        checked_out = int(getattr(pool, "checkedout", lambda: 0)() or 0)
        overflow = int(getattr(pool, "overflow", lambda: 0)() or 0)
        return {
            "pool_size": size,
            "checked_out": checked_out,
            "overflow": overflow,
            "ok": True,
        }
    except Exception as e:  # noqa: BLE001
        return {
            "pool_size": 0,
            "checked_out": 0,
            "overflow": 0,
            "ok": False,
            "error": str(e)[:200],
        }


# ── Section: MinIO ───────────────────────────────────────────────────────


def _bucket_stat(cli: Any, name: str) -> dict[str, Any]:
    """Walk the bucket once. Caps at 5000 objects so a ballooning bucket
    doesn't make the dashboard endpoint slow."""
    count = 0
    size_bytes = 0
    try:
        paginator = cli.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=name, PaginationConfig={"MaxItems": 5000}):
            for obj in page.get("Contents", []) or []:
                count += 1
                size_bytes += int(obj.get("Size") or 0)
        return {"name": name, "count": count, "size_bytes": size_bytes}
    except Exception as e:  # noqa: BLE001
        return {
            "name": name,
            "count": 0,
            "size_bytes": 0,
            "error": str(e)[:200],
        }


def _minio_section() -> dict[str, Any]:
    settings = get_settings()
    try:
        cli = minio_adapter.internal_client()
        buckets = [
            settings.minio_bucket_images,
            settings.minio_bucket_files,
            settings.minio_bucket_backups,
        ]
        rows = [_bucket_stat(cli, b) for b in buckets]
        ok = all("error" not in r for r in rows)
        return {
            "endpoint": settings.minio_endpoint,
            "buckets": rows,
            "ok": ok,
        }
    except Exception as e:  # noqa: BLE001
        return {
            "endpoint": settings.minio_endpoint,
            "buckets": [],
            "ok": False,
            "error": str(e)[:200],
        }


# ── Section: Meilisearch ─────────────────────────────────────────────────


def _meilisearch_section() -> dict[str, Any]:
    settings = get_settings()
    try:
        cli = meili_indexer.get_client()
        idx = cli.index(meili_indexer.INDEX_UID)
        stats = idx.get_stats()
        nd = getattr(stats, "number_of_documents", None)
        if nd is None and isinstance(stats, dict):
            nd = stats.get("numberOfDocuments")
        return {
            "url": settings.meili_host,
            "indexes": [{"uid": meili_indexer.INDEX_UID, "count": int(nd or 0)}],
            "ok": True,
        }
    except Exception as e:  # noqa: BLE001
        return {
            "url": settings.meili_host,
            "indexes": [],
            "ok": False,
            "error": str(e)[:200],
        }


# ── Section: ticker registry ─────────────────────────────────────────────


def _tickers_section() -> list[dict[str, Any]]:
    snap = {row["name"]: row for row in ticker_state.snapshot()}
    out: list[dict[str, Any]] = []
    for name in KNOWN_TICKERS:
        row = snap.get(name)
        if row is None:
            out.append({
                "name": name,
                "running": False,
                "last_tick_at": None,
                "next_due_at": None,
            })
        else:
            out.append({
                "name": name,
                "running": True,
                "last_tick_at": row["last_tick_at"],
                "next_due_at": row["next_due_at"],
            })
    # Surface any unknown tickers that reported but aren't in KNOWN_TICKERS
    # (defensive — keeps the dashboard honest if Z3 adds another).
    for name, row in snap.items():
        if name in KNOWN_TICKERS:
            continue
        out.append({
            "name": name,
            "running": True,
            "last_tick_at": row["last_tick_at"],
            "next_due_at": row["next_due_at"],
        })
    return out


# ── Section: errors_24h ──────────────────────────────────────────────────


async def _errors_24h(s: AsyncSession) -> int:
    """Approximate 24h error rate by counting audit_logs whose ``action``
    contains 'error' or 'failed'. Best signal without a separate metrics
    backend; a Prometheus exporter is flagged as future work."""
    try:
        row = (await s.execute(
            text(
                "SELECT COUNT(*) FROM audit_logs "
                "WHERE created_at >= NOW() - INTERVAL '24 hours' "
                "AND (action ILIKE '%error%' OR action ILIKE '%failed%')"
            )
        )).first()
        return int(row[0]) if row else 0
    except Exception:  # noqa: BLE001
        return 0


# ── Section: rate-limit ──────────────────────────────────────────────────


def _rate_limit_section() -> dict[str, Any]:
    try:
        snap = get_limiter().snapshot(top_n=1)
        return {
            "active_buckets": int(snap.get("total_buckets") or 0),
            "active_blocks": int(snap.get("active_block_count") or 0),
        }
    except Exception:  # noqa: BLE001
        return {"active_buckets": 0, "active_blocks": 0}


# ── Section: queue depths ────────────────────────────────────────────────


async def _queue_depths(s: AsyncSession) -> dict[str, int]:
    out = {
        "automation_pending": 0,
        "webhook_deliveries_pending": 0,
        "subscription_digest_buffer": 0,
    }
    # automation_pending — rules whose `next_cron_run_at` is past due
    try:
        row = (await s.execute(
            text(
                "SELECT COUNT(*) FROM automation_rules "
                "WHERE trigger_kind = 'cron' AND enabled = TRUE "
                "AND next_cron_run_at IS NOT NULL "
                "AND next_cron_run_at <= NOW()"
            )
        )).first()
        out["automation_pending"] = int(row[0]) if row else 0
    except Exception:  # noqa: BLE001
        pass
    # webhook_deliveries_pending — rows still being retried
    try:
        row = (await s.execute(
            text(
                "SELECT COUNT(*) FROM webhook_deliveries "
                "WHERE last_status = 'pending' OR last_status = 'retrying'"
            )
        )).first()
        out["webhook_deliveries_pending"] = int(row[0]) if row else 0
    except Exception:  # noqa: BLE001
        pass
    # subscription_digest_buffer
    try:
        row = (await s.execute(
            text("SELECT COUNT(*) FROM pending_digest_items")
        )).first()
        out["subscription_digest_buffer"] = int(row[0]) if row else 0
    except Exception:  # noqa: BLE001
        pass
    return out


# ── Endpoint ─────────────────────────────────────────────────────────────


@router.get(
    "/admin/health-dashboard",
    summary="시스템 헬스 종합 대시보드 (admin)",
    description=(
        "DB 풀 / MinIO 버킷 / Meilisearch 인덱스 / 인-프로세스 ticker / "
        "24h 에러 카운트 / rate-limit / 큐 깊이 통합 스냅샷. "
        "각 섹션은 try/except 로 격리되며 실패 시 ``ok: false`` 만 반환."
    ),
)
async def health_dashboard(
    s: AsyncSession = Depends(get_db),
    _admin: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    uptime_seconds = int(time.monotonic() - _PROCESS_STARTED_AT)
    return envelope(
        data={
            "uptime_seconds": uptime_seconds,
            "version": _git_version(),
            "database": _database_section(),
            "minio": _minio_section(),
            "meilisearch": _meilisearch_section(),
            "tickers": _tickers_section(),
            "errors_24h": await _errors_24h(s),
            "rate_limit": _rate_limit_section(),
            "queue_depths": await _queue_depths(s),
        }
    )
