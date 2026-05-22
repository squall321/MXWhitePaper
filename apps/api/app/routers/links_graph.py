"""Wiki Link Graph 라우터 (Tier 2C).

GET /api/v1/links/graph?root=<slug>&depth=2
  - root 미지정: degree 상위 200 노드 / 모든 엣지(노드 한정 후) 집합 반환.
  - root 지정: BFS 로 depth 만큼 확장.

GET /api/v1/links/graph?domain=<id>&include_tags=1&include_doc_tag_edges=1&include_tag_cooc=1
  - domain 지정: super-domain 하위 tag 를 가진 published doc 들 + wiki 엣지.
  - include_tags=1: tag 노드 추가 (kind="tag").
  - include_doc_tag_edges=1: doc-tag 소속 엣지 추가 (kind="doc_tag").
  - include_tag_cooc=1: tag-tag 공동출현 엣지 추가 (kind="tag_cooc").
  - include_context=1: contextual 약한 관계 엣지 추가 (kind="ctx_author"|"ctx_part"|"ctx_tag").
  - domain + root 동시 지정: 도메인 doc 집합 안에서 root BFS depth 적용.
  - NOISE_TAGS 는 어떤 응답에도 노출 안 됨.

응답 shape (신규 필드 `kind` 추가, backward compat):
  {
    nodes: [{kind, slug, title, status, group}],          # kind: "doc"|"tag"
    edges: [{kind, source, target, count, weight}]        # kind: "wiki"|"doc_tag"|"tag_cooc"|"ctx_author"|"ctx_part"|"ctx_tag"
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
from app.lib.super_domains import NOISE_TAGS, by_id

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
            LEFT JOIN parts p  ON p.id = d.part_id
            LEFT JOIN groups g ON g.id = p.group_id
            LEFT JOIN teams t  ON t.id = g.team_id
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


async def _triple_edges(
    s: AsyncSession, node_slugs: set[str]
) -> list[dict]:
    """doc_triples 에서 subject/object 가 모두 node_slugs 안에 있는 triple 만
    엣지 형태로 반환 (graph-edge-predicates, include_triples=true 시 호출).

    존재하지 않는 slug 의 triple 은 자동 제외 — node_slugs 양쪽 멤버십으로 필터.
    """
    if not node_slugs:
        return []
    rows = (await s.execute(
        text("""
            SELECT subject_slug, object_slug, predicate, source, confidence
            FROM doc_triples
            WHERE subject_slug = ANY(:slugs)
              AND object_slug = ANY(:slugs)
        """),
        {"slugs": list(node_slugs)},
    )).all()
    out: list[dict] = []
    for r in rows:
        if r[0] in node_slugs and r[1] in node_slugs:
            out.append({
                "kind": "triple",
                "source": r[0],
                "target": r[1],
                "predicate": r[2],
                "triple_source": r[3],
                "confidence": r[4],
            })
    return out


async def _ctx_edges(
    s: AsyncSession,
    slugs: list[str],
    noise: list[str],
) -> list[dict]:
    """domain 내부 contextual edge 3종 반환 (include_context=1 시 호출).

    ctx_author: 같은 owner_id 공유 doc 쌍
    ctx_part:   같은 part_id 공유 doc 쌍 (part_id NOT NULL 인 doc 만)
    ctx_tag:    2개 이상 tag 공유 doc 쌍 (weight = 공유 tag 수)
    """
    if not slugs:
        return []

    edges: list[dict] = []

    # ctx_author / ctx_part 는 distinct 값이 2개 이상일 때만 의미 있는 신호.
    # 단일 owner / 거의 NULL part 인 데이터 상태에서는 *모든 doc 쌍* 이 연결돼
    # 거미줄 폭발. 사전 분포 확인 후 의미 있을 때만 query.
    distinct_owners = (await s.execute(
        text("SELECT COUNT(DISTINCT owner_id) FROM documents WHERE slug = ANY(:slugs) AND owner_id IS NOT NULL"),
        {"slugs": slugs},
    )).scalar_one()
    if distinct_owners >= 2:
        author_rows = (await s.execute(
            text("""
                SELECT d1.slug AS source, d2.slug AS target, 1 AS weight
                FROM documents d1
                JOIN documents d2
                  ON d2.owner_id = d1.owner_id AND d2.id > d1.id
                WHERE d1.slug = ANY(:slugs)
                  AND d2.slug = ANY(:slugs)
                  AND d1.owner_id IS NOT NULL
            """),
            {"slugs": slugs},
        )).all()
        for r in author_rows:
            edges.append({"kind": "ctx_author", "source": r[0], "target": r[1], "weight": 1})

    distinct_parts = (await s.execute(
        text("SELECT COUNT(DISTINCT part_id) FROM documents WHERE slug = ANY(:slugs) AND part_id IS NOT NULL"),
        {"slugs": slugs},
    )).scalar_one()
    if distinct_parts >= 2:
        part_rows = (await s.execute(
            text("""
                SELECT d1.slug AS source, d2.slug AS target, 1 AS weight
                FROM documents d1
                JOIN documents d2
                  ON d2.part_id = d1.part_id AND d2.id > d1.id
                WHERE d1.slug = ANY(:slugs)
                  AND d2.slug = ANY(:slugs)
                  AND d1.part_id IS NOT NULL
            """),
            {"slugs": slugs},
        )).all()
        for r in part_rows:
            edges.append({"kind": "ctx_part", "source": r[0], "target": r[1], "weight": 1})

    # --- ctx_tag (>=2 공동 tag, noise 제외) ---
    tag_rows = (await s.execute(
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
        """),
        {"slugs": slugs, "noise": noise},
    )).all()
    for r in tag_rows:
        edges.append({"kind": "ctx_tag", "source": r[0], "target": r[1], "weight": int(r[2])})

    return edges


async def _domain_subgraph(
    s: AsyncSession,
    domain_id: str,
    *,
    root: str | None,
    depth: int,
    include_tags: bool,
    include_doc_tag_edges: bool,
    include_tag_cooc: bool,
    include_context: bool,
    include_triples: bool = False,
) -> dict[str, Any]:
    """super-domain 의 하위 tag 가 가진 published doc 들 + 옵트인 엣지 반환."""
    domain = by_id(domain_id)
    if domain is None:
        return {"nodes": [], "edges": []}

    tag_names = list(domain.tags)
    noise = list(NOISE_TAGS)

    # --- 도메인에 속한 doc slug 집합 ---
    doc_rows = (await s.execute(
        text("""
            SELECT DISTINCT d.slug, d.title, d.status,
                   COALESCE(t2.slug, '') AS team_slug
            FROM documents d
            JOIN document_tags dt ON dt.document_id = d.id
            JOIN tags tg ON tg.id = dt.tag_id
            LEFT JOIN parts p  ON p.id = d.part_id
            LEFT JOIN groups g ON g.id = p.group_id
            LEFT JOIN teams t2 ON t2.id = g.team_id
            WHERE tg.name = ANY(:tags)
              AND tg.name != ALL(:noise)
              AND d.status = 'published'
        """),
        {"tags": tag_names, "noise": noise},
    )).all()

    domain_slugs: set[str] = {r[0] for r in doc_rows}
    doc_nodes_map: dict[str, dict] = {
        r[0]: {"kind": "doc", "slug": r[0], "title": r[1],
               "status": r[2], "group": r[3] or None}
        for r in doc_rows
    }

    # --- root + BFS 로 도메인 내부 필터링 ---
    if root and domain_slugs:
        all_edges_raw = await _aggregate_edges(s)
        # 도메인 내부 slugs 로만 제한
        adj_out: dict[str, list[tuple[str, int]]] = {}
        adj_in: dict[str, list[tuple[str, int]]] = {}
        for src, tgt, cnt in all_edges_raw:
            if src in domain_slugs and tgt in domain_slugs:
                adj_out.setdefault(src, []).append((tgt, cnt))
                adj_in.setdefault(tgt, []).append((src, cnt))

        visited: set[str] = {root} if root in domain_slugs else set()
        frontier: set[str] = visited.copy()
        for _ in range(depth):
            nxt: set[str] = set()
            for node in frontier:
                for tgt, _c in adj_out.get(node, []):
                    if tgt not in visited:
                        nxt.add(tgt)
                for src2, _c in adj_in.get(node, []):
                    if src2 not in visited:
                        nxt.add(src2)
            visited.update(nxt)
            frontier = nxt
            if not frontier:
                break
        domain_slugs = visited
        doc_nodes_map = {k: v for k, v in doc_nodes_map.items() if k in domain_slugs}

    # --- wiki 엣지 (도메인 내부) ---
    wiki_edges: list[dict] = []
    if domain_slugs:
        wiki_rows = (await s.execute(
            text("""
                SELECT d.slug AS src, l.target_slug AS tgt, COUNT(*) AS cnt
                FROM links l
                JOIN documents d ON d.id = l.source_doc_id
                WHERE d.slug = ANY(:slugs)
                  AND l.target_slug = ANY(:slugs)
                GROUP BY d.slug, l.target_slug
            """),
            {"slugs": list(domain_slugs)},
        )).all()
        wiki_edges = [
            {"kind": "wiki", "source": r[0], "target": r[1], "count": int(r[2])}
            for r in wiki_rows
        ]

    nodes_out: list[dict] = list(doc_nodes_map.values())
    edges_out: list[dict] = wiki_edges

    # --- tag 노드 ---
    tag_nodes_map: dict[str, dict] = {}
    if include_tags and domain_slugs:
        tag_rows = (await s.execute(
            text("""
                SELECT DISTINCT tg.name, COUNT(DISTINCT dt.document_id) AS doc_count
                FROM tags tg
                JOIN document_tags dt ON dt.tag_id = tg.id
                WHERE tg.name = ANY(:tags)
                  AND tg.name != ALL(:noise)
                  AND dt.document_id IN (
                      SELECT id FROM documents WHERE slug = ANY(:slugs)
                  )
                GROUP BY tg.name
            """),
            {"tags": tag_names, "noise": noise, "slugs": list(domain_slugs)},
        )).all()
        for r in tag_rows:
            key = f"tag:{r[0]}"
            tag_nodes_map[key] = {
                "kind": "tag",
                "slug": key,
                "name": r[0],
                "doc_count": int(r[1]),
                "super_domain": domain_id,
            }
        nodes_out = nodes_out + list(tag_nodes_map.values())

    # --- doc-tag 엣지 ---
    if include_tags and include_doc_tag_edges and domain_slugs:
        dt_rows = (await s.execute(
            text("""
                SELECT d.slug, tg.name
                FROM document_tags dt
                JOIN documents d ON d.id = dt.document_id
                JOIN tags tg ON tg.id = dt.tag_id
                WHERE tg.name = ANY(:tags)
                  AND tg.name != ALL(:noise)
                  AND d.slug = ANY(:slugs)
            """),
            {"tags": tag_names, "noise": noise, "slugs": list(domain_slugs)},
        )).all()
        for r in dt_rows:
            edges_out.append({
                "kind": "doc_tag",
                "source": r[0],
                "target": f"tag:{r[1]}",
            })

    # --- tag-tag co-occurrence 엣지 ---
    if include_tags and include_tag_cooc and domain_slugs:
        cooc_rows = (await s.execute(
            text("""
                SELECT ta.name AS a, tb.name AS b, COUNT(*) AS weight
                FROM document_tags dta
                JOIN document_tags dtb ON dtb.document_id = dta.document_id AND dtb.tag_id > dta.tag_id
                JOIN tags ta ON ta.id = dta.tag_id
                JOIN tags tb ON tb.id = dtb.tag_id
                WHERE dta.document_id IN (
                      SELECT id FROM documents WHERE slug = ANY(:slugs)
                  )
                  AND ta.name != ALL(:noise)
                  AND tb.name != ALL(:noise)
                GROUP BY ta.name, tb.name
                HAVING COUNT(*) >= 3
            """),
            {"slugs": list(domain_slugs), "noise": noise},
        )).all()
        for r in cooc_rows:
            edges_out.append({
                "kind": "tag_cooc",
                "source": f"tag:{r[0]}",
                "target": f"tag:{r[1]}",
                "weight": int(r[2]),
            })

    # --- contextual edges (ctx_author / ctx_part / ctx_tag) ---
    if include_context and domain_slugs:
        ctx = await _ctx_edges(s, list(domain_slugs), noise)
        edges_out.extend(ctx)

    # --- triple 엣지 (graph-edge-predicates) ---
    if include_triples and domain_slugs:
        edges_out.extend(await _triple_edges(s, set(domain_slugs)))

    return {
        "nodes": nodes_out,
        "edges": edges_out,
    }


@router.get(
    "/graph",
    summary="Wiki link 그래프 (BFS) + 이종 그래프 (domain)",
    description=(
        "root 가 주어지면 depth 까지 BFS 확장. 미지정시 degree 상위 200 노드 "
        "+ 그 사이의 엣지를 반환.\n\n"
        "domain 지정 시 그 super-domain 의 tag 를 가진 published doc 들 + wiki 엣지 반환. "
        "include_tags=1 이면 tag 노드 추가. include_doc_tag_edges=1 이면 doc-tag 소속 엣지 추가. "
        "include_tag_cooc=1 이면 tag-tag 공동출현 엣지 추가. "
        "include_context=1 이면 contextual 약한 관계 엣지 추가 "
        "(kind=ctx_author/ctx_part/ctx_tag). 기본 OFF — 도메인 규모에 따라 비용 있음."
    ),
)
async def get_graph(
    root: str | None = Query(default=None),
    depth: int = Query(default=2, ge=1, le=4),
    domain: str | None = Query(default=None),
    include_tags: bool = Query(default=False),
    include_doc_tag_edges: bool = Query(default=False),
    include_tag_cooc: bool = Query(default=False),
    include_context: bool = Query(default=False),
    include_triples: bool = Query(default=False),
    # 전역 (root/domain 없음) 경로의 노드 cap.
    # 기본 200 (기존 동작 보존) — `/graph/all` 같은 전체 보기 페이지에선 충분히
    # 크게 (5000+) 호출. wiki edge 가 있는 doc 만 후보라서 실제로는 훨씬 적음.
    limit: int = Query(default=200, ge=10, le=20000),
    s: AsyncSession = Depends(get_db),
    _user: dict = Depends(require_reader),
) -> dict[str, Any]:

    # --- domain 지정 경로 ---
    if domain:
        payload = await _domain_subgraph(
            s,
            domain,
            root=root,
            depth=depth,
            include_tags=include_tags,
            include_doc_tag_edges=include_doc_tag_edges,
            include_tag_cooc=include_tag_cooc,
            include_context=include_context,
            include_triples=include_triples,
        )
        meta: dict[str, Any] = {
            "domain": domain,
            "count": len(payload["nodes"]),
            "edge_count": len(payload["edges"]),
        }
        if root:
            meta["root"] = root
            meta["depth"] = depth
        return envelope(data=payload, meta=meta)

    # --- 기존 경로 (backward compat) ---
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
            {"kind": "wiki", "source": src, "target": tgt, "count": cnt}
            for src, tgt, cnt in edges
            if src in visited and tgt in visited
        ]
        if include_triples:
            kept_edges = kept_edges + await _triple_edges(s, visited)
        nodes_map = await _fetch_nodes(s, visited)
        nodes_list = [dict(kind="doc", **v) for v in nodes_map.values()]
        return envelope(
            data={
                "nodes": nodes_list,
                "edges": kept_edges,
            },
            meta={"root": root, "depth": depth, "count": len(visited)},
        )

    # 전역 — degree 상위 `limit` (기본 200, /graph/all 에선 5000+).
    deg: dict[str, int] = {}
    for src, tgt, cnt in edges:
        deg[src] = deg.get(src, 0) + cnt
        deg[tgt] = deg.get(tgt, 0) + cnt
    top = sorted(deg.items(), key=lambda kv: kv[1], reverse=True)[:limit]
    keep: set[str] = {k for k, _ in top}
    kept_edges = [
        {"kind": "wiki", "source": src, "target": tgt, "count": cnt}
        for src, tgt, cnt in edges
        if src in keep and tgt in keep
    ]
    if include_triples:
        kept_edges = kept_edges + await _triple_edges(s, keep)
    nodes_map = await _fetch_nodes(s, keep)
    nodes_list = [dict(kind="doc", **v) for v in nodes_map.values()]
    return envelope(
        data={
            "nodes": nodes_list,
            "edges": kept_edges,
        },
        meta={"count": len(keep), "global": True},
    )
