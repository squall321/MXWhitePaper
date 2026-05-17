"""Cycle 7 — doc dependency graph (content_json 본문 기반).

Covers:
  - extract_slugs regex (기본 / pipe / anchor / 한글)
  - BFS depth 제한 + cycle 처리 (visited)
  - 캐시 히트/무효화
  - /orphans (admin-only)
  - 권한 (reader, anonymous)
"""
from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.routers import dep_graph as dg

# ── extract_slugs ───────────────────────────────────────────────────────


def test_extract_slugs_basic() -> None:
    cj = {
        "sections": [
            {
                "title": "Intro",
                "blocks": [
                    {"type": "paragraph", "text": "see [[other-doc]] and [[a-b]]"}
                ],
            }
        ]
    }
    slugs = dg.extract_slugs(cj)
    assert slugs == ["other-doc", "a-b"]


def test_extract_slugs_with_pipe_and_anchor() -> None:
    cj = {
        "sections": [
            {
                "title": "[[abc#1.2|disp]]",
                "blocks": [
                    {"type": "callout", "title": "x", "text": "[[xyz|nick]]"},
                ],
            }
        ]
    }
    slugs = sorted(dg.extract_slugs(cj))
    assert slugs == ["abc", "xyz"]


def test_extract_slugs_korean() -> None:
    cj = {"sections": [{"title": "[[월말마감]] 참고"}]}
    assert dg.extract_slugs(cj) == ["월말마감"]


def test_extract_slugs_empty_or_invalid() -> None:
    assert dg.extract_slugs({}) == []
    assert dg.extract_slugs({"sections": []}) == []
    assert dg.extract_slugs(None) == []  # type: ignore[arg-type]
    # malformed wiki link: 한 쪽 괄호만 있으면 무시.
    cj = {"sections": [{"title": "[abc] and [[no-close"}]}
    assert dg.extract_slugs(cj) == []


# ── BFS depth + cycle 처리 ──────────────────────────────────────────────


def _idx(graph: dict[str, list[str]]) -> tuple[dict[str, str], dict[str, list[str]]]:
    titles = {k: k.upper() for k in graph}
    return titles, dict(graph)


def test_bfs_depth_one_returns_immediate_neighbours() -> None:
    titles, out = _idx({"a": ["b", "c"], "b": [], "c": ["d"], "d": []})
    g = dg._build_graph("a", 1, titles, out)
    slugs = {n["slug"] for n in g["nodes"]}
    assert slugs == {"a", "b", "c"}  # d 는 depth 2 에 있음


def test_bfs_depth_two_picks_up_two_hops() -> None:
    titles, out = _idx({"a": ["b"], "b": ["c"], "c": ["d"], "d": []})
    g = dg._build_graph("a", 2, titles, out)
    slugs = {n["slug"] for n in g["nodes"]}
    assert slugs == {"a", "b", "c"}


def test_bfs_handles_cycles_without_infinite_loop() -> None:
    titles, out = _idx({"a": ["b"], "b": ["c"], "c": ["a"]})
    g = dg._build_graph("a", 4, titles, out)
    slugs = {n["slug"] for n in g["nodes"]}
    assert slugs == {"a", "b", "c"}
    # 엣지 (a→b, b→c, c→a) 모두 포함
    edge_pairs = {(e["from"], e["to"]) for e in g["edges"]}
    assert ("a", "b") in edge_pairs
    assert ("b", "c") in edge_pairs
    assert ("c", "a") in edge_pairs


def test_bfs_bidirectional_picks_up_incoming() -> None:
    """root 를 가리키는 이웃도 depth 안에서 잡혀야 한다."""
    titles, out = _idx({"a": ["b"], "x": ["a"], "b": []})
    g = dg._build_graph("a", 1, titles, out)
    slugs = {n["slug"] for n in g["nodes"]}
    assert slugs == {"a", "b", "x"}


def test_bfs_unknown_root_returns_only_self() -> None:
    titles, out = _idx({"a": ["b"], "b": []})
    g = dg._build_graph("zzz", 2, titles, out)
    slugs = {n["slug"] for n in g["nodes"]}
    assert slugs == {"zzz"}
    assert g["edges"] == []


def test_node_counts_use_global_degree() -> None:
    titles, out = _idx({"a": ["b", "b"], "b": [], "x": ["b"]})
    g = dg._build_graph("a", 1, titles, out)
    by_slug = {n["slug"]: n for n in g["nodes"]}
    # b 는 visited 부분그래프에서는 a→b 만 있지만 전역으로는 in=3 (a 두번 + x)
    assert by_slug["b"]["count_in"] == 3
    assert by_slug["a"]["count_out"] == 2


# ── 캐시 ────────────────────────────────────────────────────────────────


def test_cache_returns_same_payload_within_ttl() -> None:
    dg._cache_clear()
    payload = {"nodes": [], "edges": []}
    dg._cache_set(("foo", 2), payload)
    assert dg._cache_get(("foo", 2)) is payload


def test_cache_clear_invalidates() -> None:
    dg._cache_clear()
    dg._cache_set(("foo", 2), {"nodes": [], "edges": []})
    dg._cache_clear()
    assert dg._cache_get(("foo", 2)) is None


def test_cache_keyed_by_root_and_depth() -> None:
    dg._cache_clear()
    dg._cache_set(("foo", 2), {"nodes": [{"slug": "x"}], "edges": []})
    # 같은 root 라도 depth 가 다르면 미스.
    assert dg._cache_get(("foo", 3)) is None


# ── HTTP — 응답 shape + 검증. dev 모드는 anonymous → admin fallback 이라
# 401 은 production 환경에서만 발생한다 (단위 테스트로는 검증 못 함). ────


@pytest.mark.asyncio
async def test_dep_graph_returns_envelope_with_unknown_root() -> None:
    """알 수 없는 슬러그 → 그래프에는 root 자체만 포함."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get(
            "/api/v1/dep-graph",
            params={"root_slug": "no-such-slug-zzz", "depth": 1},
        )
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    slugs = {n["slug"] for n in data["nodes"]}
    assert slugs == {"no-such-slug-zzz"}
    assert data["edges"] == []


@pytest.mark.asyncio
async def test_dep_graph_max_depth_capped() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get(
            "/api/v1/dep-graph",
            params={"root_slug": "any", "depth": 99},
        )
    # depth>4 는 422 (Query validator) 로 거절.
    assert r.status_code == 422, r.text


@pytest.mark.asyncio
async def test_orphans_returns_envelope() -> None:
    """admin 만 호출 가능 — dev 모드에서는 fallback 으로 200."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/v1/dep-graph/orphans")
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert "orphans" in data and isinstance(data["orphans"], list)


@pytest.mark.asyncio
async def test_dep_graph_caches_within_ttl() -> None:
    """두 번째 호출은 meta.cached=true 로 응답."""
    dg._cache_clear()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r1 = await ac.get(
            "/api/v1/dep-graph",
            params={"root_slug": "cache-probe-zzz", "depth": 1},
        )
        r2 = await ac.get(
            "/api/v1/dep-graph",
            params={"root_slug": "cache-probe-zzz", "depth": 1},
        )
    assert r1.status_code == 200 and r2.status_code == 200
    assert r1.json()["meta"]["cached"] is False
    assert r2.json()["meta"]["cached"] is True
