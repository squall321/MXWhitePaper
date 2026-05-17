"""Webhooks 라우터 — 외부 알림(Slack/Discord/Teams/Linear/...) integration.

전체 prefix `/api/v1`. event_kind 는 활동 피드 taxonomy 와 동일한
`doc_edited`, `doc_published`, `comment_added`, `review_decided` 4개 + 향후
`doc_created` 같은 신규 종류로 확장 가능.

엔드포인트:
  - POST   /webhooks                          editor+ (user) | admin (org)
  - GET    /webhooks                          any auth
  - GET    /webhooks/{id}                     owner | admin
  - PATCH  /webhooks/{id}                     owner | admin
  - DELETE /webhooks/{id}                     owner | admin
  - POST   /webhooks/{id}/test                owner | admin
  - GET    /webhooks/{id}/deliveries          owner | admin

`secret` 은 *생성 직후 1회* 평문으로 회신되며, 이후 모든 read 응답에서는
`••••<last4>` 마스킹된다.
"""
from __future__ import annotations

import json
import secrets
from typing import Any

from fastapi import APIRouter, Depends, Path, Query, Response
from pydantic import BaseModel, Field, HttpUrl
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user, require_editor
from app.core.db import get_db
from app.core.errors import APIError, Forbidden, NotFound, envelope
from app.repos import document_repo
from app.services import webhook_dispatcher

router = APIRouter(prefix="/api/v1", tags=["webhooks"])


SUPPORTED_EVENTS: set[str] = {
    "doc_created",
    "doc_edited",
    "doc_published",
    "comment_added",
    "review_decided",
}

VALID_SCOPES: set[str] = {"user", "org"}


class WebhookValidationError(APIError):
    code = "VALIDATION_ERROR"
    http_status = 422


class WebhookCreate(BaseModel):
    url: HttpUrl
    scope: str = Field(default="user")
    events: list[str] = Field(..., min_length=1, max_length=20)
    filter_part_ids: list[str] = Field(default_factory=list, max_length=50)


class WebhookPatch(BaseModel):
    url: HttpUrl | None = None
    events: list[str] | None = Field(default=None, max_length=20)
    filter_part_ids: list[str] | None = Field(default=None, max_length=50)
    enabled: bool | None = None


class TestIn(BaseModel):
    event_kind: str | None = Field(default=None)


def _mask_secret(secret: str) -> str:
    if not secret:
        return ""
    return "•" * 8 + secret[-4:]


def _row_to_dict(row: Any, *, include_secret: bool = False) -> dict[str, Any]:
    events = row[5]
    if isinstance(events, str):
        try:
            events = json.loads(events)
        except json.JSONDecodeError:
            events = []
    if not isinstance(events, list):
        events = []
    parts = row[6]
    if isinstance(parts, str):
        try:
            parts = json.loads(parts)
        except json.JSONDecodeError:
            parts = []
    if not isinstance(parts, list):
        parts = []
    secret_raw = row[4] or ""
    return {
        "id": str(row[0]),
        "owner_user_id": str(row[1]),
        "scope": row[2],
        "url": row[3],
        "secret": secret_raw if include_secret else _mask_secret(secret_raw),
        "events": events,
        "filter_part_ids": parts,
        "enabled": bool(row[7]),
        "last_status": row[8],
        "last_attempted_at": row[9].isoformat() if row[9] else None,
        "created_at": row[10].isoformat() if row[10] else None,
    }


_SELECT_COLS = """
    SELECT id, owner_user_id, scope, url, secret,
           events, filter_part_ids, enabled,
           last_status, last_attempted_at, created_at
    FROM webhooks
"""


def _validate_events(events: list[str]) -> list[str]:
    cleaned: list[str] = []
    seen: set[str] = set()
    for e in events:
        if not isinstance(e, str):
            continue
        v = e.strip()
        if not v or v in seen:
            continue
        if v not in SUPPORTED_EVENTS:
            raise WebhookValidationError(
                f"unsupported event '{v}' — allowed: {sorted(SUPPORTED_EVENTS)}",
                details={"got": v, "allowed": sorted(SUPPORTED_EVENTS)},
            )
        seen.add(v)
        cleaned.append(v)
    if not cleaned:
        raise WebhookValidationError("events list cannot be empty")
    return cleaned


def _validate_part_ids(part_ids: list[str]) -> list[str]:
    out: list[str] = []
    for p in part_ids or []:
        if not isinstance(p, str):
            continue
        v = p.strip()
        if not v:
            continue
        out.append(v)
    return out


async def _fetch_one(s: AsyncSession, hook_id: str) -> dict[str, Any] | None:
    row = (await s.execute(
        text(f"{_SELECT_COLS} WHERE id = CAST(:id AS uuid)"),
        {"id": hook_id},
    )).first()
    if not row:
        return None
    return _row_to_dict(row, include_secret=True)


def _ensure_owner_or_admin(hook: dict[str, Any], user: dict[str, Any]) -> None:
    if user.get("role") == "admin":
        return
    if hook["owner_user_id"] == user["id"]:
        return
    raise Forbidden("only the owner or an admin may access this webhook")


# ── endpoints ────────────────────────────────────────────────────────────


@router.post(
    "/webhooks",
    status_code=201,
    summary="웹훅 등록 (editor+ → user 스코프 / admin → org 스코프)",
)
async def create_webhook(
    body: WebhookCreate,
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_editor),
) -> dict[str, Any]:
    if body.scope not in VALID_SCOPES:
        raise WebhookValidationError(
            f"scope must be one of {sorted(VALID_SCOPES)}",
            details={"got": body.scope},
        )
    if body.scope == "org" and user.get("role") != "admin":
        raise Forbidden("org-scoped webhooks require admin role")

    events = _validate_events(body.events)
    parts = _validate_part_ids(body.filter_part_ids)
    sec = secrets.token_hex(32)  # 32 bytes → 64 hex chars

    row = (await s.execute(
        text("""
            INSERT INTO webhooks
                (owner_user_id, scope, url, secret, events, filter_part_ids)
            VALUES
                (CAST(:u AS uuid), :sc, :url, :secret,
                 CAST(:ev AS jsonb), CAST(:fp AS jsonb))
            RETURNING id
        """),
        {
            "u": user["id"], "sc": body.scope, "url": str(body.url),
            "secret": sec,
            "ev": json.dumps(events),
            "fp": json.dumps(parts),
        },
    )).first()
    assert row is not None  # INSERT...RETURNING always emits one row
    new_id = str(row[0])

    await document_repo.insert_audit(
        s, user_id=user["id"], action="webhook.create",
        target=f"webhook:{new_id}",
        payload={"scope": body.scope, "events": events},
    )
    await s.commit()

    full = await _fetch_one(s, new_id)
    if not full:
        raise NotFound("webhook just created vanished")  # defensive
    # Reveal secret once at create time only.
    return envelope(data={**full, "secret": full["secret"]})


@router.get("/webhooks", summary="웹훅 목록")
async def list_webhooks(
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    if user.get("role") == "admin":
        rows = (await s.execute(
            text(f"{_SELECT_COLS} ORDER BY created_at DESC"),
        )).all()
    else:
        rows = (await s.execute(
            text(f"""
                {_SELECT_COLS}
                WHERE owner_user_id = CAST(:u AS uuid)
                   OR (scope = 'org' AND enabled = TRUE)
                ORDER BY created_at DESC
            """),
            {"u": user["id"]},
        )).all()
    items = [_row_to_dict(r, include_secret=False) for r in rows]
    return envelope(data={"items": items}, meta={"count": len(items)})


@router.get(
    "/webhooks/{hook_id}",
    summary="웹훅 단건 (secret 마스킹)",
)
async def get_webhook(
    hook_id: str = Path(..., min_length=1),
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    hook = await _fetch_one(s, hook_id)
    if not hook:
        raise NotFound("webhook not found")
    _ensure_owner_or_admin(hook, user)
    # Hide the raw secret on read.
    return envelope(data={**hook, "secret": _mask_secret(hook["secret"])})


@router.patch("/webhooks/{hook_id}", summary="웹훅 수정 (owner | admin)")
async def patch_webhook(
    body: WebhookPatch,
    hook_id: str = Path(..., min_length=1),
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    hook = await _fetch_one(s, hook_id)
    if not hook:
        raise NotFound("webhook not found")
    _ensure_owner_or_admin(hook, user)

    sets: list[str] = []
    params: dict[str, Any] = {"id": hook_id}
    if body.url is not None:
        sets.append("url = :url")
        params["url"] = str(body.url)
    if body.events is not None:
        events = _validate_events(body.events)
        sets.append("events = CAST(:ev AS jsonb)")
        params["ev"] = json.dumps(events)
    if body.filter_part_ids is not None:
        parts = _validate_part_ids(body.filter_part_ids)
        sets.append("filter_part_ids = CAST(:fp AS jsonb)")
        params["fp"] = json.dumps(parts)
    if body.enabled is not None:
        sets.append("enabled = :en")
        params["en"] = bool(body.enabled)
    if not sets:
        raise WebhookValidationError("nothing to update")

    await s.execute(
        text(f"UPDATE webhooks SET {', '.join(sets)} WHERE id = CAST(:id AS uuid)"),
        params,
    )
    await document_repo.insert_audit(
        s, user_id=user["id"], action="webhook.update",
        target=f"webhook:{hook_id}",
        payload={k: v for k, v in body.model_dump().items() if v is not None},
    )
    await s.commit()

    updated = await _fetch_one(s, hook_id)
    if not updated:
        raise NotFound("webhook vanished")
    return envelope(data={**updated, "secret": _mask_secret(updated["secret"])})


@router.delete(
    "/webhooks/{hook_id}",
    status_code=204,
    summary="웹훅 삭제 (owner | admin)",
)
async def delete_webhook(
    hook_id: str = Path(..., min_length=1),
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(get_current_user),
) -> Response:
    hook = await _fetch_one(s, hook_id)
    if not hook:
        raise NotFound("webhook not found")
    _ensure_owner_or_admin(hook, user)
    await s.execute(
        text("DELETE FROM webhooks WHERE id = CAST(:id AS uuid)"),
        {"id": hook_id},
    )
    await document_repo.insert_audit(
        s, user_id=user["id"], action="webhook.delete",
        target=f"webhook:{hook_id}",
        payload={},
    )
    await s.commit()
    return Response(status_code=204)


@router.post(
    "/webhooks/{hook_id}/test",
    summary="테스트 페이로드 1회 전송 (owner | admin)",
)
async def test_webhook(
    body: TestIn | None = None,
    hook_id: str = Path(..., min_length=1),
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    hook = await _fetch_one(s, hook_id)
    if not hook:
        raise NotFound("webhook not found")
    _ensure_owner_or_admin(hook, user)
    event_kind = (body.event_kind if body else None) or "doc_edited"
    if event_kind not in SUPPORTED_EVENTS:
        raise WebhookValidationError(
            f"unsupported event '{event_kind}'",
            details={"allowed": sorted(SUPPORTED_EVENTS)},
        )
    payload = {
        "event": event_kind,
        "test": True,
        "from_user_id": user["id"],
        "message": "MX White Paper webhook test delivery.",
    }
    result = await webhook_dispatcher.deliver_sync(hook, event_kind, payload)
    return envelope(data={"webhook_id": hook_id, **result})


@router.get(
    "/webhooks/{hook_id}/deliveries",
    summary="최근 전송 로그 (owner | admin)",
)
async def list_deliveries(
    hook_id: str = Path(..., min_length=1),
    limit: int = Query(default=20, ge=1, le=100),
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    hook = await _fetch_one(s, hook_id)
    if not hook:
        raise NotFound("webhook not found")
    _ensure_owner_or_admin(hook, user)
    rows = (await s.execute(
        text("""
            SELECT id, event_kind, http_status, response_body,
                   attempted_at, retry_count
            FROM webhook_deliveries
            WHERE webhook_id = CAST(:wid AS uuid)
            ORDER BY attempted_at DESC
            LIMIT :lim
        """),
        {"wid": hook_id, "lim": limit},
    )).all()
    items = [
        {
            "id": str(r[0]),
            "event_kind": r[1],
            "http_status": r[2],
            "response_body": r[3],
            "attempted_at": r[4].isoformat() if r[4] else None,
            "retry_count": int(r[5]),
        }
        for r in rows
    ]
    return envelope(data={"items": items}, meta={"count": len(items)})
