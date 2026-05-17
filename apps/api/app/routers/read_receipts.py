"""Read receipts router — surface who has actually read a document (Cycle 0023).

`document_reads` (cycle 4) already stores implicit reads (heartbeat-flushed
read_seconds + last read_at). `read_acks` (cycle 23) adds the *explicit*
"확인했어요" button. This router exposes both:

  - POST /api/v1/documents/{slug}/ack-read       (reader+) → 201
        Idempotent — second call updates `acknowledged_at` + comment.
  - GET  /api/v1/documents/{slug}/read-receipts  (editor+) → joined readers

Auth model:
  - Ack endpoint is reader+ — anyone authorised to view the doc may ack.
  - Receipts list is editor+ — outreach data is private to the doc author /
    reviewers / admins. We deliberately do *not* gate on per-doc ownership;
    the existing reviewers list (`/documents/{slug}/reviewers`) already uses
    role-only gating.
"""
from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, Path
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import require_editor, require_reader
from app.core.db import get_db
from app.core.errors import NotFound, ValidationFailed, envelope
from app.repos import document_repo
from app.services import notification_prefs as prefs_svc

router = APIRouter(prefix="/api/v1", tags=["read-receipts"])


class AckReadIn(BaseModel):
    comment: str | None = Field(default=None, max_length=2000)


class RemindIn(BaseModel):
    user_id: str = Field(..., min_length=1)


async def _require_doc(s: AsyncSession, slug: str) -> dict[str, Any]:
    doc = await document_repo.find_by_slug(s, slug)
    if not doc:
        raise NotFound(f"document not found: {slug}")
    return doc


@router.post(
    "/documents/{slug}/ack-read",
    status_code=201,
    summary="문서 읽음 확인 (reader+, idempotent)",
)
async def ack_read(
    body: AckReadIn,
    slug: str = Path(..., min_length=1),
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_reader),
) -> dict[str, Any]:
    doc = await _require_doc(s, slug)
    row = (await s.execute(
        text("""
            INSERT INTO read_acks (user_id, document_id, comment)
            VALUES (CAST(:u AS uuid), CAST(:d AS uuid), :c)
            ON CONFLICT (user_id, document_id) DO UPDATE
              SET acknowledged_at = NOW(),
                  comment = EXCLUDED.comment
            RETURNING id, acknowledged_at, comment
        """),
        {"u": user["id"], "d": doc["id"], "c": body.comment},
    )).first()
    assert row is not None  # INSERT...ON CONFLICT DO UPDATE always returns a row
    await s.commit()
    return envelope(data={
        "id": str(row[0]),
        "document_id": doc["id"],
        "slug": doc["slug"],
        "acknowledged_at": row[1].isoformat() if row[1] else None,
        "comment": row[2],
    })


@router.get(
    "/documents/{slug}/read-receipts",
    summary="문서 독자 목록 (editor+) — implicit reads + explicit acks 머지",
)
async def list_read_receipts(
    slug: str = Path(..., min_length=1),
    s: AsyncSession = Depends(get_db),
    _user: dict[str, Any] = Depends(require_editor),
) -> dict[str, Any]:
    doc = await _require_doc(s, slug)
    # FULL OUTER JOIN so a reader who *only* explicitly acked (without ever
    # firing a heartbeat) still shows up, and vice versa.
    rows = (await s.execute(
        text("""
            SELECT
              COALESCE(r.user_id, a.user_id)         AS user_id,
              u.name                                  AS name,
              u.email                                 AS email,
              r.read_at                               AS last_read_at,
              r.read_seconds                          AS read_seconds,
              a.acknowledged_at                       AS acknowledged_at,
              a.comment                               AS ack_comment
            FROM document_reads r
            FULL OUTER JOIN read_acks a
              ON a.user_id = r.user_id
             AND a.document_id = r.document_id
            LEFT JOIN users u
              ON u.id = COALESCE(r.user_id, a.user_id)
            WHERE COALESCE(r.document_id, a.document_id)
                  = CAST(:d AS uuid)
            ORDER BY
              COALESCE(a.acknowledged_at, r.read_at) DESC NULLS LAST
        """),
        {"d": doc["id"]},
    )).all()
    readers = [
        {
            "user_id": str(row[0]) if row[0] else None,
            "name": row[1],
            "email": row[2],
            "last_read_at": row[3].isoformat() if row[3] else None,
            "read_seconds": int(row[4]) if row[4] is not None else 0,
            "acknowledged_at": row[5].isoformat() if row[5] else None,
            "comment": row[6],
        }
        for row in rows
        if row[0] is not None
    ]
    return envelope(
        data={"readers": readers},
        meta={
            "count": len(readers),
            "ack_count": sum(1 for r in readers if r["acknowledged_at"]),
        },
    )


@router.post(
    "/documents/{slug}/read-receipts/remind",
    status_code=201,
    summary="특정 사용자에게 읽음 확인 리마인더 알림 (editor+)",
)
async def remind_user_to_ack(
    body: RemindIn,
    slug: str = Path(..., min_length=1),
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_editor),
) -> dict[str, Any]:
    """Inserts a single `read_ack_reminder` notification for the target user.

    Honours the recipient's in-app channel preference (silent no-op when off).
    Self-poke is rejected — clicking your own row is meaningless.
    """
    doc = await _require_doc(s, slug)
    if body.user_id == user["id"]:
        raise ValidationFailed("cannot remind yourself")
    target = (await s.execute(
        text(
            "SELECT 1 FROM users WHERE id = CAST(:u AS uuid) AND is_active = TRUE"
        ),
        {"u": body.user_id},
    )).first()
    if not target:
        raise NotFound("target user not found or inactive")

    notified = False
    if await prefs_svc.is_channel_enabled(
        s,
        user_id=body.user_id,
        kind="read_ack_reminder",
        channel="in_app",
    ):
        await s.execute(
            text("""
                INSERT INTO notifications (user_id, kind, payload)
                VALUES (CAST(:u AS uuid), 'read_ack_reminder', CAST(:p AS jsonb))
            """),
            {
                "u": body.user_id,
                "p": json.dumps({
                    "document_id": doc["id"],
                    "slug": doc["slug"],
                    "title": doc["title"],
                    "from_user_id": user["id"],
                }),
            },
        )
        notified = True
    await s.commit()
    return envelope(data={
        "slug": doc["slug"],
        "user_id": body.user_id,
        "notified": notified,
    })
