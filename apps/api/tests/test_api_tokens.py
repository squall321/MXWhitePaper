"""Cycle 0023 — personal API tokens.

Coverage targets:
  - POST /me/api-tokens 201, returns plaintext exactly once + masked prefix
  - GET /me/api-tokens lists rows for the dev-fallback admin
  - bearer auth path: `mxwp_<token>` is accepted as the user
  - DELETE soft-revokes (revoked_at NOT NULL); revoked tokens reject auth
  - POST /rotate revokes old + mints new with same name/scopes
  - expired tokens reject auth
  - garbage tokens / wrong prefixes return 401

Tests share the dev-fallback admin user (seeded by the test DB) — same approach
the subscriptions tests use.
"""
from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.core.db import session_scope
from app.main import app


async def _client() -> AsyncClient:
    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://test")


@pytest.fixture(autouse=True)
async def _wipe_api_tokens():
    async with session_scope() as s:
        await s.execute(text("DELETE FROM api_tokens"))
    yield
    async with session_scope() as s:
        await s.execute(text("DELETE FROM api_tokens"))


# ── create + list ────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_create_returns_full_token_once_and_masked_in_list() -> None:
    async with await _client() as ac:
        r = await ac.post(
            "/api/v1/me/api-tokens",
            json={"name": "ci-bot", "scopes": ["read", "write"]},
        )
        assert r.status_code == 201, r.text
        data = r.json()["data"]
        token = data["token"]
        assert token.startswith("mxwp_")
        assert len(token) > len("mxwp_") + 8
        assert data["name"] == "ci-bot"
        assert sorted(data["scopes"]) == ["read", "write"]
        assert data["token_prefix"]
        assert data["masked_token"].startswith("mxwp_")
        assert data["masked_token"].endswith("…")
        token_id = data["id"]

        r2 = await ac.get("/api/v1/me/api-tokens")
        assert r2.status_code == 200
        items = r2.json()["data"]["items"]
        match = next((it for it in items if it["id"] == token_id), None)
        assert match is not None
        # Plaintext token is NEVER in list responses.
        assert "token" not in match
        assert match["masked_token"].startswith("mxwp_")


@pytest.mark.asyncio
async def test_duplicate_name_for_same_user_is_rejected() -> None:
    async with await _client() as ac:
        r1 = await ac.post(
            "/api/v1/me/api-tokens", json={"name": "deploy"}
        )
        assert r1.status_code == 201, r1.text
        r2 = await ac.post(
            "/api/v1/me/api-tokens", json={"name": "deploy"}
        )
        assert r2.status_code == 422, r2.text
        body = r2.json()
        assert body["error"]["code"] == "VALIDATION_ERROR"


@pytest.mark.asyncio
async def test_invalid_scope_rejected() -> None:
    async with await _client() as ac:
        r = await ac.post(
            "/api/v1/me/api-tokens",
            json={"name": "bad", "scopes": ["read", "delete"]},
        )
        assert r.status_code == 422, r.text


# ── auth happy path ──────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_bearer_with_mxwp_token_authenticates_request() -> None:
    async with await _client() as ac:
        r = await ac.post(
            "/api/v1/me/api-tokens", json={"name": "scripting"}
        )
        assert r.status_code == 201, r.text
        token = r.json()["data"]["token"]

        # Hit /me with the freshly-minted mxwp_ token.
        r2 = await ac.get(
            "/api/v1/me",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r2.status_code == 200, r2.text
        me = r2.json()["data"]
        assert me["role"] in {"reader", "editor", "owner", "admin"}
        assert me["email"]


@pytest.mark.asyncio
async def test_garbage_mxwp_token_rejected_with_401() -> None:
    async with await _client() as ac:
        bogus = "mxwp_" + "Z" * 26
        r = await ac.get(
            "/api/v1/me",
            headers={"Authorization": f"Bearer {bogus}"},
        )
        assert r.status_code == 401, r.text


# ── revoke ───────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_revoked_token_rejects_subsequent_requests() -> None:
    async with await _client() as ac:
        r = await ac.post(
            "/api/v1/me/api-tokens", json={"name": "tmp"}
        )
        assert r.status_code == 201
        body = r.json()["data"]
        token = body["token"]
        token_id = body["id"]

        # Confirm the token works first.
        r_ok = await ac.get(
            "/api/v1/me",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r_ok.status_code == 200, r_ok.text

        # Revoke (uses dev-fallback admin auth — owner == admin).
        r_del = await ac.delete(f"/api/v1/me/api-tokens/{token_id}")
        assert r_del.status_code == 204, r_del.text

        # Token no longer works.
        r_dead = await ac.get(
            "/api/v1/me",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r_dead.status_code == 401, r_dead.text


@pytest.mark.asyncio
async def test_revoke_unknown_id_returns_404() -> None:
    async with await _client() as ac:
        r = await ac.delete(
            "/api/v1/me/api-tokens/00000000-0000-0000-0000-000000000000"
        )
        assert r.status_code == 404, r.text


# ── rotate ───────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_rotate_revokes_old_and_mints_new_with_same_scopes() -> None:
    async with await _client() as ac:
        r = await ac.post(
            "/api/v1/me/api-tokens",
            json={"name": "rot", "scopes": ["read", "write"]},
        )
        token_old = r.json()["data"]["token"]
        old_id = r.json()["data"]["id"]

        r_rot = await ac.post(f"/api/v1/me/api-tokens/{old_id}/rotate")
        assert r_rot.status_code == 200, r_rot.text
        new = r_rot.json()["data"]
        token_new = new["token"]
        assert token_new != token_old
        assert new["name"] == "rot"
        assert sorted(new["scopes"]) == ["read", "write"]
        assert new["replaced_id"] == old_id
        assert new["id"] != old_id

        # Old token is dead.
        r_dead = await ac.get(
            "/api/v1/me",
            headers={"Authorization": f"Bearer {token_old}"},
        )
        assert r_dead.status_code == 401, r_dead.text

        # New token works.
        r_live = await ac.get(
            "/api/v1/me",
            headers={"Authorization": f"Bearer {token_new}"},
        )
        assert r_live.status_code == 200, r_live.text


@pytest.mark.asyncio
async def test_rotate_already_revoked_returns_422() -> None:
    async with await _client() as ac:
        r = await ac.post(
            "/api/v1/me/api-tokens", json={"name": "once"}
        )
        token_id = r.json()["data"]["id"]
        await ac.delete(f"/api/v1/me/api-tokens/{token_id}")
        r_rot = await ac.post(f"/api/v1/me/api-tokens/{token_id}/rotate")
        assert r_rot.status_code == 422, r_rot.text


# ── expiry ───────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_expired_token_rejects_auth() -> None:
    """Mint a token, then forcibly backdate `expires_at` to the past."""
    async with await _client() as ac:
        r = await ac.post(
            "/api/v1/me/api-tokens", json={"name": "soon"}
        )
        token = r.json()["data"]["token"]
        token_id = r.json()["data"]["id"]

    async with session_scope() as s:
        await s.execute(
            text(
                "UPDATE api_tokens SET expires_at = NOW() - INTERVAL '1 minute' "
                "WHERE id = CAST(:id AS uuid)"
            ),
            {"id": token_id},
        )
        await s.commit()

    async with await _client() as ac:
        r2 = await ac.get(
            "/api/v1/me",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r2.status_code == 401, r2.text


@pytest.mark.asyncio
async def test_create_with_past_expires_at_rejected() -> None:
    async with await _client() as ac:
        r = await ac.post(
            "/api/v1/me/api-tokens",
            json={"name": "past", "expires_at": "2000-01-01T00:00:00Z"},
        )
        assert r.status_code == 422, r.text


@pytest.mark.asyncio
async def test_last_used_at_is_updated_after_auth() -> None:
    async with await _client() as ac:
        r = await ac.post(
            "/api/v1/me/api-tokens", json={"name": "lu"}
        )
        token = r.json()["data"]["token"]
        token_id = r.json()["data"]["id"]

        # Initial state: last_used_at NULL.
        r_list = await ac.get("/api/v1/me/api-tokens")
        match = next(
            (it for it in r_list.json()["data"]["items"] if it["id"] == token_id),
            None,
        )
        assert match is not None
        assert match["last_used_at"] is None

        # Use the token.
        await ac.get(
            "/api/v1/me",
            headers={"Authorization": f"Bearer {token}"},
        )

        r_list2 = await ac.get("/api/v1/me/api-tokens")
        match2 = next(
            (it for it in r_list2.json()["data"]["items"] if it["id"] == token_id),
            None,
        )
        assert match2 is not None
        assert match2["last_used_at"] is not None
