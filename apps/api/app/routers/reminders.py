"""Reminders 라우터 — 시간 기반 알림 (Cycle 0028).

Endpoints (모두 `/api/v1` prefix):

  - POST   /documents/{slug}/reminders          (reader+) → 201
        Body: { remind_at: ISO8601, message?: str }
        해당 문서에 대한 ping 을 `remind_at` 시점에 받기로 예약한다.

  - GET    /me/reminders?include_fired=false    (reader+) → list
        본인의 reminder 목록을 `remind_at` 오름차순으로 회신.
        include_fired=false (기본) 면 아직 발화하지 않은 행만, true 면 전체.

  - DELETE /reminders/{id}                      (the user) → 204
  - PATCH  /reminders/{id}                      (the user) → 200
        Body: { remind_at?: ISO8601, message?: str|null }

쓰기 모두 audit_logs 에 기록한다. 발화 시점 알림은 `reminder_runner`(asyncio
ticker) 가 `notifications` 테이블로 fan-out 한다.
"""
from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, Path, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user, require_reader
from app.core.db import get_db
from app.core.errors import Forbidden, NotFound, ValidationFailed, envelope
from app.repos import document_repo

router = APIRouter(prefix="/api/v1", tags=["reminders"])


_UUID_LEN = 36
_UUID_DASHES = 4
_MAX_MESSAGE_LEN = 500


def _is_uuid(s: str) -> bool:
    return isinstance(s, str) and len(s) == _UUID_LEN and s.count("-") == _UUID_DASHES


def _parse_remind_at(raw: Any) -> datetime:
    """Accept ISO8601 strings (with or without trailing 'Z') and aware datetimes.

    Raises ValidationFailed (422) if unparseable. Naive datetimes are treated
    as UTC for forward-compat with FE pickers that drop the offset.
    """
    if isinstance(raw, datetime):
        dt = raw
    elif isinstance(raw, str):
        s = raw.strip()
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        try:
            dt = datetime.fromisoformat(s)
        except ValueError as e:
            raise ValidationFailed(
                "remind_at must be ISO8601 (e.g. 2026-05-09T15:00:00Z)",
                details={"got": raw},
            ) from e
    else:
        raise ValidationFailed(
            "remind_at must be a datetime string",
            details={"got": raw},
        )
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt


def _normalise_message(v: Any) -> str | None:
    if v is None:
        return None
    if not isinstance(v, str):
        raise ValidationFailed("message must be a string or null")
    s = v.strip()
    if not s:
        return None
    if len(s) > _MAX_MESSAGE_LEN:
        raise ValidationFailed(
            f"message exceeds {_MAX_MESSAGE_LEN} chars",
            details={"max": _MAX_MESSAGE_LEN, "got": len(s)},
        )
    return s


def _row_to_dict(row: Any, *, slug: str | None = None, title: str | None = None) -> dict[str, Any]:
    return {
        "id": str(row[0]),
        "user_id": str(row[1]),
        "document_id": str(row[2]),
        "slug": slug,
        "title": title,
        "message": row[3],
        "remind_at": row[4].isoformat() if row[4] else None,
        "fired_at": row[5].isoformat() if row[5] else None,
        "created_at": row[6].isoformat() if row[6] else None,
    }


class CreateReminderIn(BaseModel):
    remind_at: str = Field(..., description="ISO8601 timestamp (UTC if no offset)")
    message: str | None = Field(default=None, max_length=_MAX_MESSAGE_LEN)


class PatchReminderIn(BaseModel):
    remind_at: str | None = Field(default=None)
    message: str | None = Field(default=None)


# ── POST /documents/{slug}/reminders ─────────────────────────────────────


@router.post(
    "/documents/{slug}/reminders",
    status_code=201,
    summary="문서 리마인더 예약 (reader+)",
)
async def create_reminder(
    body: CreateReminderIn,
    slug: str = Path(..., min_length=1),
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_reader),
) -> dict[str, Any]:
    doc = await document_repo.find_by_slug(s, slug)
    if not doc:
        raise NotFound(f"document not found: {slug}")
    remind_at = _parse_remind_at(body.remind_at)
    message = _normalise_message(body.message)

    row = (await s.execute(
        text(
            """
            INSERT INTO reminders (user_id, document_id, message, remind_at)
            VALUES (CAST(:u AS uuid), CAST(:d AS uuid), :m, :ra)
            RETURNING id, user_id, document_id, message, remind_at,
                      fired_at, created_at
            """
        ),
        {"u": user["id"], "d": doc["id"], "m": message, "ra": remind_at},
    )).first()
    assert row is not None  # INSERT...RETURNING always emits one row
    rid = str(row[0])
    await document_repo.insert_audit(
        s,
        user_id=user["id"],
        action="reminder.create",
        target=f"reminders/{rid}",
        payload={"document_id": doc["id"], "remind_at": remind_at.isoformat()},
    )
    await s.commit()
    return envelope(data=_row_to_dict(row, slug=slug, title=doc.get("title")))


# ── GET /me/reminders ────────────────────────────────────────────────────


@router.get(
    "/me/reminders",
    summary="내 리마인더 목록 (reader+)",
)
async def list_my_reminders(
    include_fired: bool = Query(default=False),
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_reader),
) -> dict[str, Any]:
    where = "r.user_id = CAST(:u AS uuid)"
    if not include_fired:
        where += " AND r.fired_at IS NULL"
    rows = (await s.execute(
        text(
            f"""
            SELECT r.id, r.user_id, r.document_id, r.message, r.remind_at,
                   r.fired_at, r.created_at, d.slug, d.title
            FROM reminders r
            JOIN documents d ON d.id = r.document_id
            WHERE {where}
            ORDER BY r.remind_at ASC
            """
        ),
        {"u": user["id"]},
    )).all()
    items = [
        _row_to_dict(r, slug=r[7], title=r[8]) for r in rows
    ]
    return envelope(data={"items": items}, meta={"count": len(items)})


# ── DELETE /reminders/{id} ───────────────────────────────────────────────


@router.delete(
    "/reminders/{rid}",
    summary="리마인더 삭제 (본인)",
)
async def delete_reminder(
    rid: str = Path(..., min_length=1),
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(get_current_user),
) -> Response:
    if not _is_uuid(rid):
        raise NotFound("reminder not found")
    row = (await s.execute(
        text("SELECT user_id FROM reminders WHERE id = CAST(:id AS uuid)"),
        {"id": rid},
    )).first()
    if not row:
        raise NotFound("reminder not found")
    if str(row[0]) != user["id"] and user.get("role") != "admin":
        raise Forbidden("Only the owner may delete this reminder")
    await s.execute(
        text("DELETE FROM reminders WHERE id = CAST(:id AS uuid)"),
        {"id": rid},
    )
    await document_repo.insert_audit(
        s,
        user_id=user["id"],
        action="reminder.delete",
        target=f"reminders/{rid}",
        payload={},
    )
    await s.commit()
    return Response(status_code=204)


# ── PATCH /reminders/{id} ────────────────────────────────────────────────


@router.patch(
    "/reminders/{rid}",
    summary="리마인더 수정 (본인)",
)
async def patch_reminder(
    body: PatchReminderIn,
    rid: str = Path(..., min_length=1),
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    if not _is_uuid(rid):
        raise NotFound("reminder not found")
    row = (await s.execute(
        text(
            """
            SELECT id, user_id, document_id, message, remind_at,
                   fired_at, created_at
            FROM reminders WHERE id = CAST(:id AS uuid)
            """
        ),
        {"id": rid},
    )).first()
    if not row:
        raise NotFound("reminder not found")
    if str(row[1]) != user["id"] and user.get("role") != "admin":
        raise Forbidden("Only the owner may edit this reminder")

    fields = body.model_dump(exclude_unset=True)
    sets: list[str] = []
    params: dict[str, Any] = {"id": rid}
    if "remind_at" in fields and fields["remind_at"] is not None:
        ra = _parse_remind_at(fields["remind_at"])
        sets.append("remind_at = :ra")
        params["ra"] = ra
    if "message" in fields:
        msg = _normalise_message(fields["message"])
        sets.append("message = :m")
        params["m"] = msg
    if not sets:
        raise ValidationFailed("nothing to update")

    full = (await s.execute(
        text(
            f"""
            UPDATE reminders SET {", ".join(sets)}
            WHERE id = CAST(:id AS uuid)
            RETURNING id, user_id, document_id, message, remind_at,
                      fired_at, created_at
            """
        ),
        params,
    )).first()
    assert full is not None  # existence verified above at line 256
    # Look up slug+title for response parity with list endpoint.
    doc_row = (await s.execute(
        text("SELECT slug, title FROM documents WHERE id = CAST(:d AS uuid)"),
        {"d": str(full[2])},
    )).first()
    slug = doc_row[0] if doc_row else None
    title = doc_row[1] if doc_row else None

    await document_repo.insert_audit(
        s,
        user_id=user["id"],
        action="reminder.update",
        target=f"reminders/{rid}",
        payload={k: (v.isoformat() if hasattr(v, "isoformat") else v)
                 for k, v in fields.items()},
    )
    await s.commit()
    return envelope(data=_row_to_dict(full, slug=slug, title=title))
