"""POST /reads + GET /reads/recent."""
from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app

SEED_SLUG = "month-end-closing"


async def _client() -> AsyncClient:
    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://test")


@pytest.mark.asyncio
async def test_post_read_accumulates_seconds() -> None:
    async with await _client() as ac:
        r1 = await ac.post(
            "/api/v1/reads",
            json={"document_id": SEED_SLUG, "read_seconds": 30},
        )
        assert r1.status_code == 200, r1.text
        first_total = r1.json()["data"]["read_seconds"]
        assert first_total >= 30

        r2 = await ac.post(
            "/api/v1/reads",
            json={"document_id": SEED_SLUG, "read_seconds": 15},
        )
        assert r2.status_code == 200
        second_total = r2.json()["data"]["read_seconds"]
        assert second_total == first_total + 15


@pytest.mark.asyncio
async def test_recent_reads_returns_doc() -> None:
    async with await _client() as ac:
        await ac.post(
            "/api/v1/reads",
            json={"document_id": SEED_SLUG, "read_seconds": 5},
        )
        r = await ac.get("/api/v1/reads/recent?limit=10")
        assert r.status_code == 200
        items = r.json()["data"]["items"]
        match = next((it for it in items if it["slug"] == SEED_SLUG), None)
        assert match is not None
        assert match["read_seconds"] >= 5
        assert "read_at" in match


@pytest.mark.asyncio
async def test_post_read_unknown_doc_returns_404() -> None:
    async with await _client() as ac:
        r = await ac.post(
            "/api/v1/reads",
            json={"document_id": "no-such-slug-xyz", "read_seconds": 1},
        )
        assert r.status_code == 404


@pytest.mark.asyncio
async def test_post_read_validates_seconds() -> None:
    async with await _client() as ac:
        r = await ac.post(
            "/api/v1/reads",
            json={"document_id": SEED_SLUG, "read_seconds": -1},
        )
        assert r.status_code == 422
