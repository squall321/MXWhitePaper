"""Snippets CRUD + scope filter + use_count semantics."""
from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


async def _client() -> AsyncClient:
    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://test")


def _sample_blocks() -> list[dict]:
    return [
        {"type": "paragraph", "id": "01ABCDEFGH0123456789ABCDEF", "text": "안녕"},
    ]


async def _wipe_owned(ac: AsyncClient) -> None:
    """Each test starts clean — only operates on the calling user's snippets."""
    r = await ac.get("/api/v1/snippets?scope=private&limit=200")
    if r.status_code != 200:
        return
    for it in r.json()["data"]["items"]:
        # Best-effort delete — anything not owned will 403, ignore.
        await ac.delete(f"/api/v1/snippets/{it['id']}")


@pytest.mark.asyncio
async def test_create_then_list_then_get_bumps_use_count() -> None:
    async with await _client() as ac:
        await _wipe_owned(ac)
        r = await ac.post(
            "/api/v1/snippets",
            json={
                "name": "Sample 1",
                "description": "demo",
                "blocks": _sample_blocks(),
                "scope": "private",
                "tags": ["a", "b"],
            },
        )
        assert r.status_code == 201, r.text
        sid = r.json()["data"]["snippet_id"]
        try:
            r2 = await ac.get("/api/v1/snippets")
            assert r2.status_code == 200
            items = r2.json()["data"]["items"]
            match = next((it for it in items if it["id"] == sid), None)
            assert match is not None
            assert match["name"] == "Sample 1"
            assert match["block_count"] == 1
            assert match["use_count"] == 0

            # Fetching the full snippet bumps use_count.
            r3 = await ac.get(f"/api/v1/snippets/{sid}")
            assert r3.status_code == 200
            data = r3.json()["data"]
            assert data["use_count"] == 1
            assert data["blocks"][0]["text"] == "안녕"

            # Second fetch bumps again.
            r4 = await ac.get(f"/api/v1/snippets/{sid}")
            assert r4.json()["data"]["use_count"] == 2

            # /use marker also bumps.
            r5 = await ac.post(f"/api/v1/snippets/{sid}/use")
            assert r5.status_code == 200
            assert r5.json()["data"]["use_count"] == 3
        finally:
            await ac.delete(f"/api/v1/snippets/{sid}")


@pytest.mark.asyncio
async def test_patch_updates_name_and_scope() -> None:
    async with await _client() as ac:
        await _wipe_owned(ac)
        r = await ac.post(
            "/api/v1/snippets",
            json={"name": "before", "blocks": _sample_blocks(), "scope": "private"},
        )
        sid = r.json()["data"]["snippet_id"]
        try:
            r2 = await ac.patch(
                f"/api/v1/snippets/{sid}",
                json={"name": "after", "scope": "org", "tags": ["x"]},
            )
            assert r2.status_code == 200, r2.text
            data = r2.json()["data"]
            assert data["name"] == "after"
            assert data["scope"] == "org"
            assert data["tags"] == ["x"]
        finally:
            await ac.delete(f"/api/v1/snippets/{sid}")


@pytest.mark.asyncio
async def test_create_rejects_empty_blocks() -> None:
    async with await _client() as ac:
        r = await ac.post(
            "/api/v1/snippets",
            json={"name": "x", "blocks": [], "scope": "private"},
        )
        assert r.status_code == 422


@pytest.mark.asyncio
async def test_create_rejects_invalid_scope() -> None:
    async with await _client() as ac:
        r = await ac.post(
            "/api/v1/snippets",
            json={"name": "x", "blocks": _sample_blocks(), "scope": "wat"},
        )
        # 422 from our explicit scope check.
        assert r.status_code == 422


@pytest.mark.asyncio
async def test_get_unknown_returns_404() -> None:
    async with await _client() as ac:
        r = await ac.get("/api/v1/snippets/00000000-0000-0000-0000-000000000000")
        assert r.status_code == 404


@pytest.mark.asyncio
async def test_scope_filter_and_q_search() -> None:
    async with await _client() as ac:
        await _wipe_owned(ac)
        r1 = await ac.post(
            "/api/v1/snippets",
            json={
                "name": "alpha-beta-gamma",
                "blocks": _sample_blocks(),
                "scope": "org",
            },
        )
        r2 = await ac.post(
            "/api/v1/snippets",
            json={
                "name": "delta",
                "blocks": _sample_blocks(),
                "scope": "private",
            },
        )
        sid1 = r1.json()["data"]["snippet_id"]
        sid2 = r2.json()["data"]["snippet_id"]
        try:
            # scope filter
            r_org = await ac.get("/api/v1/snippets?scope=org")
            ids = [it["id"] for it in r_org.json()["data"]["items"]]
            assert sid1 in ids
            assert sid2 not in ids

            # q filter
            r_q = await ac.get("/api/v1/snippets?q=beta")
            ids = [it["id"] for it in r_q.json()["data"]["items"]]
            assert sid1 in ids
            assert sid2 not in ids
        finally:
            await ac.delete(f"/api/v1/snippets/{sid1}")
            await ac.delete(f"/api/v1/snippets/{sid2}")


@pytest.mark.asyncio
async def test_delete_then_get_returns_404() -> None:
    async with await _client() as ac:
        r = await ac.post(
            "/api/v1/snippets",
            json={"name": "to-delete", "blocks": _sample_blocks()},
        )
        sid = r.json()["data"]["snippet_id"]
        rd = await ac.delete(f"/api/v1/snippets/{sid}")
        assert rd.status_code == 204
        rg = await ac.get(f"/api/v1/snippets/{sid}")
        assert rg.status_code == 404
