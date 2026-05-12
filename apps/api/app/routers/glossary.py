"""용어집 라우터 (Sprint 6).

GET /api/v1/glossary?q=&limit= → {data:[{term, definition, related_doc_count}], meta:{total}}

Sprint 0 의 `terms` 테이블을 사용한다. document_service.upsert_glossary_terms
가 문서 저장 부수 효과로 행을 누적한다.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.core.errors import envelope

router = APIRouter(prefix="/api/v1", tags=["glossary"])


@router.get("/glossary/term/{term}")
async def get_term(
    term: str,
    s: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Single-term lookup for the `glossary-ref` block renderer."""
    row = (await s.execute(
        text("SELECT term, definition, COALESCE(array_length(related_docs,1),0) "
             "FROM terms WHERE term = :term"),
        {"term": term},
    )).first()
    if not row:
        raise HTTPException(404, detail={
            "error": "term_not_found",
            "term": term,
            "hint": "Run `python -m app.scripts.seed_glossary` to populate the terms table.",
        })
    return envelope(
        data={"term": row[0], "definition": row[1], "related_doc_count": int(row[2] or 0)},
        meta={"source": "terms"},
    )


@router.get("/glossary")
async def list_glossary(
    q: str | None = Query(default=None, description="term ILIKE %q% 검색"),
    limit: int = Query(default=50, ge=1, le=200),
    s: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    where = ""
    params: dict[str, Any] = {"lim": limit}
    if q and q.strip():
        where = "WHERE term ILIKE :q"
        params["q"] = f"%{q.strip()}%"

    rows = (await s.execute(
        text(f"""
            SELECT term, definition, COALESCE(array_length(related_docs, 1), 0)
            FROM terms
            {where}
            ORDER BY term
            LIMIT :lim
        """),
        params,
    )).all()

    items = [
        {"term": r[0], "definition": r[1], "related_doc_count": int(r[2] or 0)}
        for r in rows
    ]
    return envelope(data=items, meta={"total": len(items), "limit": limit, "q": q})
