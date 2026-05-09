"""Series router — CRUD + ordering + neighbours.

Each test wipes the test series rows up-front so re-runs are deterministic.
"""
from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.core.db import get_db
from app.main import app

SLUG_A = "month-end-closing"
SLUG_B = "onboarding-guide"
SLUG_C = "kpi-dashboard-guide"


async def _client() -> AsyncClient:
    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://test")


async def _new_session():
    gen = get_db()
    s = await anext(gen)
    return s, gen


async def _close_session(gen) -> None:
    try:
        await anext(gen)
    except StopAsyncIteration:
        pass


@pytest.fixture(autouse=True)
async def _wipe_test_series():
    """Drop any test-series rows before *and* after each test."""
    s, gen = await _new_session()
    try:
        await s.execute(
            text(
                "DELETE FROM doc_series WHERE slug LIKE 'pytest-series-%'"
            )
        )
        await s.commit()
    finally:
        await _close_session(gen)
    yield
    s, gen = await _new_session()
    try:
        await s.execute(
            text(
                "DELETE FROM doc_series WHERE slug LIKE 'pytest-series-%'"
            )
        )
        await s.commit()
    finally:
        await _close_session(gen)


async def _doc_id(slug: str) -> str:
    s, gen = await _new_session()
    try:
        row = (await s.execute(
            text("SELECT id FROM documents WHERE slug = :s"), {"s": slug},
        )).first()
        assert row, f"seed doc missing: {slug}"
        return str(row[0])
    finally:
        await _close_session(gen)


@pytest.mark.asyncio
async def test_create_then_list_then_get_series() -> None:
    async with await _client() as ac:
        r = await ac.post(
            "/api/v1/series",
            json={
                "slug": "pytest-series-1",
                "title": "Test Series 1",
                "description": "demo",
            },
        )
        assert r.status_code == 201, r.text
        body = r.json()["data"]
        assert body["slug"] == "pytest-series-1"
        assert body["title"] == "Test Series 1"
        assert body["items"] == []

        # Duplicate slug → 409.
        r2 = await ac.post(
            "/api/v1/series",
            json={"slug": "pytest-series-1", "title": "Dup"},
        )
        assert r2.status_code == 409

        rl = await ac.get("/api/v1/series")
        assert rl.status_code == 200
        rows = rl.json()["data"]["items"]
        match = next((x for x in rows if x["slug"] == "pytest-series-1"), None)
        assert match is not None
        assert match["item_count"] == 0

        rg = await ac.get("/api/v1/series/pytest-series-1")
        assert rg.status_code == 200
        detail = rg.json()["data"]
        assert detail["title"] == "Test Series 1"
        assert detail["items"] == []


@pytest.mark.asyncio
async def test_patch_and_delete_series() -> None:
    async with await _client() as ac:
        await ac.post(
            "/api/v1/series",
            json={"slug": "pytest-series-2", "title": "Original"},
        )
        rp = await ac.patch(
            "/api/v1/series/pytest-series-2",
            json={"title": "Updated", "description": "now with desc"},
        )
        assert rp.status_code == 200, rp.text
        body = rp.json()["data"]
        assert body["title"] == "Updated"
        assert body["description"] == "now with desc"

        rd = await ac.delete("/api/v1/series/pytest-series-2")
        assert rd.status_code == 204
        rg = await ac.get("/api/v1/series/pytest-series-2")
        assert rg.status_code == 404


@pytest.mark.asyncio
async def test_add_remove_items_default_position() -> None:
    a = await _doc_id(SLUG_A)
    b = await _doc_id(SLUG_B)

    async with await _client() as ac:
        await ac.post(
            "/api/v1/series",
            json={"slug": "pytest-series-3", "title": "Three"},
        )
        ra = await ac.post(
            "/api/v1/series/pytest-series-3/items",
            json={"document_id": a},
        )
        assert ra.status_code == 201, ra.text
        rb = await ac.post(
            "/api/v1/series/pytest-series-3/items",
            json={"document_id": b},
        )
        assert rb.status_code == 201

        rg = await ac.get("/api/v1/series/pytest-series-3")
        items = rg.json()["data"]["items"]
        assert [it["slug"] for it in items] == [SLUG_A, SLUG_B]
        assert [it["position"] for it in items] == [0, 1]

        # Adding the same doc twice → 409.
        rdup = await ac.post(
            "/api/v1/series/pytest-series-3/items",
            json={"document_id": a},
        )
        assert rdup.status_code == 409

        # Remove one.
        rr = await ac.delete(
            f"/api/v1/series/pytest-series-3/items/{a}"
        )
        assert rr.status_code == 204
        rg2 = await ac.get("/api/v1/series/pytest-series-3")
        assert [it["slug"] for it in rg2.json()["data"]["items"]] == [SLUG_B]


@pytest.mark.asyncio
async def test_reorder_item() -> None:
    a = await _doc_id(SLUG_A)
    b = await _doc_id(SLUG_B)
    c = await _doc_id(SLUG_C)
    async with await _client() as ac:
        await ac.post(
            "/api/v1/series",
            json={"slug": "pytest-series-4", "title": "Four"},
        )
        for did in (a, b, c):
            await ac.post(
                "/api/v1/series/pytest-series-4/items",
                json={"document_id": did},
            )
        # Move A to last position (2). Now order = b, c, a (sorted by position).
        rp = await ac.patch(
            f"/api/v1/series/pytest-series-4/items/{a}",
            json={"position": 5},
        )
        assert rp.status_code == 200, rp.text
        rg = await ac.get("/api/v1/series/pytest-series-4")
        slugs = [it["slug"] for it in rg.json()["data"]["items"]]
        assert slugs == [SLUG_B, SLUG_C, SLUG_A]


@pytest.mark.asyncio
async def test_document_series_neighbours() -> None:
    a = await _doc_id(SLUG_A)
    b = await _doc_id(SLUG_B)
    c = await _doc_id(SLUG_C)
    async with await _client() as ac:
        await ac.post(
            "/api/v1/series",
            json={"slug": "pytest-series-5", "title": "Five"},
        )
        for did in (a, b, c):
            await ac.post(
                "/api/v1/series/pytest-series-5/items",
                json={"document_id": did},
            )
        # Middle doc (B) should have A as prev, C as next.
        rb = await ac.get(f"/api/v1/documents/{SLUG_B}/series")
        assert rb.status_code == 200, rb.text
        items = rb.json()["data"]["items"]
        assert len(items) == 1
        e = items[0]
        assert e["slug"] == "pytest-series-5"
        assert e["total"] == 3
        assert e["position"] == 1
        assert e["prev"] == {"slug": SLUG_A, "title": e["prev"]["title"]}
        assert e["next"]["slug"] == SLUG_C

        # First doc (A) → prev is None.
        ra = await ac.get(f"/api/v1/documents/{SLUG_A}/series")
        ea = ra.json()["data"]["items"][0]
        assert ea["prev"] is None
        assert ea["next"]["slug"] == SLUG_B

        # Last doc (C) → next is None.
        rc = await ac.get(f"/api/v1/documents/{SLUG_C}/series")
        ec = rc.json()["data"]["items"][0]
        assert ec["next"] is None
        assert ec["prev"]["slug"] == SLUG_B


@pytest.mark.asyncio
async def test_document_not_in_any_series_returns_empty() -> None:
    async with await _client() as ac:
        r = await ac.get(f"/api/v1/documents/{SLUG_A}/series")
        assert r.status_code == 200
        assert r.json()["data"]["items"] == []


@pytest.mark.asyncio
async def test_get_unknown_series_returns_404() -> None:
    async with await _client() as ac:
        r = await ac.get("/api/v1/series/does-not-exist")
        assert r.status_code == 404


@pytest.mark.asyncio
async def test_add_item_with_unknown_doc_returns_404() -> None:
    async with await _client() as ac:
        await ac.post(
            "/api/v1/series",
            json={"slug": "pytest-series-6", "title": "Six"},
        )
        # Well-formed UUID that doesn't match any document.
        r = await ac.post(
            "/api/v1/series/pytest-series-6/items",
            json={"document_id": "00000000-0000-0000-0000-000000000000"},
        )
        assert r.status_code == 404
