"""Backups router — schedules + runs + run-now + presigned download.

Endpoints (all prefixed `/api/v1`):

  - POST   /backups/schedules   (admin OR creator-of-self) → 201
  - GET    /backups/schedules                              (admin: all; user: own)
  - PATCH  /backups/schedules/{id}                         (admin OR creator)
  - DELETE /backups/schedules/{id}                         (admin OR creator)
  - POST   /backups/run-now                                (admin) — fires sync
  - GET    /backups/runs?limit=20                          (admin)
  - GET    /backups/runs/{id}/download                     (admin) → 302 presigned

`scope='full'` schedules require admin. `scope='user'` is admin-only when
`target_user_id` ≠ requester. `scope='doc'` allows non-admins as long as the
target doc exists. (Tightening per-doc ownership is a follow-up — the
documents schema doesn't currently expose per-user write rules to the BE.)
"""
from __future__ import annotations

import logging
from typing import Any, Literal

from fastapi import APIRouter, Depends, Query, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user, require_admin
from app.core.db import get_db
from app.core.errors import Forbidden, NotFound, ValidationFailed, envelope
from app.services.backup_runner import (
    BACKUP_BUCKET,
    compute_next_run,
    run_backup,
)
from app.storage import minio_adapter

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/backups", tags=["backups"])


# ── Schemas ─────────────────────────────────────────────────────────


Scope = Literal["full", "user", "doc"]
Cadence = Literal["daily", "weekly", "monthly"]
Format = Literal["json", "html", "md", "docx", "pptx"]


class ScheduleIn(BaseModel):
    scope: Scope
    cadence: Cadence
    hour_utc: int = Field(default=3, ge=0, le=23)
    format: Format
    target_user_id: str | None = None
    target_doc_slug: str | None = None


class SchedulePatchIn(BaseModel):
    cadence: Cadence | None = None
    hour_utc: int | None = Field(default=None, ge=0, le=23)
    format: Format | None = None
    enabled: bool | None = None


class RunNowIn(BaseModel):
    scope: Scope
    format: Format
    target_user_id: str | None = None
    target_doc_slug: str | None = None


# ── Helpers ─────────────────────────────────────────────────────────


def _is_admin(user: dict[str, Any]) -> bool:
    return user.get("role") == "admin"


def _serialize_schedule(row: Any) -> dict[str, Any]:
    return {
        "id": str(row[0]),
        "scope": row[1],
        "cadence": row[2],
        "hour_utc": int(row[3]),
        "format": row[4],
        "target_user_id": str(row[5]) if row[5] else None,
        "target_doc_slug": row[6],
        "enabled": bool(row[7]),
        "last_run_at": row[8].isoformat() if row[8] else None,
        "next_run_at": row[9].isoformat() if row[9] else None,
        "created_by": str(row[10]),
        "created_at": row[11].isoformat() if row[11] else None,
    }


_SCHEDULE_COLS = (
    "id, scope, cadence, hour_utc, format, "
    "target_user_id, target_doc_slug, enabled, "
    "last_run_at, next_run_at, created_by, created_at"
)


async def _fetch_schedule(
    s: AsyncSession, schedule_id: str
) -> dict[str, Any] | None:
    row = (await s.execute(
        text(f"SELECT {_SCHEDULE_COLS} FROM backup_schedules WHERE id = CAST(:id AS uuid)"),
        {"id": schedule_id},
    )).first()
    return _serialize_schedule(row) if row else None


def _ensure_can_create(body: ScheduleIn, user: dict[str, Any]) -> None:
    if body.scope == "full" and not _is_admin(user):
        raise Forbidden("scope='full' requires admin")
    if body.scope == "user":
        target = body.target_user_id or user["id"]
        if not _is_admin(user) and target != user["id"]:
            raise Forbidden(
                "scope='user' for another user requires admin",
            )
    if body.scope == "doc" and not body.target_doc_slug:
        raise ValidationFailed("target_doc_slug required for scope='doc'")
    if body.scope == "user" and not (body.target_user_id or user["id"]):
        raise ValidationFailed("target_user_id required for scope='user'")


def _ensure_can_edit(
    schedule: dict[str, Any], user: dict[str, Any]
) -> None:
    if _is_admin(user):
        return
    if schedule["created_by"] == user["id"]:
        return
    raise Forbidden("only the creator or admin may modify this schedule")


# ── Schedules ───────────────────────────────────────────────────────


@router.post(
    "/schedules", status_code=201, summary="백업 일정 생성"
)
async def create_schedule(
    body: ScheduleIn,
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    _ensure_can_create(body, user)

    target_user = body.target_user_id
    if body.scope == "user" and not target_user:
        target_user = user["id"]

    next_run = compute_next_run(cadence=body.cadence, hour_utc=body.hour_utc)
    row = (await s.execute(
        text(
            """
            INSERT INTO backup_schedules
              (scope, cadence, hour_utc, format, target_user_id,
               target_doc_slug, next_run_at, created_by)
            VALUES
              (:scope, :cadence, :hour, :fmt, CAST(:tu AS uuid),
               :tds, :nxt, CAST(:uid AS uuid))
            RETURNING id
            """
        ),
        {
            "scope": body.scope,
            "cadence": body.cadence,
            "hour": body.hour_utc,
            "fmt": body.format,
            "tu": target_user,
            "tds": body.target_doc_slug,
            "nxt": next_run,
            "uid": user["id"],
        },
    )).first()
    assert row is not None  # INSERT...RETURNING always emits one row
    await s.commit()
    detail = await _fetch_schedule(s, str(row[0]))
    assert detail is not None
    return envelope(data=detail)


@router.get("/schedules", summary="백업 일정 목록")
async def list_schedules(
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    if _is_admin(user):
        rows = (await s.execute(
            text(
                f"SELECT {_SCHEDULE_COLS} FROM backup_schedules "
                "ORDER BY created_at DESC"
            )
        )).all()
    else:
        rows = (await s.execute(
            text(
                f"SELECT {_SCHEDULE_COLS} FROM backup_schedules "
                "WHERE created_by = CAST(:uid AS uuid) "
                "ORDER BY created_at DESC"
            ),
            {"uid": user["id"]},
        )).all()
    items = [_serialize_schedule(r) for r in rows]
    return envelope(data=items, meta={"count": len(items)})


@router.patch("/schedules/{schedule_id}", summary="백업 일정 수정")
async def patch_schedule(
    schedule_id: str,
    body: SchedulePatchIn,
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    schedule = await _fetch_schedule(s, schedule_id)
    if not schedule:
        raise NotFound(f"schedule not found: {schedule_id}")
    _ensure_can_edit(schedule, user)

    fields = body.model_dump(exclude_unset=True)
    if not fields:
        raise ValidationFailed("nothing to update")

    sets: list[str] = []
    params: dict[str, Any] = {"id": schedule_id}
    for k, v in fields.items():
        sets.append(f"{k} = :{k}")
        params[k] = v

    # Recompute next_run_at if cadence/hour changed.
    if "cadence" in fields or "hour_utc" in fields:
        cadence = fields.get("cadence", schedule["cadence"])
        hour = fields.get("hour_utc", schedule["hour_utc"])
        params["next_run_at"] = compute_next_run(cadence=cadence, hour_utc=hour)
        sets.append("next_run_at = :next_run_at")

    await s.execute(
        text(
            f"UPDATE backup_schedules SET {', '.join(sets)} "
            "WHERE id = CAST(:id AS uuid)"
        ),
        params,
    )
    await s.commit()
    detail = await _fetch_schedule(s, schedule_id)
    assert detail is not None
    return envelope(data=detail)


@router.delete(
    "/schedules/{schedule_id}",
    status_code=204,
    response_class=Response,
    summary="백업 일정 삭제",
)
async def delete_schedule(
    schedule_id: str,
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(get_current_user),
) -> Response:
    schedule = await _fetch_schedule(s, schedule_id)
    if not schedule:
        raise NotFound(f"schedule not found: {schedule_id}")
    _ensure_can_edit(schedule, user)
    await s.execute(
        text("DELETE FROM backup_schedules WHERE id = CAST(:id AS uuid)"),
        {"id": schedule_id},
    )
    await s.commit()
    return Response(status_code=204)


# ── Run-now (admin) ─────────────────────────────────────────────────


@router.post("/run-now", summary="즉시 백업 실행 (admin)")
async def run_now(
    body: RunNowIn,
    s: AsyncSession = Depends(get_db),
    _user: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    if body.scope == "doc" and not body.target_doc_slug:
        raise ValidationFailed("target_doc_slug required for scope='doc'")
    if body.scope == "user" and not body.target_user_id:
        raise ValidationFailed("target_user_id required for scope='user'")

    result = await run_backup(
        s,
        schedule_id=None,
        scope=body.scope,
        fmt=body.format,
        target_user_id=body.target_user_id,
        target_doc_slug=body.target_doc_slug,
    )
    return envelope(data=result)


# ── Runs (admin) ────────────────────────────────────────────────────


@router.get("/runs", summary="백업 실행 이력 (admin)")
async def list_runs(
    limit: int = Query(default=20, ge=1, le=200),
    s: AsyncSession = Depends(get_db),
    _user: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    rows = (await s.execute(
        text(
            """
            SELECT id, schedule_id, scope, format, storage_key,
                   size_bytes, doc_count, status, error_message,
                   started_at, finished_at
              FROM backup_runs
             ORDER BY started_at DESC
             LIMIT :lim
            """
        ),
        {"lim": limit},
    )).all()
    items = [
        {
            "id": str(r[0]),
            "schedule_id": str(r[1]) if r[1] else None,
            "scope": r[2],
            "format": r[3],
            "storage_key": r[4],
            "size_bytes": int(r[5] or 0),
            "doc_count": int(r[6]) if r[6] is not None else None,
            "status": r[7],
            "error_message": r[8],
            "started_at": r[9].isoformat() if r[9] else None,
            "finished_at": r[10].isoformat() if r[10] else None,
        }
        for r in rows
    ]
    return envelope(data=items, meta={"count": len(items)})


@router.get(
    "/runs/{run_id}/download",
    summary="백업 아카이브 다운로드 (admin) — 302 presigned",
)
async def download_run(
    run_id: str,
    s: AsyncSession = Depends(get_db),
    _user: dict[str, Any] = Depends(require_admin),
) -> RedirectResponse:
    row = (await s.execute(
        text(
            "SELECT storage_key, status FROM backup_runs "
            "WHERE id = CAST(:id AS uuid)"
        ),
        {"id": run_id},
    )).first()
    if not row:
        raise NotFound(f"backup run not found: {run_id}")
    storage_key, status = row[0], row[1]
    if status != "ok":
        raise NotFound(
            f"backup run is not downloadable (status={status})"
        )

    cli = minio_adapter.public_client()
    url = cli.generate_presigned_url(
        "get_object",
        Params={"Bucket": BACKUP_BUCKET, "Key": storage_key},
        ExpiresIn=600,
    )
    return RedirectResponse(url=url, status_code=302)
