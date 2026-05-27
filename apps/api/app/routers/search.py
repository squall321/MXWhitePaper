"""검색 라우터 (Sprint 6 + cycle 5 J3 — highlight & advanced filters).

GET /api/v1/search
  쿼리 파라미터:
    q                필수, 검색어 (빈 문자열도 허용 — fallback 처리)
    part             part_slug 필터
    tag              태그 필터 (Meili 의 array contains)
    author           작성자 user_id 또는 슬러그
    team             team_slug 필터 (legacy)
    confidentiality  공개도 필터 (legacy)
    from / to        updated_at 범위 (YYYY-MM-DD)
    limit / offset   페이지네이션 (기본 20 / 0)

  응답:
    {
      "data": [{
        slug, title, summary, snippet, highlights: {title, summary, body},
        updated_at, part, tags, author
      }, ...],
      "meta": {total, query_time_ms, took_ms, limit, offset, q}
    }

GET /api/v1/search/suggest?q=&limit=8
  omnibox 자동완성용 — 매칭되는 태그 / 작성자 / 부서 / 최근 문서 제목 묶음.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.db import get_db
from app.core.errors import envelope
from app.repos import document_repo
from app.search import meili_indexer
from app.services import search_audit

router = APIRouter(prefix="/api/v1", tags=["search"])


def _parse_date(value: str | None) -> str | None:
    """`YYYY-MM-DD` 만 허용 — 잘못된 값은 None 으로 떨어뜨려 무시."""
    if not value:
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%d").strftime("%Y-%m-%d")
    except ValueError:
        return None


def _hit_to_item(h: dict[str, Any]) -> dict[str, Any]:
    """Meilisearch hit → FE item shape.

    snippet 은 body_text 의 cropped highlight (없으면 summary fallback).
    highlights 는 field → string 맵.
    """
    formatted = h.get("_formatted") or {}
    body_h = formatted.get("body_text") or ""
    summary_h = formatted.get("summary") or ""
    title_h = formatted.get("title") or h.get("title") or ""
    snippet = body_h or summary_h or (h.get("summary") or "")
    if snippet and len(snippet) > 200:
        snippet = snippet[:200].rsplit(" ", 1)[0] + "…"
    return {
        "slug": h.get("slug"),
        "title": h.get("title"),
        "summary": h.get("summary"),
        "snippet": snippet,
        "highlights": {
            "title": title_h,
            "summary": summary_h,
            "body": body_h,
        },
        "updated_at": h.get("updated_at"),
        "part": h.get("part_slug"),
        "tags": h.get("tags") or [],
        "author": h.get("author") or h.get("created_by"),
        # legacy fields kept for backwards compat (existing FE reads these)
        "team_slug": h.get("team_slug"),
        "part_slug": h.get("part_slug"),
        "_formatted": formatted,
    }


@router.get("/search")
async def search(
    q: str = Query(default="", description="검색 쿼리 (빈 값 허용)"),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    team: str | None = Query(default=None),
    part: str | None = Query(default=None),
    tag: str | None = Query(default=None),
    author: str | None = Query(default=None),
    confidentiality: str | None = Query(default=None),
    date_from: str | None = Query(default=None, alias="from", description="updated_at >= YYYY-MM-DD"),
    date_to: str | None = Query(default=None, alias="to", description="updated_at <= YYYY-MM-DD"),
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    filters: dict[str, str] = {}
    if team:
        filters["team_slug"] = team
    if part:
        filters["part_slug"] = part
    if tag:
        # tags 는 array 필드. Meilisearch 는 `tags = "x"` 도 array contains 처리.
        filters["tags"] = tag
    if author:
        # H6 — owner email is lower-cased at index time, so match the same way.
        filters["author"] = str(author).lower()
    if confidentiality:
        filters["confidentiality"] = confidentiality

    raw_exprs: list[str] = []
    df = _parse_date(date_from)
    dt = _parse_date(date_to)
    if df:
        raw_exprs.append(f'updated_at >= "{df}"')
    if dt:
        raw_exprs.append(f'updated_at <= "{dt}"')

    # H5 — block redaction guard. AND in a clause that drops every hit whose
    # max-required role exceeds the caller's level. Always-on (cannot be
    # overridden by the FE) so a reader never sees an editor-only doc's text
    # in a snippet.
    raw_exprs.extend(meili_indexer.role_filter_exprs(user.get("role")))

    try:
        result = meili_indexer.search(
            q=q,
            limit=limit,
            offset=offset,
            filters=filters,
            raw_filter_exprs=raw_exprs,
        )
    except Exception as e:
        # 검색 인덱스 장애 시에도 200 + 빈 결과로 fallback (FE 가 죽지 않도록)
        return envelope(
            data=[],
            meta={"total": 0, "took_ms": 0, "query_time_ms": 0, "error": str(e)},
        )

    # rate-limited audit logging — 빈 쿼리는 skip, 한 user+q 가 60s 내 또 오면 skip.
    if q.strip() and search_audit.allow(user.get("id") or "", q.strip()):
        try:
            await document_repo.insert_audit(
                s,
                user_id=user.get("id"),
                action="search",
                target=q.strip()[:200],
                payload={"limit": limit, "filters": filters or None},
            )
            await s.commit()
        except Exception:
            await s.rollback()

    hits = result.get("hits", []) if isinstance(result, dict) else []
    items = [_hit_to_item(h) for h in hits]
    took = result.get("processingTimeMs", 0)
    return envelope(
        data=items,
        meta={
            "total": result.get("estimatedTotalHits") or len(items),
            "took_ms": took,
            "query_time_ms": took,
            "limit": limit,
            "offset": offset,
            "q": q,
        },
    )


@router.get("/search/suggest")
async def search_suggest(
    q: str = Query(default="", description="suggest prefix"),
    limit: int = Query(default=8, ge=1, le=20),
    s: AsyncSession = Depends(get_db),
    _user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Omnibox 자동완성 — 태그 / 작성자 / 부서 / 최근 문서 제목.

    각 카테고리별 최대 `limit` 건. 빈 q 면 모든 리스트가 빈 배열.
    """
    needle = (q or "").strip()
    if not needle:
        return envelope(
            data={"tags": [], "authors": [], "parts": [], "documents": []},
            meta={"q": ""},
        )

    safe = needle.lower()
    like = f"{safe}%"
    contains = f"%{safe}%"

    # 태그 prefix 매칭 (document_tags 또는 tags 테이블 — 기존 패턴 재사용)
    tags: list[dict[str, Any]] = []
    try:
        rows = (await s.execute(
            text(
                """
                SELECT t.tag, COUNT(dt.document_id) AS cnt
                FROM tags t
                LEFT JOIN document_tags dt ON dt.tag_id = t.id
                WHERE LOWER(t.tag) LIKE :prefix
                GROUP BY t.tag
                ORDER BY cnt DESC, t.tag ASC
                LIMIT :lim
                """
            ),
            {"prefix": like, "lim": limit},
        )).all()
        tags = [{"tag": r[0], "count": int(r[1] or 0)} for r in rows]
    except Exception:
        tags = []

    # 작성자 — users 테이블에서 name/email prefix
    authors: list[dict[str, Any]] = []
    try:
        rows = (await s.execute(
            text(
                """
                SELECT id::text, COALESCE(name, email) AS label, email
                FROM users
                WHERE LOWER(COALESCE(name,'')) LIKE :prefix
                   OR LOWER(COALESCE(email,'')) LIKE :prefix
                ORDER BY label ASC
                LIMIT :lim
                """
            ),
            {"prefix": like, "lim": limit},
        )).all()
        authors = [{"id": r[0], "label": r[1], "email": r[2]} for r in rows]
    except Exception:
        authors = []

    # 부서 (parts) — slug/name prefix
    parts: list[dict[str, Any]] = []
    try:
        rows = (await s.execute(
            text(
                """
                SELECT slug, name
                FROM parts
                WHERE LOWER(slug) LIKE :prefix OR LOWER(COALESCE(name,'')) LIKE :prefix
                ORDER BY name ASC
                LIMIT :lim
                """
            ),
            {"prefix": like, "lim": limit},
        )).all()
        parts = [{"slug": r[0], "name": r[1]} for r in rows]
    except Exception:
        parts = []

    # 최근 문서 — Meili 호출 (실패 시 빈 배열)
    documents: list[dict[str, Any]] = []
    try:
        # H5 — same role filter as /search so suggest never leaks restricted hits.
        result = meili_indexer.search(
            q=needle,
            limit=limit,
            filters={},
            raw_filter_exprs=meili_indexer.role_filter_exprs(_user.get("role")),
        )
        for h in (result.get("hits") or []) if isinstance(result, dict) else []:
            documents.append({
                "slug": h.get("slug"),
                "title": h.get("title"),
                "highlight": (h.get("_formatted") or {}).get("title") or h.get("title"),
            })
    except Exception:
        documents = []

    # contains fallback if prefix yielded nothing — improves match for non-prefix hits
    if not tags:
        try:
            rows = (await s.execute(
                text(
                    """
                    SELECT t.tag FROM tags t
                    WHERE LOWER(t.tag) LIKE :c
                    ORDER BY t.tag ASC LIMIT :lim
                    """
                ),
                {"c": contains, "lim": limit},
            )).all()
            tags = [{"tag": r[0], "count": 0} for r in rows]
        except Exception:
            pass

    return envelope(
        data={
            "tags": tags,
            "authors": authors,
            "parts": parts,
            "documents": documents,
        },
        meta={"q": needle, "limit": limit},
    )
