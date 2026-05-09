"""Subscriptions 라우터 — 문서 팔로우 + 다이제스트 (Cycle 0018).

Endpoints (all prefixed `/api/v1`):

  - POST   /documents/{slug}/subscribe              (reader+)
        Body: { events?: [str], digest_cadence?: 'instant'|'daily'|'weekly' }
        Idempotent: 이미 구독 중이면 PATCH 취급 — 같은 row 의 events / cadence 를
        업데이트한다. 201 / 200 둘 다 반환할 수 있도록 status_code=201 로 통일.

  - DELETE /documents/{slug}/subscribe              (the user themselves) → 204

  - GET    /documents/{slug}/subscribers            (editor+)
        구독자 명단 + cadence + events.

  - GET    /me/subscriptions                        (reader+)
        내가 팔로우 중인 문서 목록 (slug, title, last_edited_at, events, cadence).

  - PATCH  /subscriptions/{id}                      (the user)
        events / digest_cadence 부분 수정.

쓰기 모두 audit_logs 에 기록한다.
"""
from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, Path, Response
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user, require_editor, require_reader
from app.core.db import get_db
from app.core.errors import Forbidden, NotFound, ValidationFailed, envelope
from app.repos import document_repo

router = APIRouter(prefix="/api/v1", tags=["subscriptions"])


VALID_EVENTS: set[str] = {
    "doc_edited",
    "comment_added",
    "review_decided",
    "doc_published",
}

VALID_CADENCES: set[str] = {"instant", "daily", "weekly"}

DEFAULT_EVENTS: list[str] = [
    "doc_edited",
    "comment_added",
    "review_decided",
    "doc_published",
]


class SubscribeIn(BaseModel):
    events: list[str] | None = Field(default=None)
    digest_cadence: str | None = Field(default=None)


class PatchSubscriptionIn(SubscribeIn):
    pass


def _normalise_events(v: list[str] | None) -> list[str] | None:
    """Validate + dedupe (preserving order). Raises 422 via ValidationFailed."""
    if v is None:
        return None
    bad = [e for e in v if e not in VALID_EVENTS]
    if bad:
        raise ValidationFailed(
            f"unknown events: {bad}",
            details={"valid": sorted(VALID_EVENTS), "got": v},
        )
    seen: set[str] = set()
    out: list[str] = []
    for e in v:
        if e not in seen:
            seen.add(e)
            out.append(e)
    return out


def _normalise_cadence(v: str | None) -> str | None:
    if v is None:
        return None
    if v not in VALID_CADENCES:
        raise ValidationFailed(
            f"digest_cadence must be one of {sorted(VALID_CADENCES)}",
            details={"got": v},
        )
    return v


_UUID_LEN = 36
_UUID_DASHES = 4


def _is_uuid(s: str) -> bool:
    return isinstance(s, str) and len(s) == _UUID_LEN and s.count("-") == _UUID_DASHES


async def _require_doc_id(s: AsyncSession, slug: str) -> str:
    doc = await document_repo.find_by_slug(s, slug)
    if not doc:
        raise NotFound(f"document not found: {slug}")
    return doc["id"]


def _row_to_dict(row: Any) -> dict[str, Any]:
    events = row[3]
    if isinstance(events, str):
        try:
            events = json.loads(events)
        except json.JSONDecodeError:
            events = []
    if not isinstance(events, list):
        events = []
    return {
        "id": str(row[0]),
        "user_id": str(row[1]),
        "document_id": str(row[2]),
        "events": events,
        "digest_cadence": row[4],
        "last_digest_at": row[5].isoformat() if row[5] else None,
        "created_at": row[6].isoformat() if row[6] else None,
    }


# ── POST /documents/{slug}/subscribe ─────────────────────────────────────


@router.post(
    "/documents/{slug}/subscribe",
    status_code=201,
    summary="문서 구독 (reader+) — 이미 구독 중이면 events/cadence 업데이트",
)
async def subscribe(
    body: SubscribeIn,
    slug: str = Path(..., min_length=1),
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_reader),
) -> dict[str, Any]:
    doc_id = await _require_doc_id(s, slug)
    events = _normalise_events(body.events) if body.events is not None else DEFAULT_EVENTS
    cadence = _normalise_cadence(body.digest_cadence) or "instant"

    row = (await s.execute(
        text("""
            INSERT INTO subscriptions
              (user_id, document_id, events, digest_cadence)
            VALUES
              (CAST(:u AS uuid), CAST(:d AS uuid),
               CAST(:ev AS jsonb), :cad)
            ON CONFLICT (user_id, document_id) DO UPDATE
              SET events = EXCLUDED.events,
                  digest_cadence = EXCLUDED.digest_cadence
            RETURNING id
        """),
        {
            "u": user["id"],
            "d": doc_id,
            "ev": json.dumps(events),
            "cad": cadence,
        },
    )).first()
    sub_id = str(row[0])
    await document_repo.insert_audit(
        s,
        user_id=user["id"],
        action="subscription.create",
        target=f"subscriptions/{sub_id}",
        payload={"document_id": doc_id, "cadence": cadence},
    )
    await s.commit()
    return envelope(data={"subscription_id": sub_id})


# ── DELETE /documents/{slug}/subscribe ───────────────────────────────────


@router.delete(
    "/documents/{slug}/subscribe",
    summary="문서 구독 해제 (본인)",
)
async def unsubscribe(
    slug: str = Path(..., min_length=1),
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_reader),
) -> Response:
    doc_id = await _require_doc_id(s, slug)
    res = await s.execute(
        text("""
            DELETE FROM subscriptions
            WHERE user_id = CAST(:u AS uuid)
              AND document_id = CAST(:d AS uuid)
        """),
        {"u": user["id"], "d": doc_id},
    )
    if (res.rowcount or 0) == 0:
        # nothing to delete — return 204 anyway so the FE can hit it idempotently
        return Response(status_code=204)
    await document_repo.insert_audit(
        s,
        user_id=user["id"],
        action="subscription.delete",
        target=f"document:{slug}",
        payload={"document_id": doc_id},
    )
    await s.commit()
    return Response(status_code=204)


# ── GET /documents/{slug}/subscribers ────────────────────────────────────


@router.get(
    "/documents/{slug}/subscribers",
    summary="구독자 목록 (editor+)",
)
async def list_subscribers(
    slug: str = Path(..., min_length=1),
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_editor),
) -> dict[str, Any]:
    _ = user
    doc_id = await _require_doc_id(s, slug)
    rows = (await s.execute(
        text("""
            SELECT s.id, s.user_id, u.name, u.email,
                   s.events, s.digest_cadence, s.created_at
            FROM subscriptions s
            JOIN users u ON u.id = s.user_id
            WHERE s.document_id = CAST(:d AS uuid)
            ORDER BY s.created_at ASC
        """),
        {"d": doc_id},
    )).all()
    items: list[dict[str, Any]] = []
    for r in rows:
        ev = r[4]
        if isinstance(ev, str):
            try:
                ev = json.loads(ev)
            except json.JSONDecodeError:
                ev = []
        items.append({
            "subscription_id": str(r[0]),
            "user_id": str(r[1]),
            "name": r[2],
            "email": r[3],
            "events": ev if isinstance(ev, list) else [],
            "digest_cadence": r[5],
            "created_at": r[6].isoformat() if r[6] else None,
        })
    return envelope(data={"items": items}, meta={"count": len(items)})


# ── GET /me/subscriptions ────────────────────────────────────────────────


@router.get(
    "/me/subscriptions",
    summary="내가 팔로우 중인 문서",
)
async def list_my_subscriptions(
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_reader),
) -> dict[str, Any]:
    rows = (await s.execute(
        text("""
            SELECT s.id, s.document_id, d.slug, d.title, d.updated_at,
                   s.events, s.digest_cadence, s.last_digest_at, s.created_at
            FROM subscriptions s
            JOIN documents d ON d.id = s.document_id
            WHERE s.user_id = CAST(:u AS uuid)
              AND d.status != 'archived'
            ORDER BY s.created_at DESC
        """),
        {"u": user["id"]},
    )).all()
    items: list[dict[str, Any]] = []
    for r in rows:
        ev = r[5]
        if isinstance(ev, str):
            try:
                ev = json.loads(ev)
            except json.JSONDecodeError:
                ev = []
        items.append({
            "subscription_id": str(r[0]),
            "document_id": str(r[1]),
            "slug": r[2],
            "title": r[3],
            "last_edited_at": r[4].isoformat() if r[4] else None,
            "events": ev if isinstance(ev, list) else [],
            "digest_cadence": r[6],
            "last_digest_at": r[7].isoformat() if r[7] else None,
            "created_at": r[8].isoformat() if r[8] else None,
        })
    return envelope(data={"items": items}, meta={"count": len(items)})


# ── PATCH /subscriptions/{id} ────────────────────────────────────────────


@router.patch(
    "/subscriptions/{sid}",
    summary="구독 설정 수정 (본인)",
)
async def patch_subscription(
    body: PatchSubscriptionIn,
    sid: str = Path(..., min_length=1),
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    if not _is_uuid(sid):
        raise NotFound("subscription not found")
    row = (await s.execute(
        text("""
            SELECT id, user_id, document_id, events, digest_cadence,
                   last_digest_at, created_at
            FROM subscriptions
            WHERE id = CAST(:id AS uuid)
        """),
        {"id": sid},
    )).first()
    if not row:
        raise NotFound("subscription not found")
    if str(row[1]) != user["id"] and user.get("role") != "admin":
        raise Forbidden("Only the subscriber may edit this subscription")

    fields = body.model_dump(exclude_unset=True)
    if not fields:
        raise ValidationFailed("nothing to update")

    sets: list[str] = []
    params: dict[str, Any] = {"id": sid}
    if "events" in fields and fields["events"] is not None:
        events = _normalise_events(fields["events"])
        sets.append("events = CAST(:ev AS jsonb)")
        params["ev"] = json.dumps(events)
    if "digest_cadence" in fields and fields["digest_cadence"] is not None:
        cad = _normalise_cadence(fields["digest_cadence"])
        sets.append("digest_cadence = :cad")
        params["cad"] = cad
    if not sets:
        raise ValidationFailed("nothing to update")

    full = (await s.execute(
        text(f"""
            UPDATE subscriptions SET {', '.join(sets)}
            WHERE id = CAST(:id AS uuid)
            RETURNING id, user_id, document_id, events, digest_cadence,
                      last_digest_at, created_at
        """),
        params,
    )).first()

    await document_repo.insert_audit(
        s,
        user_id=user["id"],
        action="subscription.update",
        target=f"subscriptions/{sid}",
        payload={k: v for k, v in fields.items() if v is not None},
    )
    await s.commit()
    return envelope(data=_row_to_dict(full))
