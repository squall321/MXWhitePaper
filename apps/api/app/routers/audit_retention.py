"""Audit log retention router (Cycle 0032).

Admin-only single-row config + immediate-prune trigger:

  - GET    /admin/audit-retention            → current config + stats
  - PATCH  /admin/audit-retention            → update retain_days / enabled
  - POST   /admin/audit-retention/prune-now  → fire prune immediately

Backed by the singleton ``audit_retention_config`` row (id=1) and the
``audit_pruner`` ticker (`apps/api/app/services/audit_pruner.py`).

Single-row config so there's no CRUD on multiple records — `PATCH` is the
only mutation. Mirrors the audit logs table that the viewer (Cycle 11
Q1) reads from.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import require_admin
from app.core.db import get_db
from app.core.errors import ValidationFailed, envelope
from app.repos import document_repo
from app.services import audit_pruner

router = APIRouter(prefix="/api/v1", tags=["admin"])


# ── Pydantic ─────────────────────────────────────────────────────────────


class AuditRetentionPatch(BaseModel):
    retain_days: int | None = Field(default=None, gt=0, le=10_000)
    enabled: bool | None = None


# ── Helpers ──────────────────────────────────────────────────────────────


async def _audit_log_count(s: AsyncSession) -> int:
    row = (await s.execute(text("SELECT COUNT(*) FROM audit_logs"))).first()
    return int(row[0]) if row else 0


# ── Endpoints ────────────────────────────────────────────────────────────


@router.get(
    "/admin/audit-retention",
    summary="감사 로그 보존 설정 + 통계 (admin)",
)
async def get_audit_retention(
    s: AsyncSession = Depends(get_db),
    _admin: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    cfg = await audit_pruner.read_config(s)
    total = await _audit_log_count(s)
    return envelope(
        data={
            "retain_days": cfg["retain_days"],
            "enabled": cfg["enabled"],
            "last_run_at": cfg["last_run_at"],
            "rows_pruned_total": cfg["rows_pruned_total"],
            "updated_at": cfg["updated_at"],
            "audit_log_total": total,
        }
    )


@router.patch(
    "/admin/audit-retention",
    summary="감사 로그 보존 설정 수정 (admin)",
)
async def patch_audit_retention(
    body: AuditRetentionPatch,
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    sets: list[str] = []
    params: dict[str, Any] = {}
    if body.retain_days is not None:
        sets.append("retain_days = :rd")
        params["rd"] = int(body.retain_days)
    if body.enabled is not None:
        sets.append("enabled = :en")
        params["en"] = bool(body.enabled)
    if not sets:
        raise ValidationFailed("nothing to update")
    sets.append("updated_at = NOW()")

    # Make sure the singleton row exists before we UPDATE it.
    await audit_pruner.read_config(s)

    await s.execute(
        text(f"UPDATE audit_retention_config SET {', '.join(sets)} WHERE id = 1"),
        params,
    )
    await document_repo.insert_audit(
        s,
        user_id=user["id"],
        action="audit_retention.update",
        target="audit_retention_config:1",
        payload={k: v for k, v in body.model_dump().items() if v is not None},
    )
    await s.commit()
    cfg = await audit_pruner.read_config(s)
    total = await _audit_log_count(s)
    return envelope(
        data={
            "retain_days": cfg["retain_days"],
            "enabled": cfg["enabled"],
            "last_run_at": cfg["last_run_at"],
            "rows_pruned_total": cfg["rows_pruned_total"],
            "updated_at": cfg["updated_at"],
            "audit_log_total": total,
        }
    )


@router.post(
    "/admin/audit-retention/prune-now",
    summary="즉시 prune — 매칭되는 audit_logs 행 삭제 (admin)",
)
async def prune_now(
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    # Force=True so admin run-now still fires when enabled=false.
    deleted = await audit_pruner.prune_once(force=True)
    # Audit-log the audit-prune. (Recursive-feeling but useful for ops.)
    await document_repo.insert_audit(
        s,
        user_id=user["id"],
        action="audit_retention.prune_now",
        target="audit_retention_config:1",
        payload={"rows_pruned": deleted},
    )
    await s.commit()
    return envelope(data={"rows_pruned": deleted})
