"""유저 검색 라우터 (Polish D).

owner / reviewer 자동완성용. editor 이상만 호출 가능하다.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import require_editor
from app.core.db import get_db
from app.core.errors import envelope
from app.repos import document_repo

router = APIRouter(prefix="/api/v1/users", tags=["users"])


@router.get(
    "/search",
    summary="유저 검색 (owner/reviewer 자동완성)",
    description=(
        "이름 또는 이메일에 대한 부분 일치 검색. editor 이상 권한 필요.\n\n"
        "응답 항목: `{id, email, name, role}` — `metadata.owners` 에 email 또는 UUID 를 넣으면 자동 매칭된다."
    ),
)
async def search_users(
    q: str = Query(..., min_length=1, max_length=100, description="이름 또는 이메일 부분 검색어"),
    limit: int = Query(default=20, ge=1, le=50),
    s: AsyncSession = Depends(get_db),
    _user: dict = Depends(require_editor),
) -> dict[str, Any]:
    items = await document_repo.search_users(s, q, limit=limit)
    return envelope(data=items, meta={"count": len(items)})
