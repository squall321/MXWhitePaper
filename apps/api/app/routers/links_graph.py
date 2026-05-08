"""Wiki Link Graph 라우터 (Tier 2C).

GET /api/v1/links/graph?root=<slug>&depth=2

  - root 미지정: degree 상위 200 노드 / 모든 엣지(노드 한정 후) 집합 반환.
  - root 지정: BFS 로 depth 만큼 확장.

응답 shape:
  {
    nodes: [{slug, title, status, group}],
    edges: [{source, target, count}]
  }
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import require_reader
from app.core.db import get_db
from app.core.errors import envelope

router = APIRouter(prefix="/api/v1/links", tags=["links"])


async def _aggregate_edges(s: AsyncSession) -> list[tuple[str, str, int]]:
    """links 테이블을 (source_slug, target_slug, count) 로 집계."""
    rows = (await s.execute(
        text("""
            SELECT d.slug AS src,
                   l.target_slug AS tgt,
                   COUNT(*) AS cnt
            FROM links l
            JOIN documents d ON d.id = l.source_doc_id
            WHERE d.status != 'archived'
            GROUP BY d.slug, l.target_slug
        """),
    )).all()
    return [(r[0], r[1], int(r[2])) for r in rows]


async def _fetch_nodes(
    s: AsyncSession, slugs: set[str]
) -> dict[str, dict[str, Any]]:
    if not slugs:
        return {}
    rows = (await s.execute(
        text("""
            SELECT d.slug, d.title, d.status,
                   COALESCE(t.slug, '') AS team_slug
            FROM documents d
            LEFT JOIN parts p ON p.id = d.part_id
            LEFT JOIN teams t ON t.id = p.team_id
            WHERE d.slug = ANY(:slugs) AND d.status != 'archived'
        """),
        {"slugs": list(slugs)},
    )).all()
    out: dict[str, dict[str, Any]] = {}
    for r in rows:
        out[r[0]] = {
            "slug": r[0], "title": r[1], "status": r[2],
            "group": r[3] or None,
        }
    # missing slugs (no document) → status='missing'
    for s_ in slugs:
        if s_ not in out:
            out[s_] = {"slug": s_, "title": s_, "status": "missing", "group": None}
    return out


@router.get(
    "/graph",
    summary="Wiki link 그래프 (BFS)",
    description=(
        "root 가 주어지면 depth 까지 BFS 확장. 미지정시 degree 상위 200 노드 "
        "+ 그 사이의 엣지를 반환."
    ),
)
async def get_graph(
    root: str | None = Query(default=None),
    depth: int = Query(default=2, ge=1, le=4),
    s: AsyncSession = Depends(get_db),
    _user: dict = Depends(require_reader),
) -> dict[str, Any]:
    edges = await _aggregate_edges(s)

    if root:
        # BFS 양방향. depth 만큼 source/target 으로 hop.
        adj_out: dict[str, list[tuple[str, int]]] = {}
        adj_in: dict[str, list[tuple[str, int]]] = {}
        for src, tgt, cnt in edges:
            adj_out.setdefault(src, []).append((tgt, cnt))
            adj_in.setdefault(tgt, []).append((src, cnt))
        visited: set[str] = {root}
        frontier: set[str] = {root}
        for _ in range(depth):
            nxt: set[str] = set()
            for node in frontier:
                for tgt, _c in adj_out.get(node, []):
                    if tgt not in visited:
                        nxt.add(tgt)
                for src, _c in adj_in.get(node, []):
                    if src not in visited:
                        nxt.add(src)
            visited.update(nxt)
            frontier = nxt
            if not frontier:
                break

        kept_edges = [
            {"source": src, "target": tgt, "count": cnt}
            for src, tgt, cnt in edges
            if src in visited and tgt in visited
        ]
        nodes_map = await _fetch_nodes(s, visited)
        return envelope(
            data={
                "nodes": list(nodes_map.values()),
                "edges": kept_edges,
            },
            meta={"root": root, "depth": depth, "count": len(visited)},
        )

    # 전역 — degree 상위 200
    deg: dict[str, int] = {}
    for src, tgt, cnt in edges:
        deg[src] = deg.get(src, 0) + cnt
        deg[tgt] = deg.get(tgt, 0) + cnt
    top = sorted(deg.items(), key=lambda kv: kv[1], reverse=True)[:200]
    keep: set[str] = {k for k, _ in top}
    kept_edges = [
        {"source": src, "target": tgt, "count": cnt}
        for src, tgt, cnt in edges
        if src in keep and tgt in keep
    ]
    nodes_map = await _fetch_nodes(s, keep)
    return envelope(
        data={
            "nodes": list(nodes_map.values()),
            "edges": kept_edges,
        },
        meta={"count": len(keep), "global": True},
    )
