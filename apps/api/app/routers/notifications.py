"""Notifications 라우터 — 멘션 등 BE 푸시 알림 조회/읽음 처리.

  - GET   /api/v1/notifications?unread=true&limit=20
  - POST  /api/v1/notifications/:id/read

기존의 클라이언트 측 localStorage notifications store 와는 별개로, 멘션처럼
크로스-디바이스 보존이 필요한 알림만 DB 에 둔다.
"""
from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.db import get_db
from app.core.errors import NotFound, envelope
from app.wiki import audience

router = APIRouter(prefix="/api/v1/notifications", tags=["notifications"])


def _row_to_dict(row: Any) -> dict[str, Any]:
    payload = row[3]
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except json.JSONDecodeError:
            payload = {}
    return {
        "id": str(row[0]),
        "user_id": str(row[1]),
        "kind": row[2],
        "payload": payload or {},
        "read_at": row[4].isoformat() if row[4] else None,
        "created_at": row[5].isoformat() if row[5] else None,
    }


_VISIBLE_PAYLOAD_DOC = audience.slug_visible_sql("(notifications.payload->>'slug')", "_ns")


@router.get(
    "",
    summary="내 알림 목록 — 최신순",
)
async def list_notifications(
    unread: bool = Query(default=False, description="True 면 read_at IS NULL 만"),
    limit: int = Query(default=20, ge=1, le=100),
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    # 알림은 만들 때의 제목을 payload 에 담는다 — 지금 그 문서를 볼 수 없으면(범위가 좁아짐 · 처음부터 범위 밖 멘션)
    # 읽을 때 뺀다. 생산자 아홉 곳을 하나씩 막는 대신 여기 한 곳에서(docs/llm-wiki W2).
    where = ["user_id = CAST(:uid AS uuid)", _VISIBLE_PAYLOAD_DOC]
    if unread:
        where.append("read_at IS NULL")
    rows = (await s.execute(
        text(f"""
            SELECT id, user_id, kind, payload, read_at, created_at
            FROM notifications
            WHERE {' AND '.join(where)}
            ORDER BY created_at DESC
            LIMIT :lim
        """),
        {"uid": user["id"], "lim": limit, **audience.sql_params()},
    )).all()
    items = [_row_to_dict(r) for r in rows]

    unread_count = (await s.execute(
        text(f"""
            SELECT COUNT(*) FROM notifications
            WHERE user_id = CAST(:uid AS uuid) AND read_at IS NULL AND {_VISIBLE_PAYLOAD_DOC}
        """),
        {"uid": user["id"], **audience.sql_params()},
    )).scalar_one()

    return envelope(
        data=items,
        meta={"count": len(items), "unread": int(unread_count or 0)},
    )


@router.post(
    "/{nid}/read",
    summary="알림 읽음 처리",
)
async def mark_read(
    nid: str,
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(get_current_user),
) -> Response:
    row = (await s.execute(
        text("""
            SELECT user_id FROM notifications
            WHERE id = CAST(:id AS uuid)
        """),
        {"id": nid},
    )).first()
    if not row:
        raise NotFound("notification not found")
    if str(row[0]) != user["id"]:
        # 남의 알림은 존재 여부도 흘리지 않는다.
        raise NotFound("notification not found")
    await s.execute(
        text("""
            UPDATE notifications SET read_at = NOW()
            WHERE id = CAST(:id AS uuid) AND read_at IS NULL
        """),
        {"id": nid},
    )
    await s.commit()
    return Response(status_code=204)
