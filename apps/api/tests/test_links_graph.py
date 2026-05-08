"""Tier 2C — wiki link graph endpoint."""
from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.mark.asyncio
async def test_global_graph_shape() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/v1/links/graph")
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert "nodes" in data and isinstance(data["nodes"], list)
    assert "edges" in data and isinstance(data["edges"], list)
    if data["nodes"]:
        n = data["nodes"][0]
        assert "slug" in n and "title" in n and "status" in n
    for e in data["edges"]:
        assert "source" in e and "target" in e and "count" in e
        assert isinstance(e["count"], int) and e["count"] >= 1


@pytest.mark.asyncio
async def test_root_bfs_within_depth() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get(
            "/api/v1/links/graph",
            params={"root": "month-end-closing", "depth": 2},
        )
    assert r.status_code == 200
    data = r.json()["data"]
    slugs = {n["slug"] for n in data["nodes"]}
    # root 가 결과에 포함되어야 한다
    assert "month-end-closing" in slugs


@pytest.mark.asyncio
async def test_unknown_root_returns_only_self() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get(
            "/api/v1/links/graph",
            params={"root": "no-such-slug-zzz", "depth": 1},
        )
    assert r.status_code == 200
    data = r.json()["data"]
    slugs = {n["slug"] for n in data["nodes"]}
    assert slugs == {"no-such-slug-zzz"}
    assert data["edges"] == []
