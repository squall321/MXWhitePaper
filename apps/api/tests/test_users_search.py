"""Polish D — 유저 검색 (owner 자동완성)."""
from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.mark.asyncio
async def test_users_search_returns_admin() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/v1/users/search", params={"q": "admin"})
    assert r.status_code == 200, r.text
    body = r.json()
    emails = [u["email"] for u in body["data"]]
    assert "admin@mx.local" in emails
