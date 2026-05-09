"""Doc Dependency Graph (Cycle 7).

위키 링크([[slug]]) 그래프 — content_json 본문을 서버사이드에서 정규식으로
스캔해 노드/엣지를 만들어준다. `links` 테이블은 사용하지 않는다 (그쪽은
저장 시 한 번만 동기화되는 구조라 CSV import 등으로 들어온 본문이 누락될 수
있어 본 라우터는 본문을 권위 소스로 본다).

엔드포인트:
  GET /api/v1/dep-graph?root_slug=<slug>&depth=<int>   (reader+)
  GET /api/v1/dep-graph/orphans                          (admin)

응답 shape:
  {
    nodes: [{slug, title, count_in, count_out}],
    edges: [{from, to, count}]
  }

캐시: 5분 in-process — root_slug+depth 조합별. 본문 변경에는 즉시
반응하지 않으므로 작성자 입장에서 "최근 추가한 링크가 안 보인다"는 문의가
오면 5분 기다리거나 재배포가 필요하다.
"""
from __future__ import annotations

import re
import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import require_admin, require_reader
from app.core.db import get_db
from app.core.errors import envelope

router = APIRouter(prefix="/api/v1/dep-graph", tags=["dep-graph"])


# wiki_link_extractor 와 동일한 grammar — 한글 slug 도 허용 (Polish D).
_WIKI_LINK_RE = re.compile(
    r"\[\[([a-z0-9가-힣][a-z0-9가-힣-]{0,99})"
    r"(?:#[0-9]+(?:\.[0-9]+){0,2})?"
    r"(?:\|[^\]]+)?\]\]"
)


def extract_slugs(content_json: Any) -> list[str]:
    """content_json (dict) 안의 모든 문자열을 dump 해서 [[slug]] 추출.

    지나치게 단순해 보이지만 실제로 충분하다 — DocumentJSON v1.0 안에
    위키 링크 가능 위치는 모두 string 안에 있어서 string 전체를 모아
    한 번에 regex 를 돌려도 정확도가 같다. 추출기가 별도로 walk 하는
    이유는 source_path 메타 정보를 함께 기록해 links 테이블에 넣기
    위함이며, 그래프 빌드에는 슬러그 셋만 있으면 된다.
    """
    if not isinstance(content_json, dict):
        return []
    out: list[str] = []
    stack: list[Any] = [content_json]
    while stack:
        cur = stack.pop()
        if isinstance(cur, dict):
            stack.extend(cur.values())
        elif isinstance(cur, list):
            stack.extend(cur)
        elif isinstance(cur, str):
            for m in _WIKI_LINK_RE.finditer(cur):
                out.append(m.group(1))
    return out


# ---------------------------------------------------------------------------
# 5분 in-process 캐시. 단일 replica 가정. multi-replica 면 개별 캐시가
# 일관되지 않을 수 있는데, depth 별 그래프는 strict 일관성이 필요한 데이터가
# 아니므로 허용 가능하다.
# ---------------------------------------------------------------------------
_CACHE_TTL_S = 300.0
_cache: dict[tuple[str, int], tuple[float, dict[str, Any]]] = {}


def _cache_get(key: tuple[str, int]) -> dict[str, Any] | None:
    entry = _cache.get(key)
    if not entry:
        return None
    expires, data = entry
    if expires < time.monotonic():
        _cache.pop(key, None)
        return None
    return data


def _cache_set(key: tuple[str, int], data: dict[str, Any]) -> None:
    _cache[key] = (time.monotonic() + _CACHE_TTL_S, data)


def _cache_clear() -> None:
    _cache.clear()


async def _load_doc_index(
    s: AsyncSession,
) -> tuple[dict[str, str], dict[str, list[str]]]:
    """문서 슬러그 → 제목 / 슬러그 → outgoing slug 리스트 인덱스를 만든다.

    archived 문서는 제외한다. 결과는 caller 가 BFS 에서 사용한다.
    """
    rows = (await s.execute(
        text(
            "SELECT slug, title, content_json FROM documents "
            "WHERE status != 'archived'"
        ),
    )).all()
    title_by_slug: dict[str, str] = {}
    outgoing: dict[str, list[str]] = {}
    for slug, title, content_json in rows:
        title_by_slug[slug] = title
        outgoing[slug] = extract_slugs(content_json)
    return title_by_slug, outgoing


def _build_graph(
    root_slug: str,
    depth: int,
    title_by_slug: dict[str, str],
    outgoing: dict[str, list[str]],
) -> dict[str, Any]:
    """root_slug 에서 양방향 BFS 로 depth hop 만큼 확장.

    cycle 은 visited set 로 자연스럽게 차단된다 (한 노드에 두 번 들어가지
    않음). max depth 는 4 (라우터 단에서 검증).
    """
    incoming: dict[str, list[str]] = {}
    for src, targets in outgoing.items():
        for t in targets:
            incoming.setdefault(t, []).append(src)

    visited: set[str] = {root_slug}
    frontier: set[str] = {root_slug}
    for _ in range(depth):
        nxt: set[str] = set()
        for node in frontier:
            for t in outgoing.get(node, []):
                if t not in visited:
                    nxt.add(t)
            for s_ in incoming.get(node, []):
                if s_ not in visited:
                    nxt.add(s_)
        visited.update(nxt)
        frontier = nxt
        if not frontier:
            break

    # 엣지 — visited 안의 (source, target, count). count 는 같은 (s,t) 가
    # 본문에 여러 번 등장할 때 누적.
    edge_counts: dict[tuple[str, str], int] = {}
    for src in visited:
        for t in outgoing.get(src, []):
            if t in visited:
                edge_counts[(src, t)] = edge_counts.get((src, t), 0) + 1

    # 노드 — count_in / count_out 은 visited 부분 그래프 기준이 아니라
    # 전역 그래프 기준 (사용자가 "이 문서가 얼마나 참조되나?" 를 보고
    # 싶기 때문). 이렇게 해두면 그래프 시각화에서도 영향력 있는 노드를
    # 한눈에 알아볼 수 있다.
    global_in: dict[str, int] = {}
    global_out: dict[str, int] = {}
    for src, targets in outgoing.items():
        global_out[src] = len(targets)
        for t in targets:
            global_in[t] = global_in.get(t, 0) + 1

    nodes = []
    for slug in visited:
        nodes.append({
            "slug": slug,
            # 미존재(archived 또는 dangling) 슬러그는 제목 없음 — slug 로 fallback.
            "title": title_by_slug.get(slug, slug),
            "count_in": global_in.get(slug, 0),
            "count_out": global_out.get(slug, 0),
        })
    edges = [
        {"from": s_, "to": t, "count": c}
        for (s_, t), c in edge_counts.items()
    ]
    return {"nodes": nodes, "edges": edges}


@router.get(
    "",
    summary="문서 의존성 그래프 (BFS)",
    description=(
        "root_slug 에서 양방향(나가는/들어오는) BFS 로 depth 만큼 확장. "
        "본문(content_json) 의 [[slug]] 위키 링크를 권위 소스로 사용한다. "
        "결과는 5분 in-process 캐시 — 본문 수정 직후에는 반영이 지연될 수 있다."
    ),
)
async def get_dep_graph(
    root_slug: str = Query(..., description="중심 문서 슬러그"),
    depth: int = Query(default=2, ge=1, le=4),
    s: AsyncSession = Depends(get_db),
    _user: dict = Depends(require_reader),
) -> dict[str, Any]:
    cache_key = (root_slug, depth)
    cached = _cache_get(cache_key)
    if cached is not None:
        return envelope(data=cached, meta={"cached": True, "depth": depth})

    title_by_slug, outgoing = await _load_doc_index(s)
    payload = _build_graph(root_slug, depth, title_by_slug, outgoing)
    _cache_set(cache_key, payload)
    return envelope(data=payload, meta={"cached": False, "depth": depth})


@router.get(
    "/orphans",
    summary="고아 문서 (incoming wiki link 0건)",
    description=(
        "어떤 문서도 [[slug]] 로 참조하지 않는 문서들을 모은다. 정리 / "
        "보강 후보를 찾을 때 admin 이 사용한다."
    ),
)
async def get_orphans(
    s: AsyncSession = Depends(get_db),
    _user: dict = Depends(require_admin),
) -> dict[str, Any]:
    title_by_slug, outgoing = await _load_doc_index(s)
    referenced: set[str] = set()
    for targets in outgoing.values():
        referenced.update(targets)
    orphans = [
        {"slug": slug, "title": title_by_slug[slug]}
        for slug in title_by_slug
        if slug not in referenced
    ]
    orphans.sort(key=lambda x: x["slug"])
    return envelope(data={"orphans": orphans}, meta={"count": len(orphans)})
