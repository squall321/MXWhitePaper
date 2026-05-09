"""Workflow chains router (Cycle 18).

Admin-only CRUD for ``workflow_chains`` + per-chain run history + a
``run-now`` trigger. PATCH replaces the steps array atomically (delete
+ reinsert inside a single transaction).

Endpoints (all under ``/api/v1``):

  - POST   /workflow-chains                    (admin) — create
  - GET    /workflow-chains                    (admin) — list (with step_count)
  - GET    /workflow-chains/{id}               (admin) — detail + steps
  - PATCH  /workflow-chains/{id}               (admin) — partial update
  - DELETE /workflow-chains/{id}               (admin) — delete (cascade)
  - POST   /workflow-chains/{id}/run-now       (admin) — fire immediately
  - GET    /workflow-chains/{id}/runs?limit=50 (admin) — recent runs
"""
from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Body, Depends, Path, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import require_admin
from app.core.db import get_db
from app.core.errors import NotFound, ValidationFailed, envelope
from app.repos import document_repo
from app.services import workflow_chain
from app.services.automation_dispatcher import VALID_ACTIONS
from app.services.workflow_chain import VALID_FAIL_STRATEGIES

router = APIRouter(prefix="/api/v1", tags=["workflow_chains"])


# ── Pydantic models ──────────────────────────────────────────────────────


class StepIn(BaseModel):
    ordering: int = Field(..., ge=0)
    rule_id: str | None = None
    action_kind: str | None = None
    action_payload: dict[str, Any] = Field(default_factory=dict)
    delay_seconds: int = Field(default=0, ge=0)
    fail_strategy: str = Field(default="halt")


def _validate_steps(steps: list[StepIn]) -> None:
    """Cross-field validation done at the router level so we can emit a
    clean ``ValidationFailed`` envelope (pydantic's ``model_validator``
    raises ``ValueError`` that does not JSON-serialize through our
    standard 422 handler)."""
    for idx, step in enumerate(steps):
        has_rule = bool(step.rule_id)
        has_kind = bool(step.action_kind)
        if has_rule == has_kind:
            raise ValidationFailed(
                f"steps[{idx}] must set exactly one of rule_id or action_kind",
                details={"index": idx},
            )
        if step.fail_strategy not in VALID_FAIL_STRATEGIES:
            raise ValidationFailed(
                f"steps[{idx}].fail_strategy must be one of "
                f"{sorted(VALID_FAIL_STRATEGIES)}",
                details={"index": idx, "got": step.fail_strategy},
            )
        if step.action_kind is not None and step.action_kind not in VALID_ACTIONS:
            raise ValidationFailed(
                f"steps[{idx}].action_kind must be one of "
                f"{sorted(VALID_ACTIONS)}",
                details={"index": idx, "got": step.action_kind},
            )


class ChainCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    description: str | None = None
    enabled: bool = True
    steps: list[StepIn] = Field(default_factory=list)


class ChainPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    enabled: bool | None = None
    # When provided, replaces the entire steps array atomically.
    steps: list[StepIn] | None = None


class RunNowIn(BaseModel):
    trigger_payload: dict[str, Any] = Field(default_factory=dict)


# ── Helpers ──────────────────────────────────────────────────────────────


def _parse_jsonb(v: Any) -> Any:
    if isinstance(v, (dict, list)):
        return v
    if isinstance(v, str):
        try:
            return json.loads(v)
        except json.JSONDecodeError:
            return {}
    return {}


def _chain_row_to_dict(r: Any) -> dict[str, Any]:
    return {
        "id": str(r[0]),
        "name": r[1],
        "description": r[2],
        "enabled": bool(r[3]),
        "created_by": str(r[4]) if r[4] else None,
        "created_at": r[5].isoformat() if r[5] else None,
        "updated_at": r[6].isoformat() if r[6] else None,
    }


def _step_row_to_dict(r: Any) -> dict[str, Any]:
    return {
        "id": str(r[0]),
        "chain_id": str(r[1]),
        "ordering": int(r[2]),
        "rule_id": str(r[3]) if r[3] else None,
        "action_kind": r[4],
        "action_payload": _parse_jsonb(r[5]),
        "delay_seconds": int(r[6] or 0),
        "fail_strategy": r[7] or "halt",
    }


async def _fetch_chain(s: AsyncSession, cid: str) -> dict[str, Any] | None:
    row = (await s.execute(
        text(
            """
            SELECT id, name, description, enabled, created_by,
                   created_at, updated_at
            FROM workflow_chains
            WHERE id = CAST(:c AS uuid)
            """
        ),
        {"c": cid},
    )).first()
    if not row:
        return None
    return _chain_row_to_dict(row)


async def _fetch_steps(s: AsyncSession, cid: str) -> list[dict[str, Any]]:
    rows = (await s.execute(
        text(
            """
            SELECT id, chain_id, ordering, rule_id, action_kind,
                   action_payload, delay_seconds, fail_strategy
            FROM workflow_chain_steps
            WHERE chain_id = CAST(:c AS uuid)
            ORDER BY ordering ASC, id ASC
            """
        ),
        {"c": cid},
    )).all()
    return [_step_row_to_dict(r) for r in rows]


async def _fetch_step_count(s: AsyncSession, cid: str) -> int:
    row = (await s.execute(
        text(
            "SELECT COUNT(*) FROM workflow_chain_steps "
            "WHERE chain_id = CAST(:c AS uuid)"
        ),
        {"c": cid},
    )).first()
    return int(row[0] or 0) if row else 0


async def _fetch_last_run_at(s: AsyncSession, cid: str) -> str | None:
    row = (await s.execute(
        text(
            "SELECT triggered_at FROM workflow_chain_runs "
            "WHERE chain_id = CAST(:c AS uuid) "
            "ORDER BY triggered_at DESC LIMIT 1"
        ),
        {"c": cid},
    )).first()
    if not row or not row[0]:
        return None
    return row[0].isoformat()


async def _insert_steps(
    s: AsyncSession, *, chain_id: str, steps: list[StepIn],
) -> None:
    for step in steps:
        # asyncpg cannot infer the type of a parameter used as both the
        # NULL test and the CAST target in a single CASE expression, so
        # we branch on the Python side and emit two distinct INSERTs.
        if step.rule_id:
            await s.execute(
                text(
                    """
                    INSERT INTO workflow_chain_steps
                      (chain_id, ordering, rule_id, action_kind,
                       action_payload, delay_seconds, fail_strategy)
                    VALUES
                      (CAST(:c AS uuid), :o, CAST(:rid AS uuid),
                       NULL, CAST(:ap AS jsonb), :ds, :fs)
                    """
                ),
                {
                    "c": chain_id,
                    "o": int(step.ordering),
                    "rid": step.rule_id,
                    "ap": json.dumps(step.action_payload),
                    "ds": int(step.delay_seconds),
                    "fs": step.fail_strategy,
                },
            )
        else:
            await s.execute(
                text(
                    """
                    INSERT INTO workflow_chain_steps
                      (chain_id, ordering, rule_id, action_kind,
                       action_payload, delay_seconds, fail_strategy)
                    VALUES
                      (CAST(:c AS uuid), :o, NULL,
                       :ak, CAST(:ap AS jsonb), :ds, :fs)
                    """
                ),
                {
                    "c": chain_id,
                    "o": int(step.ordering),
                    "ak": step.action_kind,
                    "ap": json.dumps(step.action_payload),
                    "ds": int(step.delay_seconds),
                    "fs": step.fail_strategy,
                },
            )


# ── Endpoints ────────────────────────────────────────────────────────────


@router.post(
    "/workflow-chains",
    status_code=201,
    summary="워크플로우 체인 생성 (admin)",
)
async def create_chain(
    body: ChainCreate,
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    _validate_steps(body.steps)
    row = (await s.execute(
        text(
            """
            INSERT INTO workflow_chains
              (name, description, enabled, created_by)
            VALUES
              (:n, :d, :en, CAST(:cb AS uuid))
            RETURNING id
            """
        ),
        {
            "n": body.name,
            "d": body.description,
            "en": bool(body.enabled),
            "cb": user["id"],
        },
    )).first()
    cid = str(row[0])
    await _insert_steps(s, chain_id=cid, steps=body.steps)
    await document_repo.insert_audit(
        s, user_id=user["id"], action="workflow_chain.create",
        target=f"workflow_chain:{cid}",
        payload={"name": body.name, "step_count": len(body.steps)},
    )
    await s.commit()
    chain = await _fetch_chain(s, cid)
    if not chain:
        raise NotFound("chain just created vanished")
    chain["steps"] = await _fetch_steps(s, cid)
    return envelope(data=chain)


@router.get(
    "/workflow-chains",
    summary="워크플로우 체인 목록 (admin)",
)
async def list_chains(
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    rows = (await s.execute(
        text(
            """
            SELECT c.id, c.name, c.description, c.enabled, c.created_by,
                   c.created_at, c.updated_at,
                   (SELECT COUNT(*) FROM workflow_chain_steps s
                      WHERE s.chain_id = c.id) AS step_count,
                   (SELECT MAX(triggered_at) FROM workflow_chain_runs r
                      WHERE r.chain_id = c.id) AS last_run_at
            FROM workflow_chains c
            ORDER BY c.created_at DESC
            """
        ),
    )).all()
    items: list[dict[str, Any]] = []
    for r in rows:
        d = _chain_row_to_dict(r)
        d["step_count"] = int(r[7] or 0)
        d["last_run_at"] = r[8].isoformat() if r[8] else None
        items.append(d)
    return envelope(data={"items": items}, meta={"count": len(items)})


@router.get(
    "/workflow-chains/{chain_id}",
    summary="워크플로우 체인 단건 (admin) — 단계 포함",
)
async def get_chain(
    chain_id: str = Path(..., min_length=1),
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    chain = await _fetch_chain(s, chain_id)
    if not chain:
        raise NotFound("chain not found")
    chain["steps"] = await _fetch_steps(s, chain_id)
    chain["step_count"] = len(chain["steps"])
    chain["last_run_at"] = await _fetch_last_run_at(s, chain_id)
    return envelope(data=chain)


@router.patch(
    "/workflow-chains/{chain_id}",
    summary="워크플로우 체인 수정 (admin) — steps 전달 시 통째 교체",
)
async def patch_chain(
    body: ChainPatch,
    chain_id: str = Path(..., min_length=1),
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    chain = await _fetch_chain(s, chain_id)
    if not chain:
        raise NotFound("chain not found")

    if body.steps is not None:
        _validate_steps(body.steps)

    sets: list[str] = []
    params: dict[str, Any] = {"id": chain_id}
    if body.name is not None:
        sets.append("name = :n")
        params["n"] = body.name
    if body.description is not None:
        sets.append("description = :d")
        params["d"] = body.description
    if body.enabled is not None:
        sets.append("enabled = :en")
        params["en"] = bool(body.enabled)

    if not sets and body.steps is None:
        raise ValidationFailed("nothing to update")

    if sets:
        sets.append("updated_at = NOW()")
        await s.execute(
            text(
                f"UPDATE workflow_chains SET {', '.join(sets)} "
                "WHERE id = CAST(:id AS uuid)"
            ),
            params,
        )

    if body.steps is not None:
        await s.execute(
            text(
                "DELETE FROM workflow_chain_steps "
                "WHERE chain_id = CAST(:c AS uuid)"
            ),
            {"c": chain_id},
        )
        await _insert_steps(s, chain_id=chain_id, steps=body.steps)
        # Bump updated_at even if only steps changed.
        await s.execute(
            text(
                "UPDATE workflow_chains SET updated_at = NOW() "
                "WHERE id = CAST(:id AS uuid)"
            ),
            {"id": chain_id},
        )

    await document_repo.insert_audit(
        s, user_id=user["id"], action="workflow_chain.update",
        target=f"workflow_chain:{chain_id}",
        payload={
            k: v
            for k, v in body.model_dump(exclude={"steps"}).items()
            if v is not None
        }
        | ({"steps_replaced": len(body.steps)} if body.steps is not None else {}),
    )
    await s.commit()

    fresh = await _fetch_chain(s, chain_id)
    if not fresh:
        raise NotFound("chain vanished")
    fresh["steps"] = await _fetch_steps(s, chain_id)
    return envelope(data=fresh)


@router.delete(
    "/workflow-chains/{chain_id}",
    status_code=204,
    summary="워크플로우 체인 삭제 (admin)",
)
async def delete_chain(
    chain_id: str = Path(..., min_length=1),
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_admin),
) -> Response:
    chain = await _fetch_chain(s, chain_id)
    if not chain:
        raise NotFound("chain not found")
    await s.execute(
        text("DELETE FROM workflow_chains WHERE id = CAST(:id AS uuid)"),
        {"id": chain_id},
    )
    await document_repo.insert_audit(
        s, user_id=user["id"], action="workflow_chain.delete",
        target=f"workflow_chain:{chain_id}",
        payload={},
    )
    await s.commit()
    return Response(status_code=204)


@router.post(
    "/workflow-chains/{chain_id}/run-now",
    summary="워크플로우 체인 즉시 실행 (admin)",
)
async def run_now(
    body: RunNowIn | None = Body(default=None),
    chain_id: str = Path(..., min_length=1),
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    chain = await _fetch_chain(s, chain_id)
    if not chain:
        raise NotFound("chain not found")
    payload = (body.trigger_payload if body else None) or {
        "trigger": "manual",
        "user_id": user["id"],
    }
    result = await workflow_chain.run_chain(chain_id, payload)
    await document_repo.insert_audit(
        s, user_id=user["id"], action="workflow_chain.run_now",
        target=f"workflow_chain:{chain_id}",
        payload={"status": result.get("status")},
    )
    await s.commit()
    return envelope(data={"chain_id": chain_id, **result})


@router.get(
    "/workflow-chains/{chain_id}/runs",
    summary="워크플로우 체인 실행 로그 (admin, 최근순)",
)
async def list_runs(
    chain_id: str = Path(..., min_length=1),
    limit: int = Query(default=50, ge=1, le=500),
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    chain = await _fetch_chain(s, chain_id)
    if not chain:
        raise NotFound("chain not found")
    rows = (await s.execute(
        text(
            """
            SELECT id, triggered_at, trigger_payload, status,
                   steps_completed, steps_failed, finished_at, error_message
            FROM workflow_chain_runs
            WHERE chain_id = CAST(:c AS uuid)
            ORDER BY triggered_at DESC
            LIMIT :lim
            """
        ),
        {"c": chain_id, "lim": limit},
    )).all()
    items = [
        {
            "id": int(r[0]),
            "triggered_at": r[1].isoformat() if r[1] else None,
            "trigger_payload": _parse_jsonb(r[2]),
            "status": r[3],
            "steps_completed": int(r[4] or 0),
            "steps_failed": int(r[5] or 0),
            "finished_at": r[6].isoformat() if r[6] else None,
            "error_message": r[7],
        }
        for r in rows
    ]
    return envelope(data={"items": items}, meta={"count": len(items)})
