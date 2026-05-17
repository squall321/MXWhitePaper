"""Retention policies router (Cycle 0027).

Admin-only CRUD over ``retention_policies`` + a per-policy run log + dry-run
and run-now endpoints. Mirrors the shape of the automation-rules router
(Cycle 0025) but the underlying runner is *time-driven* (an hourly ticker
in `services/retention_runner.py`).

Endpoints (all under ``/api/v1``):

  - POST   /admin/retention-policies                  (admin) → 201 create
  - GET    /admin/retention-policies                  (admin) → list
  - GET    /admin/retention-policies/{id}             (admin) → get
  - PATCH  /admin/retention-policies/{id}             (admin) → partial update
  - DELETE /admin/retention-policies/{id}             (admin) → 204
  - POST   /admin/retention-policies/{id}/dry-run     (admin) → matched slugs, no action
  - POST   /admin/retention-policies/{id}/run         (admin) → fire immediately
  - GET    /admin/retention-policies/{id}/runs        (admin) → recent run rows
"""
from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, Path, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import require_admin
from app.core.db import get_db
from app.core.errors import NotFound, ValidationFailed, envelope
from app.repos import document_repo
from app.services import retention_runner
from app.services.retention_runner import (
    VALID_ACTIONS,
    VALID_TRIGGER_FIELDS,
)

router = APIRouter(prefix="/api/v1", tags=["retention"])


# ── Pydantic models ──────────────────────────────────────────────────────


class PolicyCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    scope_filter: dict[str, Any] = Field(default_factory=dict)
    action: str
    action_payload: dict[str, Any] = Field(default_factory=dict)
    trigger_age_days: int = Field(..., gt=0, le=10_000)
    trigger_field: str
    enabled: bool = True


class PolicyPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    scope_filter: dict[str, Any] | None = None
    action: str | None = None
    action_payload: dict[str, Any] | None = None
    trigger_age_days: int | None = Field(default=None, gt=0, le=10_000)
    trigger_field: str | None = None
    enabled: bool | None = None


# ── Helpers ──────────────────────────────────────────────────────────────


_SELECT_COLS = """
    SELECT id, name, scope_filter, action, action_payload,
           trigger_age_days, trigger_field, enabled,
           last_run_at, next_run_at,
           created_by, created_at
    FROM retention_policies
"""


def _parse_jsonb(v: Any) -> Any:
    if isinstance(v, (dict, list)):
        return v
    if isinstance(v, str):
        try:
            return json.loads(v)
        except json.JSONDecodeError:
            return {}
    return {}


def _row_to_dict(r: Any) -> dict[str, Any]:
    return {
        "id": str(r[0]),
        "name": r[1],
        "scope_filter": _parse_jsonb(r[2]),
        "action": r[3],
        "action_payload": _parse_jsonb(r[4]),
        "trigger_age_days": int(r[5]),
        "trigger_field": r[6],
        "enabled": bool(r[7]),
        "last_run_at": r[8].isoformat() if r[8] else None,
        "next_run_at": r[9].isoformat() if r[9] else None,
        "created_by": str(r[10]) if r[10] else None,
        "created_at": r[11].isoformat() if r[11] else None,
    }


async def _fetch_one(s: AsyncSession, pid: str) -> dict[str, Any] | None:
    row = (await s.execute(
        text(f"{_SELECT_COLS} WHERE id = CAST(:p AS uuid)"),
        {"p": pid},
    )).first()
    if not row:
        return None
    return _row_to_dict(row)


def _validate_action(action: str) -> None:
    if action not in VALID_ACTIONS:
        raise ValidationFailed(
            f"unsupported action '{action}'",
            details={"allowed": sorted(VALID_ACTIONS)},
        )


def _validate_trigger_field(field: str) -> None:
    if field not in VALID_TRIGGER_FIELDS:
        raise ValidationFailed(
            f"unsupported trigger_field '{field}'",
            details={"allowed": sorted(VALID_TRIGGER_FIELDS)},
        )


async def _run_count(s: AsyncSession, pid: str) -> int:
    row = (await s.execute(
        text(
            "SELECT COUNT(*) FROM retention_runs "
            "WHERE policy_id = CAST(:p AS uuid)"
        ),
        {"p": pid},
    )).first()
    return int(row[0]) if row else 0


# ── Endpoints ────────────────────────────────────────────────────────────


@router.post(
    "/admin/retention-policies",
    status_code=201,
    summary="보존 정책 생성 (admin)",
)
async def create_policy(
    body: PolicyCreate,
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    _validate_action(body.action)
    _validate_trigger_field(body.trigger_field)
    row = (await s.execute(
        text(
            """
            INSERT INTO retention_policies
              (name, scope_filter, action, action_payload,
               trigger_age_days, trigger_field, enabled, created_by)
            VALUES
              (:n, CAST(:sf AS jsonb), :ac, CAST(:ap AS jsonb),
               :age, :tf, :en, CAST(:cb AS uuid))
            RETURNING id
            """
        ),
        {
            "n": body.name,
            "sf": json.dumps(body.scope_filter),
            "ac": body.action,
            "ap": json.dumps(body.action_payload),
            "age": int(body.trigger_age_days),
            "tf": body.trigger_field,
            "en": bool(body.enabled),
            "cb": user["id"],
        },
    )).first()
    assert row is not None  # INSERT...RETURNING always emits one row
    pid = str(row[0])
    await document_repo.insert_audit(
        s, user_id=user["id"], action="retention.create",
        target=f"retention_policy:{pid}",
        payload={
            "action": body.action,
            "trigger_field": body.trigger_field,
            "trigger_age_days": body.trigger_age_days,
        },
    )
    await s.commit()
    fresh = await _fetch_one(s, pid)
    if not fresh:
        raise NotFound("policy just created vanished")
    return envelope(data=fresh)


@router.get(
    "/admin/retention-policies",
    summary="보존 정책 목록 (admin)",
)
async def list_policies(
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    rows = (await s.execute(
        text(f"{_SELECT_COLS} ORDER BY created_at DESC"),
    )).all()
    items: list[dict[str, Any]] = []
    for r in rows:
        d = _row_to_dict(r)
        d["run_count"] = await _run_count(s, d["id"])
        items.append(d)
    return envelope(data={"items": items}, meta={"count": len(items)})


@router.get(
    "/admin/retention-policies/{policy_id}",
    summary="보존 정책 단건 (admin)",
)
async def get_policy(
    policy_id: str = Path(..., min_length=1),
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    p = await _fetch_one(s, policy_id)
    if not p:
        raise NotFound("policy not found")
    p["run_count"] = await _run_count(s, policy_id)
    return envelope(data=p)


@router.patch(
    "/admin/retention-policies/{policy_id}",
    summary="보존 정책 수정 (admin)",
)
async def patch_policy(
    body: PolicyPatch,
    policy_id: str = Path(..., min_length=1),
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    p = await _fetch_one(s, policy_id)
    if not p:
        raise NotFound("policy not found")

    sets: list[str] = []
    params: dict[str, Any] = {"id": policy_id}
    if body.name is not None:
        sets.append("name = :n")
        params["n"] = body.name
    if body.scope_filter is not None:
        sets.append("scope_filter = CAST(:sf AS jsonb)")
        params["sf"] = json.dumps(body.scope_filter)
    if body.action is not None:
        _validate_action(body.action)
        sets.append("action = :ac")
        params["ac"] = body.action
    if body.action_payload is not None:
        sets.append("action_payload = CAST(:ap AS jsonb)")
        params["ap"] = json.dumps(body.action_payload)
    if body.trigger_age_days is not None:
        sets.append("trigger_age_days = :age")
        params["age"] = int(body.trigger_age_days)
    if body.trigger_field is not None:
        _validate_trigger_field(body.trigger_field)
        sets.append("trigger_field = :tf")
        params["tf"] = body.trigger_field
    if body.enabled is not None:
        sets.append("enabled = :en")
        params["en"] = bool(body.enabled)
    if not sets:
        raise ValidationFailed("nothing to update")

    await s.execute(
        text(
            f"UPDATE retention_policies SET {', '.join(sets)} "
            "WHERE id = CAST(:id AS uuid)"
        ),
        params,
    )
    await document_repo.insert_audit(
        s, user_id=user["id"], action="retention.update",
        target=f"retention_policy:{policy_id}",
        payload={k: v for k, v in body.model_dump().items() if v is not None},
    )
    await s.commit()
    fresh = await _fetch_one(s, policy_id)
    if not fresh:
        raise NotFound("policy vanished")
    fresh["run_count"] = await _run_count(s, policy_id)
    return envelope(data=fresh)


@router.delete(
    "/admin/retention-policies/{policy_id}",
    status_code=204,
    summary="보존 정책 삭제 (admin)",
)
async def delete_policy(
    policy_id: str = Path(..., min_length=1),
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_admin),
) -> Response:
    p = await _fetch_one(s, policy_id)
    if not p:
        raise NotFound("policy not found")
    await s.execute(
        text(
            "DELETE FROM retention_policies WHERE id = CAST(:id AS uuid)"
        ),
        {"id": policy_id},
    )
    await document_repo.insert_audit(
        s, user_id=user["id"], action="retention.delete",
        target=f"retention_policy:{policy_id}",
        payload={},
    )
    await s.commit()
    return Response(status_code=204)


@router.post(
    "/admin/retention-policies/{policy_id}/dry-run",
    summary="드라이런 — 매칭되는 slug 만 회신, 액션 미실행",
)
async def dry_run_policy(
    policy_id: str = Path(..., min_length=1),
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    p = await _fetch_one(s, policy_id)
    if not p:
        raise NotFound("policy not found")
    result = await retention_runner.run_policy(s, policy=p, dry_run=True)
    return envelope(data={"policy_id": policy_id, **result})


@router.post(
    "/admin/retention-policies/{policy_id}/run",
    summary="즉시 실행 — 매칭 문서에 액션 적용 + 로그 기록",
)
async def run_policy_now(
    policy_id: str = Path(..., min_length=1),
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    p = await _fetch_one(s, policy_id)
    if not p:
        raise NotFound("policy not found")
    result = await retention_runner.run_policy(s, policy=p, dry_run=False)
    # Bump last_run_at like the ticker does — admin run-now is otherwise
    # invisible to the schedule.
    await s.execute(
        text(
            "UPDATE retention_policies SET last_run_at = NOW() "
            "WHERE id = CAST(:id AS uuid)"
        ),
        {"id": policy_id},
    )
    await document_repo.insert_audit(
        s, user_id=user["id"], action="retention.run",
        target=f"retention_policy:{policy_id}",
        payload={
            "affected_doc_count": result["affected_doc_count"],
            "status": result["status"],
        },
    )
    await s.commit()
    return envelope(data={"policy_id": policy_id, **result})


@router.get(
    "/admin/retention-policies/{policy_id}/runs",
    summary="정책 실행 로그 (admin, 최근순)",
)
async def list_runs(
    policy_id: str = Path(..., min_length=1),
    limit: int = Query(default=20, ge=1, le=500),
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    p = await _fetch_one(s, policy_id)
    if not p:
        raise NotFound("policy not found")
    rows = (await s.execute(
        text(
            """
            SELECT id, run_at, affected_doc_count, status, error_message,
                   doc_slugs
            FROM retention_runs
            WHERE policy_id = CAST(:p AS uuid)
            ORDER BY run_at DESC
            LIMIT :lim
            """
        ),
        {"p": policy_id, "lim": limit},
    )).all()
    items = [
        {
            "id": int(r[0]),
            "run_at": r[1].isoformat() if r[1] else None,
            "affected_doc_count": int(r[2]),
            "status": r[3],
            "error_message": r[4],
            "doc_slugs": _parse_jsonb(r[5]),
        }
        for r in rows
    ]
    return envelope(data={"items": items}, meta={"count": len(items)})
