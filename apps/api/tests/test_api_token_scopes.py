"""Cycle 0024 — API token scope enforcement.

Two layers of coverage:

1. Pure unit tests over `check_scope(scopes, method, path)`. The matrix is
   small enough that we enumerate it explicitly so that future changes to
   the rule table light up here first.

2. Integration tests via the FastAPI ASGI transport. We mint real tokens
   through `POST /me/api-tokens` (so each token is properly hashed +
   stored), then hit other endpoints with `Authorization: Bearer mxwp_*`
   and assert the right HTTP code comes back:
     - 200 / 2xx  → scope permits the call
     - 403 SCOPE_INSUFFICIENT → scope blocks it
     - /me/*  always 2xx regardless of scope
"""
from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.core.db import session_scope
from app.main import app
from app.services.api_token_scopes import check_scope, required_scope_for

# ── unit tests ──────────────────────────────────────────────────────────


def test_read_scope_allows_get():
    assert check_scope(["read"], "GET", "/api/v1/documents") is True


def test_read_scope_allows_head():
    assert check_scope(["read"], "HEAD", "/api/v1/documents") is True


def test_read_scope_blocks_post():
    assert check_scope(["read"], "POST", "/api/v1/documents") is False


def test_read_scope_blocks_delete():
    assert check_scope(["read"], "DELETE", "/api/v1/documents/123") is False


def test_write_scope_allows_post_on_documents():
    assert check_scope(["write"], "POST", "/api/v1/documents") is True


def test_write_scope_allows_get():
    # write should imply read
    assert check_scope(["write"], "GET", "/api/v1/documents") is True


def test_write_scope_blocks_post_on_admin():
    assert check_scope(["write"], "POST", "/api/v1/admin/users") is False


def test_write_scope_blocks_get_on_admin():
    # admin path requires the *admin* scope, not just any write.
    assert check_scope(["write"], "GET", "/api/v1/admin/health") is False


def test_admin_scope_allows_everything_on_admin_paths():
    assert check_scope(["admin"], "DELETE", "/api/v1/admin/archived-docs") is True
    assert check_scope(["admin"], "POST", "/api/v1/admin/users") is True
    assert check_scope(["admin"], "GET", "/api/v1/admin/health") is True


def test_admin_scope_allows_everything_elsewhere():
    assert check_scope(["admin"], "POST", "/api/v1/documents") is True
    assert check_scope(["admin"], "PATCH", "/api/v1/documents/abc") is True


def test_empty_scopes_grants_implicit_read():
    assert check_scope([], "GET", "/api/v1/documents") is True
    assert check_scope([], "POST", "/api/v1/documents") is False


def test_none_scopes_grants_implicit_read():
    assert check_scope(None, "GET", "/api/v1/documents") is True
    assert check_scope(None, "POST", "/api/v1/documents") is False


def test_me_path_always_allowed_regardless_of_scope():
    # /me is the user's own account — token must be able to revoke itself.
    assert check_scope([], "POST", "/api/v1/me/api-tokens") is True
    assert check_scope(["read"], "DELETE", "/api/v1/me/api-tokens/x") is True
    assert check_scope(["read"], "POST", "/api/v1/me/api-tokens/x/rotate") is True


def test_combined_read_write_acts_like_write():
    assert check_scope(["read", "write"], "POST", "/api/v1/documents") is True
    assert check_scope(["read", "write"], "POST", "/api/v1/admin/users") is False


def test_required_scope_for_admin_path_is_admin():
    assert required_scope_for("GET", "/api/v1/admin/health") == "admin"


def test_required_scope_for_post_is_write():
    assert required_scope_for("POST", "/api/v1/documents") == "write"


def test_required_scope_for_get_is_read():
    assert required_scope_for("GET", "/api/v1/documents") == "read"


def test_admin_path_works_without_api_v1_prefix():
    # router-relative form (no /api/v1) should still be recognised as admin
    assert check_scope(["write"], "GET", "/admin/health") is False
    assert check_scope(["admin"], "GET", "/admin/health") is True


# ── integration tests ───────────────────────────────────────────────────


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


async def _mint_token(ac: AsyncClient, scopes: list[str], name: str = "scope-test") -> str:
    r = await ac.post(
        "/api/v1/me/api-tokens",
        json={"name": name, "scopes": scopes},
    )
    assert r.status_code == 201, r.text
    return r.json()["data"]["token"]


@pytest.mark.asyncio
async def test_read_token_allowed_on_get_documents() -> None:
    async with await _client() as ac:
        token = await _mint_token(ac, ["read"], "r1")
        r = await ac.get(
            "/api/v1/documents",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 200, r.text


@pytest.mark.asyncio
async def test_read_token_blocked_on_admin_get() -> None:
    async with await _client() as ac:
        token = await _mint_token(ac, ["read"], "r2")
        r = await ac.get(
            "/api/v1/admin/health",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 403, r.text
        body = r.json()
        assert body["error"]["code"] == "SCOPE_INSUFFICIENT"
        assert body["error"]["details"]["required_scope"] == "admin"


@pytest.mark.asyncio
async def test_write_token_blocked_on_admin_get() -> None:
    async with await _client() as ac:
        token = await _mint_token(ac, ["write"], "w1")
        r = await ac.get(
            "/api/v1/admin/health",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 403, r.text
        assert r.json()["error"]["code"] == "SCOPE_INSUFFICIENT"


@pytest.mark.asyncio
async def test_admin_token_allowed_on_admin_get() -> None:
    async with await _client() as ac:
        token = await _mint_token(ac, ["admin"], "a1")
        r = await ac.get(
            "/api/v1/admin/health",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 200, r.text


@pytest.mark.asyncio
async def test_read_token_allowed_on_me_endpoints() -> None:
    """The /me/* whitelist exists so the user can always operate on their own
    account — including revoking the very token they're using."""
    async with await _client() as ac:
        token = await _mint_token(ac, ["read"], "me1")
        r = await ac.get(
            "/api/v1/me",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 200, r.text

        r2 = await ac.get(
            "/api/v1/me/api-tokens",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r2.status_code == 200, r2.text


@pytest.mark.asyncio
async def test_legacy_empty_scopes_acts_as_read() -> None:
    """Tokens predating Cycle 0024 may have scopes=[] in the column. Those
    should authenticate but be limited to safe verbs."""
    async with await _client() as ac:
        token = await _mint_token(ac, ["read"], "legacy")

    # Force-clear scopes column to simulate a pre-0024 row.
    async with session_scope() as s:
        await s.execute(text("UPDATE api_tokens SET scopes = '[]'::jsonb"))
        await s.commit()

    async with await _client() as ac:
        r_get = await ac.get(
            "/api/v1/documents",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r_get.status_code == 200, r_get.text

        r_admin = await ac.get(
            "/api/v1/admin/health",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r_admin.status_code == 403, r_admin.text
