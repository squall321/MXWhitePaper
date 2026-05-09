"""Cycle 19 — SSO providers CRUD + discover + 501 placeholder."""
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
async def _wipe():
    async with session_scope() as s:
        await s.execute(text("DELETE FROM sso_providers"))
    yield
    async with session_scope() as s:
        await s.execute(text("DELETE FROM sso_providers"))


# ── CRUD ────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_create_then_list_then_get_then_patch_then_delete() -> None:
    async with await _client() as ac:
        r = await ac.post(
            "/api/v1/admin/sso/providers",
            json={
                "name": "Samsung SSO",
                "kind": "saml",
                "enabled": True,
                "saml_metadata_url": "https://idp.samsung.com/metadata",
                "email_domain": "Samsung.com",
                "attribute_mapping": {"email": "mail", "name": "displayName"},
                "default_role": "reader",
            },
        )
        assert r.status_code == 201, r.text
        body = r.json()["data"]
        assert body["name"] == "Samsung SSO"
        assert body["kind"] == "saml"
        assert body["enabled"] is True
        # email_domain is normalized to lowercase
        assert body["email_domain"] == "samsung.com"
        pid = body["id"]

        r = await ac.get("/api/v1/admin/sso/providers")
        assert r.status_code == 200
        items = r.json()["data"]["items"]
        assert any(it["id"] == pid for it in items)

        r = await ac.get(f"/api/v1/admin/sso/providers/{pid}")
        assert r.status_code == 200
        got = r.json()["data"]
        assert got["id"] == pid
        assert got["attribute_mapping"]["email"] == "mail"

        r = await ac.patch(
            f"/api/v1/admin/sso/providers/{pid}",
            json={"name": "Samsung SSO (renamed)", "enabled": False},
        )
        assert r.status_code == 200, r.text
        assert r.json()["data"]["name"] == "Samsung SSO (renamed)"
        assert r.json()["data"]["enabled"] is False

        r = await ac.delete(f"/api/v1/admin/sso/providers/{pid}")
        assert r.status_code == 204
        r = await ac.get(f"/api/v1/admin/sso/providers/{pid}")
        assert r.status_code == 404


@pytest.mark.asyncio
async def test_create_oidc_secret_is_masked_on_read() -> None:
    async with await _client() as ac:
        r = await ac.post(
            "/api/v1/admin/sso/providers",
            json={
                "name": "Microsoft Entra",
                "kind": "oidc",
                "enabled": True,
                "oidc_issuer": "https://login.microsoftonline.com/common/v2.0",
                "oidc_client_id": "abc-123",
                "oidc_client_secret": "super-secret-value",
                "oidc_scopes": ["openid", "email"],
                "email_domain": "msft.example",
            },
        )
        assert r.status_code == 201, r.text
        body = r.json()["data"]
        # Secret is masked on response, not echoed back.
        assert body["oidc_client_secret"] == "***"
        assert body["oidc_client_secret_set"] is True
        assert body["oidc_scopes"] == ["openid", "email"]


@pytest.mark.asyncio
async def test_create_rejects_invalid_kind() -> None:
    async with await _client() as ac:
        r = await ac.post(
            "/api/v1/admin/sso/providers",
            json={"name": "bad", "kind": "ldap"},
        )
        assert r.status_code == 422


@pytest.mark.asyncio
async def test_create_rejects_invalid_default_role() -> None:
    async with await _client() as ac:
        r = await ac.post(
            "/api/v1/admin/sso/providers",
            json={
                "name": "bad-role",
                "kind": "saml",
                "default_role": "superuser",
            },
        )
        assert r.status_code == 422


@pytest.mark.asyncio
async def test_create_duplicate_name_returns_409() -> None:
    async with await _client() as ac:
        r = await ac.post(
            "/api/v1/admin/sso/providers",
            json={"name": "dup-idp", "kind": "saml"},
        )
        assert r.status_code == 201, r.text
        r = await ac.post(
            "/api/v1/admin/sso/providers",
            json={"name": "dup-idp", "kind": "oidc"},
        )
        assert r.status_code == 409, r.text


# ── Discover ────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_discover_finds_enabled_provider_by_email_domain() -> None:
    async with await _client() as ac:
        r = await ac.post(
            "/api/v1/admin/sso/providers",
            json={
                "name": "Samsung SSO",
                "kind": "saml",
                "enabled": True,
                "email_domain": "samsung.com",
            },
        )
        assert r.status_code == 201, r.text
        pid = r.json()["data"]["id"]

        r = await ac.get(
            "/api/v1/auth/sso/discover",
            params={"email": "alice@samsung.com"},
        )
        assert r.status_code == 200, r.text
        d = r.json()["data"]
        assert d["provider_id"] == pid
        assert d["kind"] == "saml"
        assert d["name"] == "Samsung SSO"
        assert d["login_url"] == f"/api/v1/auth/sso/{pid}/initiate"


@pytest.mark.asyncio
async def test_discover_skips_disabled_provider() -> None:
    async with await _client() as ac:
        await ac.post(
            "/api/v1/admin/sso/providers",
            json={
                "name": "Disabled IdP",
                "kind": "saml",
                "enabled": False,
                "email_domain": "off.example",
            },
        )
        r = await ac.get(
            "/api/v1/auth/sso/discover",
            params={"email": "x@off.example"},
        )
        assert r.status_code == 404, r.text


@pytest.mark.asyncio
async def test_discover_404_for_unmatched_domain() -> None:
    async with await _client() as ac:
        r = await ac.get(
            "/api/v1/auth/sso/discover",
            params={"email": "nobody@nope.example"},
        )
        assert r.status_code == 404


@pytest.mark.asyncio
async def test_discover_rejects_email_without_at() -> None:
    async with await _client() as ac:
        r = await ac.get(
            "/api/v1/auth/sso/discover",
            params={"email": "no-at-sign"},
        )
        assert r.status_code == 422


# ── Initiate (501 placeholder) ──────────────────────────────────────────


@pytest.mark.asyncio
async def test_initiate_returns_501_with_placeholder_envelope() -> None:
    async with await _client() as ac:
        r = await ac.post(
            "/api/v1/admin/sso/providers",
            json={
                "name": "Pending IdP",
                "kind": "oidc",
                "enabled": True,
                "oidc_issuer": "https://issuer.example",
                "oidc_client_id": "abc",
                "email_domain": "pending.example",
            },
        )
        pid = r.json()["data"]["id"]

        r = await ac.get(f"/api/v1/auth/sso/{pid}/initiate")
        assert r.status_code == 501, r.text
        body = r.json()
        assert body["error"]["code"] == "SSO_NOT_IMPLEMENTED"
        assert "구현 대기" in body["error"]["message"]


@pytest.mark.asyncio
async def test_initiate_404_when_provider_unknown() -> None:
    async with await _client() as ac:
        r = await ac.get(
            "/api/v1/auth/sso/00000000-0000-0000-0000-000000000000/initiate"
        )
        assert r.status_code == 404


@pytest.mark.asyncio
async def test_initiate_404_when_provider_disabled() -> None:
    async with await _client() as ac:
        r = await ac.post(
            "/api/v1/admin/sso/providers",
            json={
                "name": "Off IdP",
                "kind": "saml",
                "enabled": False,
                "email_domain": "off2.example",
            },
        )
        pid = r.json()["data"]["id"]
        r = await ac.get(f"/api/v1/auth/sso/{pid}/initiate")
        assert r.status_code == 404
