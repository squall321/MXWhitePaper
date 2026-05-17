"""Scheduled backup runner — in-process asyncio ticker (Cycle 0015).

Per-process scheduler: spawned from `app.main` lifespan. Every 60s it pulls
``backup_schedules`` rows whose ``next_run_at <= now()`` and ``enabled = true``
and runs them sequentially. Each run zips per-doc rendered files into a single
archive uploaded to MinIO bucket ``mxwp-backups`` and audits a row into
``backup_runs``.

NOTE — single-replica only.
    This is intentionally simple. With multiple API replicas a row would be
    picked by every replica simultaneously. Production should swap this for
    Celery beat / k8s CronJob — left as a follow-up. The ticker is disabled
    when ``settings.backup_enabled`` is False.

Format support:
    - json: raw `documents.content_json` dump.
    - md  : `markdown_export.render_markdown`
    - html: `html_renderer.render_namuwiki_html`
    - docx: `docx_export.render_docx` (no images; per-doc backup only).
    - pptx: `pptx_export.render_pptx` (no images).

Per-doc render failure does NOT abort the run — it's logged and skipped, and
the resulting archive simply lacks that doc. The run still reports `ok` with
a partial `doc_count`. Only catastrophic errors (storage upload failure, DB
error) flip the run to `failed`.
"""
from __future__ import annotations

import asyncio
import io
import json
import logging
import zipfile
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.db import session_scope
from app.repos import document_repo
from app.services.docx_export import DocxOptions, render_docx
from app.services.html_renderer import render_namuwiki_html
from app.services.markdown_export import render_markdown
from app.services.pptx_export import PptxOptions, render_pptx
from app.storage import minio_adapter

logger = logging.getLogger(__name__)


BACKUP_BUCKET = "mxwp-backups"
TICK_INTERVAL_SECONDS = 60


# ── Cadence math ─────────────────────────────────────────────────────


def compute_next_run(
    *, cadence: str, hour_utc: int, after: datetime | None = None,
) -> datetime:
    """Return the next UTC instant for a recurring schedule.

    The returned timestamp is strictly greater than ``after`` (default: now).
    daily/weekly/monthly all anchor on ``hour_utc:00:00`` UTC; weekly/monthly
    add 7/30 day intervals from the next daily anchor. (We treat "monthly" as
    a fixed 30-day cadence rather than calendar-month math to keep the rule
    simple — this matches every other in-process scheduler in the codebase.)
    """
    now = after or datetime.now(UTC)
    # Today's anchor at hour_utc.
    anchor = now.replace(hour=hour_utc, minute=0, second=0, microsecond=0)
    if anchor <= now:
        anchor = anchor + timedelta(days=1)
    if cadence == "daily":
        return anchor
    if cadence == "weekly":
        return anchor + timedelta(days=6)  # next-day + 6 = 7-day cadence
    if cadence == "monthly":
        return anchor + timedelta(days=29)  # 30-day cadence
    raise ValueError(f"unsupported cadence: {cadence!r}")


# ── Document selection per scope ─────────────────────────────────────


async def _select_doc_ids(
    s: AsyncSession,
    *,
    scope: str,
    target_user_id: str | None,
    target_doc_slug: str | None,
) -> list[str]:
    if scope == "doc":
        if not target_doc_slug:
            return []
        row = (await s.execute(
            text("SELECT id FROM documents WHERE slug = :slug AND status != 'archived'"),
            {"slug": target_doc_slug},
        )).first()
        return [str(row[0])] if row else []
    if scope == "user":
        if not target_user_id:
            return []
        rows = (await s.execute(
            text(
                "SELECT id FROM documents "
                "WHERE owner_id = CAST(:u AS uuid) AND status != 'archived'"
            ),
            {"u": target_user_id},
        )).all()
        return [str(r[0]) for r in rows]
    # full
    rows = (await s.execute(
        text("SELECT id FROM documents WHERE status != 'archived'")
    )).all()
    return [str(r[0]) for r in rows]


# ── Per-doc render dispatch ──────────────────────────────────────────


def _render_doc(doc: dict[str, Any], fmt: str) -> tuple[bytes, str]:
    """Return (bytes, file extension) for one doc rendered in ``fmt``."""
    content = doc["content_json"]
    if fmt == "json":
        return (
            json.dumps(content, ensure_ascii=False, indent=2).encode("utf-8"),
            "json",
        )
    if fmt == "md":
        return render_markdown(content, include_metadata=True).encode("utf-8"), "md"
    if fmt == "html":
        return render_namuwiki_html(content).encode("utf-8"), "html"
    if fmt == "docx":
        # No image resolver — backups are content-only; image bytes would
        # blow archive size for very little gain. The DOCX renderer falls
        # back to a placeholder when no resolver is provided.
        return render_docx(content, options=DocxOptions()), "docx"
    if fmt == "pptx":
        return render_pptx(content, options=PptxOptions()), "pptx"
    raise ValueError(f"unsupported format: {fmt!r}")


# ── Run a single backup ──────────────────────────────────────────────


async def run_backup(
    s: AsyncSession,
    *,
    schedule_id: str | None,
    scope: str,
    fmt: str,
    target_user_id: str | None = None,
    target_doc_slug: str | None = None,
) -> dict[str, Any]:
    """Execute one backup synchronously. Returns the resulting `backup_runs` row.

    Steps:
      1) Insert `backup_runs` (status=running) and commit so progress shows up
         even if the worker is killed mid-render.
      2) Select doc ids for the scope.
      3) Render each doc; collect bytes + filenames into an in-memory zip.
      4) Upload zip to ``mxwp-backups``.
      5) Update `backup_runs` to status=ok | failed.
    """
    started = datetime.now(UTC)
    storage_key = (
        f"{scope}/{started:%Y/%m}/{started:%Y-%m-%dT%H-%M-%SZ}-{fmt}.zip"
    )

    # 1) running row
    row = (await s.execute(
        text(
            """
            INSERT INTO backup_runs
              (schedule_id, scope, format, storage_key, size_bytes, status)
            VALUES (
              CAST(:sid AS uuid), :scope, :fmt, :key, 0, 'running'
            )
            RETURNING id
            """
        ),
        {
            "sid": schedule_id,
            "scope": scope,
            "fmt": fmt,
            "key": storage_key,
        },
    )).first()
    assert row is not None  # INSERT...RETURNING always emits one row
    run_id = str(row[0])
    await s.commit()

    try:
        doc_ids = await _select_doc_ids(
            s,
            scope=scope,
            target_user_id=target_user_id,
            target_doc_slug=target_doc_slug,
        )

        buf = io.BytesIO()
        rendered = 0
        with zipfile.ZipFile(buf, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
            # Manifest helps recovery — we know what was attempted vs missed.
            manifest: list[dict[str, Any]] = []
            for did in doc_ids:
                doc = await document_repo.find_by_id(s, did)
                if not doc:
                    continue
                slug = doc.get("slug") or did
                try:
                    data, ext = _render_doc(doc, fmt)
                    zf.writestr(f"{slug}.{ext}", data)
                    rendered += 1
                    manifest.append({"slug": slug, "ok": True})
                except Exception as e:
                    logger.exception("backup render failed for %s", slug)
                    manifest.append({
                        "slug": slug, "ok": False, "error": str(e)[:200],
                    })
            zf.writestr(
                "manifest.json",
                json.dumps(
                    {
                        "run_id": run_id,
                        "schedule_id": schedule_id,
                        "scope": scope,
                        "format": fmt,
                        "started_at": started.isoformat(),
                        "items": manifest,
                    },
                    ensure_ascii=False,
                    indent=2,
                ).encode("utf-8"),
            )

        payload = buf.getvalue()
        size = len(payload)

        # Upload — synchronous boto3 call; safe for our small-scale workloads.
        cli = minio_adapter.internal_client()
        cli.put_object(
            Bucket=BACKUP_BUCKET,
            Key=storage_key,
            Body=payload,
            ContentType="application/zip",
        )

        await s.execute(
            text(
                """
                UPDATE backup_runs
                   SET status = 'ok',
                       size_bytes = :sz,
                       doc_count = :n,
                       finished_at = NOW()
                 WHERE id = CAST(:id AS uuid)
                """
            ),
            {"sz": size, "n": rendered, "id": run_id},
        )
        await s.commit()
        return {"run_id": run_id, "size_bytes": size, "doc_count": rendered}
    except Exception as e:
        logger.exception("backup run %s crashed", run_id)
        await s.execute(
            text(
                """
                UPDATE backup_runs
                   SET status = 'failed',
                       error_message = :msg,
                       finished_at = NOW()
                 WHERE id = CAST(:id AS uuid)
                """
            ),
            {"msg": str(e)[:1000], "id": run_id},
        )
        await s.commit()
        raise


# ── Tick: pull due schedules and run them ────────────────────────────


async def tick_once() -> int:
    """One scheduler pass. Returns the number of schedules executed."""
    settings = get_settings()
    if not settings.backup_enabled:
        return 0

    now = datetime.now(UTC)
    executed = 0

    async with session_scope() as s:
        rows = (await s.execute(
            text(
                """
                SELECT id, scope, cadence, hour_utc, format,
                       target_user_id, target_doc_slug
                  FROM backup_schedules
                 WHERE enabled = true
                   AND (next_run_at IS NULL OR next_run_at <= :now)
                 ORDER BY next_run_at NULLS FIRST
                 LIMIT 20
                """
            ),
            {"now": now},
        )).all()
        due = [
            {
                "id": str(r[0]),
                "scope": r[1],
                "cadence": r[2],
                "hour_utc": int(r[3]),
                "format": r[4],
                "target_user_id": str(r[5]) if r[5] else None,
                "target_doc_slug": r[6],
            }
            for r in rows
        ]

    for sched in due:
        # Each schedule gets its own session so a crash in one doesn't taint
        # the next.
        async with session_scope() as s:
            try:
                await run_backup(
                    s,
                    schedule_id=sched["id"],
                    scope=sched["scope"],
                    fmt=sched["format"],
                    target_user_id=sched["target_user_id"],
                    target_doc_slug=sched["target_doc_slug"],
                )
                executed += 1
            except Exception:
                logger.error("schedule %s failed", sched["id"])
            # Always advance next_run_at so a poison schedule doesn't loop.
            nxt = compute_next_run(
                cadence=sched["cadence"], hour_utc=sched["hour_utc"]
            )
            await s.execute(
                text(
                    """
                    UPDATE backup_schedules
                       SET last_run_at = NOW(),
                           next_run_at = :nxt
                     WHERE id = CAST(:id AS uuid)
                    """
                ),
                {"nxt": nxt, "id": sched["id"]},
            )
            await s.commit()

    return executed


async def backup_ticker() -> None:
    """Long-running asyncio task. Spawned from app.main lifespan."""
    logger.info("backup_ticker started")
    while True:
        try:
            await tick_once()
        except Exception:
            logger.exception("backup tick failed")
        from app.services.ticker_state import report_tick as _rt; _rt("backup", next_due_at=datetime.now(UTC) + timedelta(seconds=TICK_INTERVAL_SECONDS))
        await asyncio.sleep(TICK_INTERVAL_SECONDS)
