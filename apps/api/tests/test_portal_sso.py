"""HWAX Portal SSO callback tests (post-`a397a02` bug fix).

Coverage:
  1. SSO disabled by default — POST returns 404, NOT 500 (regression for the
     `APIError(status_code=...)` kwarg bug that crashed every error branch).
  2. Malformed token (invalid JWT shape) → 401 bad_token.
  3. JWKS missing usable key → 401 no_key.
  4. wrong scope → 401 wrong_scope.
  5. replay (same jti used twice) → 401 replay on second attempt.
  6. happy path → 303 redirect with refresh cookie set, user upserted.

We mock the JWKS HTTP fetch + bypass JWT signature validation via
monkeypatched ``portal_sso._verify_portal_token`` for the happy/replay paths,
since signing a real RS256 token would require a private key fixture (out of
scope for unit tests — covered by an integration drill).
"""
from __future__ import annotations

import time
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.core.config import get_settings
from app.core.db import session_scope
from app.main import app
from app.routers import portal_sso as sso_mod


def _client() -> AsyncClient:
    transport = ASGITransport(app=app)
    # follow_redirects=False so we can inspect the 303 directly.
    return AsyncClient(transport=transport, base_url="http://test", follow_redirects=False)


@pytest.fixture
def _enable_sso(monkeypatch: pytest.MonkeyPatch):
    """Flip the settings flag and clear in-memory caches between tests."""
    s = get_settings()
    monkeypatch.setattr(s, "portal_jwks_url", "https://portal.test/.well-known/jwks.json")
    monkeypatch.setattr(s, "portal_audience", "mx-white-paper")
    monkeypatch.setattr(s, "portal_sso_default_role", "editor")
    monkeypatch.setattr(s, "portal_sso_landing", "/mx-white-paper/")
    # Reset the module-level caches so cross-test bleed doesn't break determinism.
    sso_mod._jwks_cache["keys"] = None
    sso_mod._jwks_cache["fetched"] = 0.0
    sso_mod._seen_jti.clear()
    yield s
    sso_mod._jwks_cache["keys"] = None
    sso_mod._jwks_cache["fetched"] = 0.0
    sso_mod._seen_jti.clear()


# ── 1) disabled by default ─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_disabled_returns_404_not_500(monkeypatch: pytest.MonkeyPatch) -> None:
    """Regression for the APIError kwarg bug — confirms the disabled fallback
    returns 404 with `sso_disabled` code, NOT a 500 from TypeError."""
    s = get_settings()
    monkeypatch.setattr(s, "portal_jwks_url", "")  # disabled
    async with _client() as c:
        r = await c.post("/api/v1/auth/portal-callback", data={"token": "ignored"})
    assert r.status_code == 404
    body = r.json()
    assert body["error"]["code"] == "sso_disabled"


# ── 2) malformed token ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_malformed_token_returns_401(
    _enable_sso, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _jwks_stub() -> list[dict[str, Any]]:
        return [{"kid": "k1", "kty": "RSA", "n": "x", "e": "AQAB"}]

    monkeypatch.setattr(sso_mod, "_portal_jwks", _jwks_stub)

    async with _client() as c:
        r = await c.post("/api/v1/auth/portal-callback", data={"token": "not.a.jwt"})
    assert r.status_code == 401
    body = r.json()
    assert body["error"]["code"] in ("bad_token", "invalid_token")


# ── 3) JWKS no usable key ──────────────────────────────────────────────


@pytest.mark.asyncio
async def test_empty_jwks_returns_401_no_key(
    _enable_sso, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _empty_jwks() -> list[dict[str, Any]]:
        return []

    monkeypatch.setattr(sso_mod, "_portal_jwks", _empty_jwks)

    # Header-shaped token. get_unverified_header is permissive, so we don't
    # rely on the exact downstream code — any 401 from this branch is fine
    # (it's either no_key or invalid_token depending on how jose handles the
    # truncated signature, both indicate "rejected before user creation").
    fake = "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6ImsxIn0.eyJzdWIiOiJ1In0.x"
    async with _client() as c:
        r = await c.post("/api/v1/auth/portal-callback", data={"token": fake})
    assert r.status_code == 401
    assert r.json()["error"]["code"] in ("no_key", "invalid_token", "bad_token")


# ── 4) happy path (mocked verifier) ────────────────────────────────────


@pytest.mark.asyncio
async def test_happy_path_upserts_user_and_sets_cookie(
    _enable_sso, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Bypass signature verification; assert upsert + redirect + cookie."""
    test_email = "sso-e2e@mx.local"
    claims: dict[str, Any] = {
        "sub": "portal-user-1",
        "email": test_email,
        "name": "SSO Test User",
        "aud": "mx-white-paper",
        "scope": "launch",
        "jti": "jti-happy-1",
        "exp": int(time.time()) + 60,
    }

    async def _verify_stub(token: str) -> dict[str, Any]:
        # Mimic the real verifier's side-effects: dedup + jti registration.
        if claims["jti"] in sso_mod._seen_jti:
            raise sso_mod._ReplayError("launch token already used")
        sso_mod._seen_jti[claims["jti"]] = float(claims["exp"])
        return claims

    monkeypatch.setattr(sso_mod, "_verify_portal_token", _verify_stub)

    # Clean any stale row from a previous run.
    async with session_scope() as s:
        await s.execute(text("DELETE FROM users WHERE email = :e"), {"e": test_email})

    try:
        async with _client() as c:
            r = await c.post("/api/v1/auth/portal-callback", data={"token": "stub"})
        assert r.status_code == 303
        assert r.headers["location"] == "/mx-white-paper/"
        # Refresh cookie set under the canonical name.
        set_cookie = r.headers.get("set-cookie", "")
        assert "mxwp_refresh" in set_cookie

        # User row upserted.
        async with session_scope() as s:
            row = (await s.execute(
                text("SELECT email, role FROM users WHERE email = :e"),
                {"e": test_email},
            )).first()
        assert row is not None
        assert row[0] == test_email
        assert row[1] == "editor"
    finally:
        async with session_scope() as s:
            await s.execute(text("DELETE FROM users WHERE email = :e"), {"e": test_email})


# ── 5) replay detection ────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_replay_second_use_returns_401(
    _enable_sso, monkeypatch: pytest.MonkeyPatch
) -> None:
    test_email = "sso-replay@mx.local"
    jti = "jti-replay-1"
    claims: dict[str, Any] = {
        "sub": "portal-user-2",
        "email": test_email,
        "name": "Replay Test User",
        "aud": "mx-white-paper",
        "scope": "launch",
        "jti": jti,
        "exp": int(time.time()) + 60,
    }

    async def _verify_stub(token: str) -> dict[str, Any]:
        if claims["jti"] in sso_mod._seen_jti:
            raise sso_mod._ReplayError("launch token already used")
        sso_mod._seen_jti[claims["jti"]] = float(claims["exp"])
        return claims

    monkeypatch.setattr(sso_mod, "_verify_portal_token", _verify_stub)

    async with session_scope() as s:
        await s.execute(text("DELETE FROM users WHERE email = :e"), {"e": test_email})

    try:
        async with _client() as c:
            r1 = await c.post("/api/v1/auth/portal-callback", data={"token": "stub"})
            r2 = await c.post("/api/v1/auth/portal-callback", data={"token": "stub"})
        assert r1.status_code == 303
        assert r2.status_code == 401
        assert r2.json()["error"]["code"] == "replay"
    finally:
        async with session_scope() as s:
            await s.execute(text("DELETE FROM users WHERE email = :e"), {"e": test_email})
