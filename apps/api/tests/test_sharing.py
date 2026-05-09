"""Sharing router — public link create/read/revoke + 410/401/403/404 paths."""
from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.core.db import get_db
from app.main import app

# Reuse the seed slug from test_documents.
SEED_SLUG = "month-end-closing"


async def _client() -> AsyncClient:
    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://test")


async def _new_session():
    """Yield a single AsyncSession via the get_db generator (for fixtures)."""
    gen = get_db()
    s = await anext(gen)
    return s, gen


async def _close_session(gen) -> None:
    try:
        await anext(gen)
    except StopAsyncIteration:
        pass


async def _wipe_all_share_links(slug: str = SEED_SLUG) -> None:
    """Each test starts with no share_links rows for the seed doc."""
    s, gen = await _new_session()
    try:
        await s.execute(
            text(
                """
                DELETE FROM share_links
                WHERE document_id = (
                  SELECT id FROM documents WHERE slug = :slug
                )
                """
            ),
            {"slug": slug},
        )
        await s.commit()
    finally:
        await _close_session(gen)


async def _force_expire(token: str) -> None:
    s, gen = await _new_session()
    try:
        await s.execute(
            text(
                "UPDATE share_links SET expires_at = NOW() - INTERVAL '1 minute' "
                "WHERE token = :tok"
            ),
            {"tok": token},
        )
        await s.commit()
    finally:
        await _close_session(gen)


@pytest.mark.asyncio
async def test_create_then_public_read_happy_path() -> None:
    await _wipe_all_share_links()
    async with await _client() as ac:
        r = await ac.post(f"/api/v1/documents/{SEED_SLUG}/share", json={})
        assert r.status_code == 201, r.text
        data = r.json()["data"]
        token = data["token"]
        assert isinstance(token, str) and len(token) >= 30
        assert data["url"] == f"/share/{token}"
        assert data["expires_at"] is None
        assert data["has_password"] is False

        # Public GET — no auth header passed (it'd be ignored anyway).
        r2 = await ac.get(f"/api/v1/share/{token}")
        assert r2.status_code == 200, r2.text
        body = r2.json()["data"]
        assert body["row"]["slug"] == SEED_SLUG
        # The public GET shape mirrors GET /documents/{slug}: row + content.
        assert body["document"]["slug"] == SEED_SLUG
        assert body["share_meta"]["has_password"] is False
        assert body["share_meta"]["view_count"] == 1


@pytest.mark.asyncio
async def test_view_count_increments_per_read() -> None:
    await _wipe_all_share_links()
    async with await _client() as ac:
        r = await ac.post(f"/api/v1/documents/{SEED_SLUG}/share", json={})
        token = r.json()["data"]["token"]

        for expected in (1, 2, 3):
            rg = await ac.get(f"/api/v1/share/{token}")
            assert rg.status_code == 200
            assert rg.json()["data"]["share_meta"]["view_count"] == expected


@pytest.mark.asyncio
async def test_expired_link_returns_410() -> None:
    await _wipe_all_share_links()
    async with await _client() as ac:
        # 2-second TTL → wait it out below.
        future = (datetime.now(UTC) + timedelta(hours=1)).isoformat()
        r = await ac.post(
            f"/api/v1/documents/{SEED_SLUG}/share",
            json={"expires_at": future},
        )
        token = r.json()["data"]["token"]
        await _force_expire(token)
        rg = await ac.get(f"/api/v1/share/{token}")
        assert rg.status_code == 410, rg.text


@pytest.mark.asyncio
async def test_revoked_link_returns_410() -> None:
    await _wipe_all_share_links()
    async with await _client() as ac:
        r = await ac.post(f"/api/v1/documents/{SEED_SLUG}/share", json={})
        token = r.json()["data"]["token"]
        rd = await ac.delete(f"/api/v1/share/{token}")
        assert rd.status_code == 204
        rg = await ac.get(f"/api/v1/share/{token}")
        assert rg.status_code == 410


@pytest.mark.asyncio
async def test_password_link_requires_correct_password() -> None:
    await _wipe_all_share_links()
    async with await _client() as ac:
        r = await ac.post(
            f"/api/v1/documents/{SEED_SLUG}/share",
            json={"password": "hunter2!"},
        )
        token = r.json()["data"]["token"]
        assert r.json()["data"]["has_password"] is True

        # Missing password
        r1 = await ac.get(f"/api/v1/share/{token}")
        assert r1.status_code == 401, r1.text

        # Wrong password
        r2 = await ac.get(
            f"/api/v1/share/{token}", headers={"X-Share-Password": "wrong"}
        )
        assert r2.status_code == 401

        # Correct (header)
        r3 = await ac.get(
            f"/api/v1/share/{token}", headers={"X-Share-Password": "hunter2!"}
        )
        assert r3.status_code == 200

        # Correct (query)
        r4 = await ac.get(f"/api/v1/share/{token}?password=hunter2!")
        assert r4.status_code == 200


@pytest.mark.asyncio
async def test_unknown_token_returns_404() -> None:
    async with await _client() as ac:
        r = await ac.get("/api/v1/share/this-token-does-not-exist")
        assert r.status_code == 404


@pytest.mark.asyncio
async def test_list_links_returns_only_active() -> None:
    await _wipe_all_share_links()
    async with await _client() as ac:
        r1 = await ac.post(f"/api/v1/documents/{SEED_SLUG}/share", json={})
        r2 = await ac.post(f"/api/v1/documents/{SEED_SLUG}/share", json={})
        t1 = r1.json()["data"]["token"]
        t2 = r2.json()["data"]["token"]
        await ac.delete(f"/api/v1/share/{t1}")  # revoke the first

        rl = await ac.get(f"/api/v1/documents/{SEED_SLUG}/share")
        assert rl.status_code == 200
        items = rl.json()["data"]["items"]
        tokens = [i["token"] for i in items]
        assert t2 in tokens
        assert t1 not in tokens


@pytest.mark.asyncio
async def test_create_rejects_past_expiry() -> None:
    await _wipe_all_share_links()
    async with await _client() as ac:
        past = (datetime.now(UTC) - timedelta(minutes=1)).isoformat()
        r = await ac.post(
            f"/api/v1/documents/{SEED_SLUG}/share",
            json={"expires_at": past},
        )
        assert r.status_code == 422


@pytest.mark.asyncio
async def test_revoke_by_non_creator_returns_403() -> None:
    """A non-admin reader can't revoke a link created by another user.

    Setup:
      1. Find or create a non-admin reader.
      2. Use the dev-fallback (admin) to create a link.
      3. Issue DELETE with `Authorization: Bearer <reader-jwt>` — expect 403.
    """
    await _wipe_all_share_links()
    s, gen = await _new_session()
    try:
        # Make sure a reader (non-admin) user exists.
        reader_email = "share-reader@mx.local"
        await s.execute(
            text("""
                INSERT INTO users (email, name, role, password_hash, is_active)
                VALUES (:e, '리더', 'reader', 'placeholder', TRUE)
                ON CONFLICT (email) DO UPDATE SET is_active = TRUE
            """),
            {"e": reader_email},
        )
        await s.commit()
        row = (await s.execute(
            text("SELECT id FROM users WHERE email = :e"), {"e": reader_email}
        )).first()
        reader_id = str(row[0])
    finally:
        await _close_session(gen)

    from app.core.security import make_access_token

    reader_jwt = make_access_token(reader_id)

    async with await _client() as ac:
        # admin (dev fallback) creates the link.
        r = await ac.post(f"/api/v1/documents/{SEED_SLUG}/share", json={})
        token = r.json()["data"]["token"]

        # reader attempts to revoke.
        rd = await ac.delete(
            f"/api/v1/share/{token}",
            headers={"Authorization": f"Bearer {reader_jwt}"},
        )
        assert rd.status_code == 403, rd.text


@pytest.mark.asyncio
async def test_create_share_for_unknown_slug_returns_404() -> None:
    async with await _client() as ac:
        r = await ac.post(
            "/api/v1/documents/no-such-slug-zzz/share", json={}
        )
        assert r.status_code == 404
