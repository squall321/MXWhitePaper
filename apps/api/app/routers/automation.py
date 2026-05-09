"""Automation rules router (Cycle 0025).

Admin-only CRUD over `automation_rules` + a per-rule run log + a dry-run
test endpoint that fires the action without persisting the run.

Endpoints (all `/api/v1`):

  - POST   /automation/rules                 (admin) — create
  - GET    /automation/rules                 (admin) — list
  - GET    /automation/rules/{id}            (admin) — get
  - PATCH  /automation/rules/{id}            (admin) — partial update
  - DELETE /automation/rules/{id}            (admin) — delete (cascade log)
  - GET    /automation/rules/{id}/runs       (admin) — last 50 by default
  - POST   /automation/rules/{id}/test       (admin) — fire once

`trigger_filter` and `action_payload` are JSONB blobs whose schema depends
on `trigger_kind` / `action_kind`. Validation here is intentionally
shallow — the dispatcher tolerates missing keys gracefully.
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
from app.services import automation_dispatcher
from app.services.automation_dispatcher import VALID_ACTIONS, VALID_TRIGGERS

router = APIRouter(prefix="/api/v1", tags=["automation"])


# ── Pydantic models ──────────────────────────────────────────────────────


class RuleCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    trigger_kind: str
    trigger_filter: dict[str, Any] = Field(default_factory=dict)
    action_kind: str
    action_payload: dict[str, Any] = Field(default_factory=dict)
    enabled: bool = True


class RulePatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    trigger_kind: str | None = None
    trigger_filter: dict[str, Any] | None = None
    action_kind: str | None = None
    action_payload: dict[str, Any] | None = None
    enabled: bool | None = None


class TestRuleIn(BaseModel):
    dry_run: bool = True
    payload: dict[str, Any] = Field(default_factory=dict)


# ── Helpers ──────────────────────────────────────────────────────────────


_SELECT_COLS = """
    SELECT id, name, trigger_kind, trigger_filter,
           action_kind, action_payload, enabled,
           created_by, created_at, last_fired_at, fire_count
    FROM automation_rules
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
        "trigger_kind": r[2],
        "trigger_filter": _parse_jsonb(r[3]),
        "action_kind": r[4],
        "action_payload": _parse_jsonb(r[5]),
        "enabled": bool(r[6]),
        "created_by": str(r[7]) if r[7] else None,
        "created_at": r[8].isoformat() if r[8] else None,
        "last_fired_at": r[9].isoformat() if r[9] else None,
        "fire_count": int(r[10] or 0),
    }


async def _fetch_one(s: AsyncSession, rid: str) -> dict[str, Any] | None:
    row = (await s.execute(
        text(f"{_SELECT_COLS} WHERE id = CAST(:r AS uuid)"),
        {"r": rid},
    )).first()
    if not row:
        return None
    return _row_to_dict(row)


def _validate_trigger(kind: str) -> None:
    if kind not in VALID_TRIGGERS:
        raise ValidationFailed(
            f"unsupported trigger_kind '{kind}'",
            details={"allowed": sorted(VALID_TRIGGERS)},
        )


def _validate_action(kind: str) -> None:
    if kind not in VALID_ACTIONS:
        raise ValidationFailed(
            f"unsupported action_kind '{kind}'",
            details={"allowed": sorted(VALID_ACTIONS)},
        )


# ── Endpoints ────────────────────────────────────────────────────────────


@router.post(
    "/automation/rules",
    status_code=201,
    summary="자동화 규칙 생성 (admin)",
)
async def create_rule(
    body: RuleCreate,
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    _validate_trigger(body.trigger_kind)
    _validate_action(body.action_kind)
    row = (await s.execute(
        text(
            """
            INSERT INTO automation_rules
              (name, trigger_kind, trigger_filter,
               action_kind, action_payload, enabled, created_by)
            VALUES
              (:n, :tk, CAST(:tf AS jsonb),
               :ak, CAST(:ap AS jsonb), :en, CAST(:cb AS uuid))
            RETURNING id
            """
        ),
        {
            "n": body.name,
            "tk": body.trigger_kind,
            "tf": json.dumps(body.trigger_filter),
            "ak": body.action_kind,
            "ap": json.dumps(body.action_payload),
            "en": bool(body.enabled),
            "cb": user["id"],
        },
    )).first()
    rid = str(row[0])
    await document_repo.insert_audit(
        s, user_id=user["id"], action="automation.create",
        target=f"automation_rule:{rid}",
        payload={"trigger": body.trigger_kind, "action": body.action_kind},
    )
    await s.commit()
    rule = await _fetch_one(s, rid)
    if not rule:
        raise NotFound("rule just created vanished")
    return envelope(data=rule)


@router.get(
    "/automation/rules",
    summary="자동화 규칙 목록 (admin)",
)
async def list_rules(
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    rows = (await s.execute(
        text(f"{_SELECT_COLS} ORDER BY created_at DESC"),
    )).all()
    items = [_row_to_dict(r) for r in rows]
    return envelope(data={"items": items}, meta={"count": len(items)})


@router.get(
    "/automation/rules/{rule_id}",
    summary="자동화 규칙 단건 (admin)",
)
async def get_rule(
    rule_id: str = Path(..., min_length=1),
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    rule = await _fetch_one(s, rule_id)
    if not rule:
        raise NotFound("rule not found")
    return envelope(data=rule)


@router.patch(
    "/automation/rules/{rule_id}",
    summary="자동화 규칙 수정 (admin)",
)
async def patch_rule(
    body: RulePatch,
    rule_id: str = Path(..., min_length=1),
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    rule = await _fetch_one(s, rule_id)
    if not rule:
        raise NotFound("rule not found")

    sets: list[str] = []
    params: dict[str, Any] = {"id": rule_id}
    if body.name is not None:
        sets.append("name = :n")
        params["n"] = body.name
    if body.trigger_kind is not None:
        _validate_trigger(body.trigger_kind)
        sets.append("trigger_kind = :tk")
        params["tk"] = body.trigger_kind
    if body.trigger_filter is not None:
        sets.append("trigger_filter = CAST(:tf AS jsonb)")
        params["tf"] = json.dumps(body.trigger_filter)
    if body.action_kind is not None:
        _validate_action(body.action_kind)
        sets.append("action_kind = :ak")
        params["ak"] = body.action_kind
    if body.action_payload is not None:
        sets.append("action_payload = CAST(:ap AS jsonb)")
        params["ap"] = json.dumps(body.action_payload)
    if body.enabled is not None:
        sets.append("enabled = :en")
        params["en"] = bool(body.enabled)
    if not sets:
        raise ValidationFailed("nothing to update")

    await s.execute(
        text(
            f"UPDATE automation_rules SET {', '.join(sets)} "
            "WHERE id = CAST(:id AS uuid)"
        ),
        params,
    )
    await document_repo.insert_audit(
        s, user_id=user["id"], action="automation.update",
        target=f"automation_rule:{rule_id}",
        payload={k: v for k, v in body.model_dump().items() if v is not None},
    )
    await s.commit()
    fresh = await _fetch_one(s, rule_id)
    if not fresh:
        raise NotFound("rule vanished")
    return envelope(data=fresh)


@router.delete(
    "/automation/rules/{rule_id}",
    status_code=204,
    summary="자동화 규칙 삭제 (admin)",
)
async def delete_rule(
    rule_id: str = Path(..., min_length=1),
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_admin),
) -> Response:
    rule = await _fetch_one(s, rule_id)
    if not rule:
        raise NotFound("rule not found")
    await s.execute(
        text("DELETE FROM automation_rules WHERE id = CAST(:id AS uuid)"),
        {"id": rule_id},
    )
    await document_repo.insert_audit(
        s, user_id=user["id"], action="automation.delete",
        target=f"automation_rule:{rule_id}",
        payload={},
    )
    await s.commit()
    return Response(status_code=204)


@router.get(
    "/automation/rules/{rule_id}/runs",
    summary="규칙 실행 로그 (admin, 최근순)",
)
async def list_runs(
    rule_id: str = Path(..., min_length=1),
    limit: int = Query(default=50, ge=1, le=500),
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    rule = await _fetch_one(s, rule_id)
    if not rule:
        raise NotFound("rule not found")
    rows = (await s.execute(
        text(
            """
            SELECT id, triggered_at, trigger_payload, status, error_message
            FROM automation_run_log
            WHERE rule_id = CAST(:r AS uuid)
            ORDER BY triggered_at DESC
            LIMIT :lim
            """
        ),
        {"r": rule_id, "lim": limit},
    )).all()
    items = [
        {
            "id": int(r[0]),
            "triggered_at": r[1].isoformat() if r[1] else None,
            "trigger_payload": _parse_jsonb(r[2]),
            "status": r[3],
            "error_message": r[4],
        }
        for r in rows
    ]
    return envelope(data={"items": items}, meta={"count": len(items)})


@router.post(
    "/automation/rules/{rule_id}/test",
    summary="규칙 1회 실행 (dry_run=True 면 로그 미기록)",
)
async def test_rule(
    body: TestRuleIn | None = Body(default=None),
    rule_id: str = Path(..., min_length=1),
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    rule = await _fetch_one(s, rule_id)
    if not rule:
        raise NotFound("rule not found")
    payload = (body.payload if body else None) or {"event": rule["trigger_kind"], "test": True}
    dry = body.dry_run if body is not None else True
    result = await automation_dispatcher.run_rule(
        s,
        rule=rule,
        trigger_kind=rule["trigger_kind"],
        payload=payload,
        dry_run=bool(dry),
    )
    return envelope(data={"rule_id": rule_id, "dry_run": bool(dry), **result})
