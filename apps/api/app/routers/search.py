"""검색 라우터 (Sprint 6).

GET /api/v1/search?q=&limit=&team=&part=&tag=&confidentiality=
  → {data: [{slug, title, summary, _formatted:{title, summary}}, …],
     meta: {total, took_ms}}
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query

from app.core.errors import envelope
from app.search import meili_indexer

router = APIRouter(prefix="/api/v1", tags=["search"])


@router.get("/search")
async def search(
    q: str = Query(default="", description="검색 쿼리 (빈 값 허용)"),
    limit: int = Query(default=20, ge=1, le=100),
    team: str | None = Query(default=None),
    part: str | None = Query(default=None),
    tag: str | None = Query(default=None),
    confidentiality: str | None = Query(default=None),
) -> dict[str, Any]:
    filters: dict[str, str] = {}
    if team:
        filters["team_slug"] = team
    if part:
        filters["part_slug"] = part
    if tag:
        # tags 는 array 필드. Meilisearch 는 `tags = "x"` 도 array contains 처리.
        filters["tags"] = tag
    if confidentiality:
        filters["confidentiality"] = confidentiality

    try:
        result = meili_indexer.search(q=q, limit=limit, filters=filters)
    except Exception as e:
        # 검색 인덱스 장애 시에도 200 + 빈 결과로 fallback (FE 가 죽지 않도록)
        return envelope(
            data=[],
            meta={"total": 0, "took_ms": 0, "error": str(e)},
        )

    hits = result.get("hits", []) if isinstance(result, dict) else []
    items = [
        {
            "slug": h.get("slug"),
            "title": h.get("title"),
            "summary": h.get("summary"),
            "tags": h.get("tags", []),
            "team_slug": h.get("team_slug"),
            "part_slug": h.get("part_slug"),
            "_formatted": (h.get("_formatted") or {}),
        }
        for h in hits
    ]
    return envelope(
        data=items,
        meta={
            "total": result.get("estimatedTotalHits") or len(items),
            "took_ms": result.get("processingTimeMs", 0),
            "limit": limit,
            "q": q,
        },
    )
