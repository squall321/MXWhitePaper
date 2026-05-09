"""Sharing — Crockford-base32 short_id alias + /share/short/:short_id resolver."""
from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.core.db import get_db
from app.main import app
from app.routers.sharing import _CROCKFORD, _SHORT_ID_LEN, _gen_short_id

SEED_SLUG = "month-end-closing"


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


async def _wipe_all_share_links() -> None:
    s, gen = await _new_session()
    try:
        await s.execute(
            text(
                """
                DELETE FROM share_links
                WHERE document_id = (SELECT id FROM documents WHERE slug = :s)
                """
            ),
            {"s": SEED_SLUG},
        )
        await s.commit()
    finally:
        await _close_session(gen)


def test_gen_short_id_uses_crockford_alphabet_and_length() -> None:
    seen: set[str] = set()
    for _ in range(50):
        sid = _gen_short_id()
        assert len(sid) == _SHORT_ID_LEN
        # Forbidden chars (Crockford drops I, L, O, U).
        assert all(ch not in sid for ch in "ILOU")
        assert all(ch in _CROCKFORD for ch in sid)
        seen.add(sid)
    # 30 random bits → collisions in 50 draws are astronomically unlikely.
    assert len(seen) >= 49


@pytest.mark.asyncio
async def test_create_share_returns_short_id_and_short_url() -> None:
    await _wipe_all_share_links()
    async with await _client() as ac:
        r = await ac.post(f"/api/v1/documents/{SEED_SLUG}/share", json={})
        assert r.status_code == 201, r.text
        data = r.json()["data"]
        assert isinstance(data["short_id"], str)
        assert len(data["short_id"]) == _SHORT_ID_LEN
        assert data["short_url"] == f"/share/short/{data['short_id']}"


@pytest.mark.asyncio
async def test_short_id_resolver_redirects_to_token() -> None:
    await _wipe_all_share_links()
    async with await _client() as ac:
        r = await ac.post(f"/api/v1/documents/{SEED_SLUG}/share", json={})
        data = r.json()["data"]
        short_id = data["short_id"]
        token = data["token"]

        rg = await ac.get(
            f"/api/v1/share/short/{short_id}", follow_redirects=False
        )
        assert rg.status_code == 302, rg.text
        assert rg.headers["location"] == f"/share/{token}"


@pytest.mark.asyncio
async def test_short_id_resolver_404_on_unknown() -> None:
    async with await _client() as ac:
        rg = await ac.get(
            "/api/v1/share/short/ZZZZZZ", follow_redirects=False
        )
        assert rg.status_code == 404


@pytest.mark.asyncio
async def test_list_links_exposes_short_id() -> None:
    await _wipe_all_share_links()
    async with await _client() as ac:
        await ac.post(f"/api/v1/documents/{SEED_SLUG}/share", json={})
        rl = await ac.get(f"/api/v1/documents/{SEED_SLUG}/share")
        items = rl.json()["data"]["items"]
        assert len(items) == 1
        assert isinstance(items[0]["short_id"], str)
        assert items[0]["short_url"].startswith("/share/short/")
