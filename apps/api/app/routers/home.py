"""Home hero / today endpoints.

GET /api/v1/home/hero
  4개 super-domain 타일 데이터 (캐시 5분).

GET /api/v1/home/today
  "오늘의 문서" — indegree 기반 day-seed rotation + 1-hop 이웃 그래프 (캐시 5분).
  view 로그 미구현이므로 fallback (2)→(3) 순으로 선정.
"""
from __future__ import annotations

import asyncio
import time
from datetime import date, datetime, timezone
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


# ---------------------------------------------------------------------------
# Today — "오늘의 문서" 선정 + 1-hop 그래프
# ---------------------------------------------------------------------------

_TODAY_CACHE: dict[str, Any] = {}          # key -> {"ts": float, "data": dict}
_TODAY_LOCK: asyncio.Lock | None = None
_TODAY_CACHE_TTL = 300                     # 5분
_TODAY_NEIGHBOR_CAP = 10                   # 1-hop 최대 개수


def _get_today_lock() -> asyncio.Lock:
    global _TODAY_LOCK
    if _TODAY_LOCK is None:
        _TODAY_LOCK = asyncio.Lock()
    return _TODAY_LOCK


def _extract_excerpt(content_json: dict | None) -> str:
    """DocumentJSON sections[].blocks[] 에서 첫 paragraph text 최대 200자."""
    if not content_json:
        return ""

    def _search_sections(sections: list) -> str:
        for section in sections:
            for block in section.get("blocks", []):
                if block.get("type") == "paragraph":
                    text_ = block.get("text", "")
                    if text_:
                        return text_[:200]
            sub = _search_sections(section.get("subsections", []))
            if sub:
                return sub
        return ""

    return _search_sections(content_json.get("sections", []))


def _day_seed_pick(candidates: list, seed_base: int) -> dict:
    """day-seed (같은 날 동일 결과) 로 candidates 중 1개 선택."""
    idx = seed_base % len(candidates)
    return candidates[idx]


async def _build_today_data(s: AsyncSession) -> dict[str, Any]:
    """
    fallback chain:
      (2) 전역 indegree top 5 → day-seed 1개
      (3) published ORDER BY updated_at DESC LIMIT 5 → day-seed 1개
    """
    seed_base = date.today().toordinal()

    # --- (2) 전역 indegree top 5 ---
    cand_rows = (await s.execute(
        text("""
            SELECT d.slug, d.title, d.indegree, d.updated_at,
                   d.content_json,
                   COALESCE(t.id::text, '') AS team_id
            FROM documents d
            LEFT JOIN parts p  ON p.id = d.part_id
            LEFT JOIN groups g ON g.id = p.group_id
            LEFT JOIN teams t  ON t.id = g.team_id
            WHERE d.status = 'published'
            ORDER BY d.indegree DESC
            LIMIT 5
        """),
    )).mappings().all()

    if not cand_rows:
        # --- (3) 최신순 fallback ---
        cand_rows = (await s.execute(
            text("""
                SELECT d.slug, d.title, d.indegree, d.updated_at,
                       d.content_json,
                       COALESCE(t.id::text, '') AS team_id
                FROM documents d
                LEFT JOIN parts p  ON p.id = d.part_id
                LEFT JOIN groups g ON g.id = p.group_id
                LEFT JOIN teams t  ON t.id = g.team_id
                WHERE d.status = 'published'
                ORDER BY d.updated_at DESC
                LIMIT 5
            """),
        )).mappings().all()

    if not cand_rows:
        # 문서 자체가 없는 환경
        return {
            "as_of": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "doc": None,
            "neighbors": [],
            "graph": {"nodes": [], "edges": []},
        }

    chosen = _day_seed_pick(list(cand_rows), seed_base)
    doc_slug: str = chosen["slug"]
    content_json = chosen["content_json"] or {}
    excerpt = _extract_excerpt(content_json)

    doc_out = {
        "slug": doc_slug,
        "title": chosen["title"],
        "excerpt": excerpt,
        "indegree": int(chosen["indegree"] or 0),
        "team_id": chosen["team_id"] or None,
        "updated_at": chosen["updated_at"].isoformat() if chosen["updated_at"] else None,
    }

    # --- 1-hop neighbors ---
    noise = list(NOISE_TAGS)

    # wiki neighbors (links 테이블, 양방향)
    wiki_rows = (await s.execute(
        text("""
            SELECT n.slug, n.title, SUM(w) AS weight FROM (
                SELECT d2.slug, d2.title, COUNT(*) AS w
                FROM links l
                JOIN documents src ON src.id = l.source_doc_id AND src.slug = :slug
                JOIN documents d2  ON d2.slug = l.target_slug  AND d2.status = 'published'
                GROUP BY d2.slug, d2.title

                UNION ALL

                SELECT src2.slug, src2.title, COUNT(*) AS w
                FROM links l
                JOIN documents tgt ON tgt.slug = l.target_slug AND tgt.slug = :slug
                JOIN documents src2 ON src2.id = l.source_doc_id AND src2.status = 'published'
                GROUP BY src2.slug, src2.title
            ) n
            GROUP BY n.slug, n.title
            ORDER BY weight DESC
        """),
        {"slug": doc_slug},
    )).all()

    # tag neighbors (document_tags + tags, NOISE_TAGS 제외)
    tag_rows = (await s.execute(
        text("""
            SELECT t.name, COUNT(dt2.document_id) AS weight
            FROM document_tags dt
            JOIN documents d ON d.id = dt.document_id AND d.slug = :slug
            JOIN tags t ON t.id = dt.tag_id
              AND t.name != ALL(:noise)
            LEFT JOIN document_tags dt2 ON dt2.tag_id = t.id
            GROUP BY t.name
            ORDER BY weight DESC
        """),
        {"slug": doc_slug, "noise": noise},
    )).all()

    # 합산 + cap
    neighbors_raw: list[dict] = []
    for r in wiki_rows:
        neighbors_raw.append({
            "kind": "wiki",
            "slug": r[0],
            "title": r[1],
            "weight": int(r[2]),
        })
    for r in tag_rows:
        neighbors_raw.append({
            "kind": "tag",
            "slug": f"tag:{r[0]}",
            "title": f"#{r[0]}",
            "weight": int(r[1]),
        })

    # weight 내림차순 + cap
    neighbors_raw.sort(key=lambda x: x["weight"], reverse=True)
    neighbors = neighbors_raw[:_TODAY_NEIGHBOR_CAP]

    # --- graph payload (nodes + edges, /links/graph 동일 스키마) ---
    graph_slugs: set[str] = {doc_slug}
    for nb in neighbors:
        if nb["kind"] == "wiki":
            graph_slugs.add(nb["slug"])

    node_rows = (await s.execute(
        text("""
            SELECT d.slug, d.title, d.status,
                   COALESCE(t.slug, '') AS team_slug
            FROM documents d
            LEFT JOIN parts p  ON p.id = d.part_id
            LEFT JOIN groups g ON g.id = p.group_id
            LEFT JOIN teams t  ON t.id = g.team_id
            WHERE d.slug = ANY(:slugs)
        """),
        {"slugs": list(graph_slugs)},
    )).all()

    graph_nodes: list[dict] = [
        {
            "kind": "doc",
            "slug": r[0],
            "title": r[1],
            "status": r[2],
            "group": r[3] or None,
        }
        for r in node_rows
    ]

    # tag 노드 추가
    for nb in neighbors:
        if nb["kind"] == "tag":
            graph_nodes.append({
                "kind": "tag",
                "slug": nb["slug"],
                "title": nb["title"],
                "status": None,
                "group": None,
            })

    # 엣지 (doc slug 집합 내부 wiki 링크 + doc-tag 링크)
    wiki_slug_list = [n["slug"] for n in graph_nodes if n["kind"] == "doc"]
    graph_edges: list[dict] = []

    if len(wiki_slug_list) > 1:
        edge_rows = (await s.execute(
            text("""
                SELECT src.slug AS s, l.target_slug AS t, COUNT(*) AS cnt
                FROM links l
                JOIN documents src ON src.id = l.source_doc_id
                WHERE src.slug = ANY(:slugs) AND l.target_slug = ANY(:slugs)
                GROUP BY src.slug, l.target_slug
            """),
            {"slugs": wiki_slug_list},
        )).all()
        graph_edges = [
            {"kind": "wiki", "source": r[0], "target": r[1], "count": int(r[2])}
            for r in edge_rows
        ]

    for nb in neighbors:
        if nb["kind"] == "tag":
            graph_edges.append({
                "kind": "doc_tag",
                "source": doc_slug,
                "target": nb["slug"],
                "count": nb["weight"],
            })

    # --- contextual edges: ctx_author / ctx_part (1-hop) + ctx_tag (2-hop, cap 10) ---
    # ctx_author / ctx_part 는 distinct 값이 2개 이상일 때만 의미 있는 신호.
    # 단일 owner / 거의 NULL part 인 상황에서는 거미줄 폭발 → query 자체 skip.
    doc_slugs_for_ctx = [n["slug"] for n in graph_nodes if n["kind"] == "doc"]
    if len(doc_slugs_for_ctx) > 1:
        distinct_owners = (await s.execute(
            text("SELECT COUNT(DISTINCT owner_id) FROM documents WHERE slug = ANY(:slugs) AND owner_id IS NOT NULL"),
            {"slugs": doc_slugs_for_ctx},
        )).scalar_one()
        if distinct_owners >= 2:
            ctx_author_rows = (await s.execute(
                text("""
                    SELECT d1.slug AS source, d2.slug AS target
                    FROM documents d1
                    JOIN documents d2
                      ON d2.owner_id = d1.owner_id AND d2.id > d1.id
                    WHERE d1.slug = ANY(:slugs)
                      AND d2.slug = ANY(:slugs)
                      AND d1.owner_id IS NOT NULL
                """),
                {"slugs": doc_slugs_for_ctx},
            )).all()
            for r in ctx_author_rows:
                graph_edges.append({"kind": "ctx_author", "source": r[0], "target": r[1], "weight": 1})

        distinct_parts = (await s.execute(
            text("SELECT COUNT(DISTINCT part_id) FROM documents WHERE slug = ANY(:slugs) AND part_id IS NOT NULL"),
            {"slugs": doc_slugs_for_ctx},
        )).scalar_one()
        if distinct_parts >= 2:
            ctx_part_rows = (await s.execute(
                text("""
                    SELECT d1.slug AS source, d2.slug AS target
                    FROM documents d1
                    JOIN documents d2
                      ON d2.part_id = d1.part_id AND d2.id > d1.id
                    WHERE d1.slug = ANY(:slugs)
                      AND d2.slug = ANY(:slugs)
                      AND d1.part_id IS NOT NULL
                """),
                {"slugs": doc_slugs_for_ctx},
            )).all()
            for r in ctx_part_rows:
                graph_edges.append({"kind": "ctx_part", "source": r[0], "target": r[1], "weight": 1})

        ctx_tag_rows = (await s.execute(
            text("""
                SELECT a.slug AS source, b.slug AS target, COUNT(*) AS weight
                FROM documents a
                JOIN document_tags dta ON dta.document_id = a.id
                JOIN document_tags dtb ON dta.tag_id = dtb.tag_id
                  AND dtb.document_id != a.id
                JOIN documents b ON b.id = dtb.document_id
                JOIN tags tg ON tg.id = dta.tag_id
                WHERE a.slug = ANY(:slugs)
                  AND b.slug = ANY(:slugs)
                  AND a.id < b.id
                  AND tg.name != ALL(:noise)
                GROUP BY a.slug, b.slug
                HAVING COUNT(*) >= 2
                ORDER BY COUNT(*) DESC
                LIMIT 10
            """),
            {"slugs": doc_slugs_for_ctx, "noise": noise},
        )).all()
        for r in ctx_tag_rows:
            graph_edges.append({"kind": "ctx_tag", "source": r[0], "target": r[1], "weight": int(r[2])})

    return {
        "as_of": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "doc": doc_out,
        "neighbors": neighbors,
        "graph": {"nodes": graph_nodes, "edges": graph_edges},
    }


async def _get_today_data(s: AsyncSession, cache_key: str) -> dict[str, Any]:
    now = time.monotonic()
    async with _get_today_lock():
        entry = _TODAY_CACHE.get(cache_key)
        if entry and (now - entry["ts"]) < _TODAY_CACHE_TTL:
            return entry["data"]
        result = await _build_today_data(s)
        _TODAY_CACHE[cache_key] = {"ts": now, "data": result}
        return result


@router.get(
    "/today",
    summary="오늘의 문서 — indegree top 문서 day-seed 선정 + 1-hop 그래프 (캐시 5분)",
)
async def get_home_today(
    s: AsyncSession = Depends(get_db),
    _user: dict = Depends(require_reader),
) -> dict[str, Any]:
    # view 로그 미구현이므로 anonymous 캐시 키 사용 (fallback 2/3 경로)
    user_id = _user.get("id") or "anon"
    cache_key = f"home_today_{user_id}"
    data = await _get_today_data(s, cache_key)
    return envelope(data=data)
