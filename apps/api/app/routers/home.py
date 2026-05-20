"""Home hero endpoint — 4개 super-domain 타일 데이터.

GET /api/v1/home/hero

응답:
  {
    "data": {
      "as_of": "2026-05-20T10:30:00Z",
      "domains": [
        {
          "id": "mobile",
          "doc_count": 86,
          "doc_count_7d_ago": 42,
          "trend_7d": [42, 48, 55, 60, 68, 75, 86],
          "top_docs": [{"slug": "...", "title": "...", "indegree": 28}]
        },
        ...
      ]
    }
  }

- 빈 도메인(doc_count == 0) 은 domains 배열에서 제외.
- Cache: in-memory dict + asyncio.Lock, TTL 5분.
"""
from __future__ import annotations

import asyncio
import time
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import require_reader
from app.core.db import get_db
from app.core.errors import envelope
from app.lib.super_domains import NOISE_TAGS, SUPER_DOMAINS

router = APIRouter(prefix="/api/v1/home", tags=["home"])

# ---------------------------------------------------------------------------
# In-memory cache (TTL 5분)
# ---------------------------------------------------------------------------
_CACHE_TTL = 300  # seconds

_cache_lock: asyncio.Lock | None = None
_cache_data: dict[str, Any] | None = None
_cache_ts: float = 0.0


def _get_lock() -> asyncio.Lock:
    """event loop 안에서 처음 호출될 때 Lock 을 생성 (lazy init)."""
    global _cache_lock
    if _cache_lock is None:
        _cache_lock = asyncio.Lock()
    return _cache_lock


async def _get_hero_data(s: AsyncSession) -> dict[str, Any]:
    """캐시에서 반환하거나 DB 에서 조회 후 캐시에 저장."""
    global _cache_data, _cache_ts

    now = time.monotonic()
    async with _get_lock():
        if _cache_data is not None and (now - _cache_ts) < _CACHE_TTL:
            return _cache_data
        result = await _build_hero_data(s)
        _cache_data = result
        _cache_ts = now
        return result


async def _build_hero_data(s: AsyncSession) -> dict[str, Any]:
    """DB 4 도메인 × 3 쿼리 (count, trend_7d, top_docs) 실행."""
    noise = list(NOISE_TAGS)
    domains_out = []

    for domain in SUPER_DOMAINS:
        tag_names = list(domain.tags)

        # --- 1) 현재 doc_count ---
        count_row = (await s.execute(
            text("""
                SELECT COUNT(DISTINCT d.id)
                FROM documents d
                JOIN document_tags dt ON dt.document_id = d.id
                JOIN tags t ON t.id = dt.tag_id
                WHERE t.name = ANY(:tags)
                  AND t.name != ALL(:noise)
                  AND d.status = 'published'
            """),
            {"tags": tag_names, "noise": noise},
        )).scalar_one()
        doc_count = int(count_row)

        if doc_count == 0:
            continue  # 빈 도메인 제외

        # --- 2) trend_7d (7일치 누적 카운트) ---
        trend_rows = (await s.execute(
            text("""
                WITH days AS (
                    SELECT generate_series(
                        current_date - interval '6 days',
                        current_date,
                        interval '1 day'
                    )::date AS day
                ),
                domain_docs AS (
                    SELECT DISTINCT d.id, d.created_at::date AS created_day
                    FROM documents d
                    JOIN document_tags dt ON dt.document_id = d.id
                    JOIN tags t ON t.id = dt.tag_id
                    WHERE t.name = ANY(:tags)
                      AND t.name != ALL(:noise)
                      AND d.status = 'published'
                )
                SELECT
                    days.day,
                    COUNT(dd.id) FILTER (WHERE dd.created_day <= days.day) AS cumulative_count
                FROM days
                LEFT JOIN domain_docs dd ON true
                GROUP BY days.day
                ORDER BY days.day
            """),
            {"tags": tag_names, "noise": noise},
        )).all()

        trend_7d = [int(r[1]) for r in trend_rows]
        doc_count_7d_ago = trend_7d[0] if trend_7d else 0

        # --- 3) top_docs (indegree DESC 상위 3) ---
        top_rows = (await s.execute(
            text("""
                SELECT slug, title, indegree FROM (
                    SELECT DISTINCT d.slug, d.title, d.indegree, d.updated_at
                    FROM documents d
                    JOIN document_tags dt ON dt.document_id = d.id
                    JOIN tags t ON t.id = dt.tag_id
                    WHERE t.name = ANY(:tags)
                      AND t.name != ALL(:noise)
                      AND d.status = 'published'
                ) sub
                ORDER BY indegree DESC, updated_at DESC
                LIMIT 3
            """),
            {"tags": tag_names, "noise": noise},
        )).all()

        top_docs = [
            {"slug": r[0], "title": r[1], "indegree": int(r[2])}
            for r in top_rows
        ]

        domains_out.append({
            "id": domain.id,
            "doc_count": doc_count,
            "doc_count_7d_ago": doc_count_7d_ago,
            "trend_7d": trend_7d,
            "top_docs": top_docs,
        })

    return {
        "as_of": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "domains": domains_out,
    }


@router.get(
    "/hero",
    summary="Home hero — super-domain 타일 데이터 (캐시 5분)",
)
async def get_home_hero(
    s: AsyncSession = Depends(get_db),
    _user: dict = Depends(require_reader),
) -> dict[str, Any]:
    data = await _get_hero_data(s)
    return envelope(data=data)
