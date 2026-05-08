"""사용량 분석 라우터 (Tier 2D).

reader+ 누구나 접근 가능. 데이터는 audit_logs / links / documents 테이블에서
추정값으로 집계한다.

  - GET /api/v1/analytics/overview      MAU, total_docs/links, avg_backlinks,
                                        top_searches, top_viewed_docs
  - GET /api/v1/analytics/daily?days=N  일별 active_users / writes / reads / search
  - GET /api/v1/analytics/top-views?days=N  최근 N일 동안 가장 많이 조회된 문서 top 10
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import require_reader
from app.core.db import get_db
from app.core.errors import envelope


router = APIRouter(prefix="/api/v1/analytics", tags=["analytics"])


@router.get("/overview", summary="대시보드 오버뷰")
async def overview(
    s: AsyncSession = Depends(get_db),
    _user: dict[str, Any] = Depends(require_reader),
) -> dict[str, Any]:
    mau = int((await s.execute(
        text(
            "SELECT COUNT(DISTINCT user_id) FROM audit_logs "
            "WHERE user_id IS NOT NULL "
            "AND created_at >= NOW() - INTERVAL '30 days'"
        )
    )).scalar() or 0)

    total_docs = int((await s.execute(
        text("SELECT COUNT(*) FROM documents WHERE status != 'archived'")
    )).scalar() or 0)

    total_links = int((await s.execute(text("SELECT COUNT(*) FROM links"))).scalar() or 0)

    avg_backlinks = 0.0
    if total_docs > 0:
        avg_backlinks = float((await s.execute(text(
            "SELECT COALESCE(AVG(c), 0)::float FROM ("
            "  SELECT COUNT(*) AS c FROM links GROUP BY target_doc_id"
            ") sub"
        ))).scalar() or 0.0)

    top_searches_rows = (await s.execute(text("""
        SELECT target, COUNT(*) AS n
        FROM audit_logs
        WHERE action = 'search' AND target IS NOT NULL AND target != ''
          AND created_at >= NOW() - INTERVAL '30 days'
        GROUP BY target
        ORDER BY n DESC
        LIMIT 10
    """))).all()
    top_searches = [{"q": r[0], "count": int(r[1])} for r in top_searches_rows]

    top_viewed_rows = (await s.execute(text("""
        SELECT a.target, COUNT(*) AS n,
               COALESCE(d.title, a.target) AS title
        FROM audit_logs a
        LEFT JOIN documents d ON ('document:' || d.slug) = a.target
        WHERE a.action = 'document.view'
          AND a.created_at >= NOW() - INTERVAL '30 days'
        GROUP BY a.target, d.title
        ORDER BY n DESC
        LIMIT 10
    """))).all()
    top_viewed_docs = [
        {
            "target": r[0],
            "slug": (r[0] or "").removeprefix("document:"),
            "title": r[2],
            "count": int(r[1]),
        }
        for r in top_viewed_rows
    ]

    return envelope(data={
        "mau": mau,
        "total_docs": total_docs,
        "total_links": total_links,
        "avg_backlinks": round(avg_backlinks, 2),
        "top_searches": top_searches,
        "top_viewed_docs": top_viewed_docs,
    })


@router.get("/daily", summary="일별 활성 / 쓰기 / 읽기 / 검색 카운트")
async def daily(
    days: int = Query(default=30, ge=1, le=180),
    s: AsyncSession = Depends(get_db),
    _user: dict[str, Any] = Depends(require_reader),
) -> dict[str, Any]:
    sql = """
        WITH d AS (
            SELECT generate_series(
                date_trunc('day', NOW() - (:days_minus_1 || ' days')::interval),
                date_trunc('day', NOW()),
                '1 day'::interval
            )::date AS day
        ),
        agg AS (
            SELECT date_trunc('day', created_at)::date AS day,
                   COUNT(DISTINCT user_id) FILTER (WHERE user_id IS NOT NULL) AS active_users,
                   COUNT(*) FILTER (WHERE action LIKE 'document.create'
                                       OR action LIKE 'document.update'
                                       OR action LIKE 'document.patch') AS doc_writes,
                   COUNT(*) FILTER (WHERE action = 'document.view') AS doc_reads,
                   COUNT(*) FILTER (WHERE action = 'search') AS search_count
            FROM audit_logs
            WHERE created_at >= NOW() - (:days_minus_1 || ' days')::interval
            GROUP BY 1
        )
        SELECT d.day,
               COALESCE(agg.active_users, 0) AS active_users,
               COALESCE(agg.doc_writes, 0) AS doc_writes,
               COALESCE(agg.doc_reads, 0) AS doc_reads,
               COALESCE(agg.search_count, 0) AS search_count
        FROM d LEFT JOIN agg ON agg.day = d.day
        ORDER BY d.day
    """
    rows = (await s.execute(text(sql), {"days_minus_1": str(days - 1)})).all()
    items = [
        {
            "date": r[0].isoformat() if r[0] else None,
            "active_users": int(r[1]),
            "doc_writes": int(r[2]),
            "doc_reads": int(r[3]),
            "search_count": int(r[4]),
        }
        for r in rows
    ]
    return envelope(data=items, meta={"count": len(items), "days": days})


@router.get("/top-views", summary="최근 N일 가장 많이 조회된 문서 top 10")
async def top_views(
    days: int = Query(default=7, ge=1, le=180),
    limit: int = Query(default=10, ge=1, le=50),
    s: AsyncSession = Depends(get_db),
    _user: dict[str, Any] = Depends(require_reader),
) -> dict[str, Any]:
    rows = (await s.execute(
        text("""
            SELECT a.target, COUNT(*) AS n,
                   COALESCE(d.title, a.target) AS title,
                   d.slug
            FROM audit_logs a
            LEFT JOIN documents d ON ('document:' || d.slug) = a.target
            WHERE a.action = 'document.view'
              AND a.created_at >= NOW() - (:d || ' days')::interval
            GROUP BY a.target, d.title, d.slug
            ORDER BY n DESC
            LIMIT :lim
        """),
        {"d": str(days), "lim": limit},
    )).all()
    items = [
        {
            "target": r[0],
            "slug": r[3] if r[3] else (r[0] or "").removeprefix("document:"),
            "title": r[2],
            "count": int(r[1]),
        }
        for r in rows
    ]
    return envelope(data=items, meta={"count": len(items), "days": days})
