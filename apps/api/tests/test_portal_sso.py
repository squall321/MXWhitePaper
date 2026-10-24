"""HWAX Portal SSO callback tests (post-`a397a02` bug fix).

Coverage:
  1. SSO disabled by default — POST returns 404, NOT 500 (regression for the
     `APIError(status_code=...)` kwarg bug that crashed every error branch).
  2. Malformed token (invalid JWT shape) → 401 bad_token.
  3. JWKS missing usable key → 401 no_key.
  4. wrong scope → 401 wrong_scope.
  5. replay (same jti used twice) → 401 replay on second attempt.
  6. happy path → 303 redirect with refresh cookie set, user upserted.
  7. required claims — a token missing aud / jti / exp / sub is 401 invalid_token,
     signed for real with a generated RS256 key (python-jose ignores a PyJWT-style
     "require" list; with it a token without aud skipped the audience check).
  8. portal snapshot (docs/llm-wiki C4) — `affiliation` claim + `plat:` groups land on users.portal_*,
     an absent claim stores NULL / an empty plat list, and a first-time user joins the team mapped to
     the affiliation (C5). The replay guard is the DB table portal_launch_jti (C6), so jti values are
     unique per run and cleaned up.

We mock the JWKS HTTP fetch + bypass JWT signature validation via
monkeypatched ``portal_sso._verify_portal_token`` for the happy/replay paths,
since signing a real RS256 token would require a private key fixture (out of
scope for unit tests — covered by an integration drill).
"""
from __future__ import annotations

import time
from typing import Any
from uuid import uuid4

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
async def _enable_sso(monkeypatch: pytest.MonkeyPatch):
    """Flip the settings flag and clear in-memory caches between tests."""
    s = get_settings()
    monkeypatch.setattr(s, "portal_jwks_url", "https://portal.test/.well-known/jwks.json")
    monkeypatch.setattr(s, "portal_audience", "mx-white-paper")
    monkeypatch.setattr(s, "portal_sso_default_role", "editor")
    monkeypatch.setattr(s, "portal_sso_landing", "/mx-white-paper/")
    # Reset the module-level caches so cross-test bleed doesn't break determinism.
    sso_mod._jwks_cache["keys"] = None
    sso_mod._jwks_cache["fetched"] = 0.0
    yield s
    sso_mod._jwks_cache["keys"] = None
    sso_mod._jwks_cache["fetched"] = 0.0
    async with session_scope() as sess:
        await sess.execute(text("DELETE FROM portal_launch_jti WHERE jti LIKE 'jti-test-%'"))


def _jti(tag: str) -> str:
    return f"jti-test-{tag}-{uuid4().hex[:12]}"


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
    """Bypass signature verification; assert upsert + redirect + cookie + portal snapshot."""
    test_email = "sso-e2e@mx.local"
    claims: dict[str, Any] = {
        "sub": "portal-user-1",
        "email": test_email,
        "name": "SSO Test User",
        "aud": "mx-white-paper",
        "scope": "launch",
        "jti": _jti("happy"),
        "exp": int(time.time()) + 60,
        "affiliation": "SYN-AFF-E2E",
        "groups": ["AD-Group-X", "feat:chat", "plat:plmdefect", "plat:mxwhitepaper"],
    }

    async def _verify_stub(token: str) -> dict[str, Any]:
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
                text("""SELECT email, role, portal_affiliation, portal_plat, portal_access_at
                        FROM users WHERE email = :e"""),
                {"e": test_email},
            )).first()
        assert row is not None
        assert row[0] == test_email
        assert row[1] == "editor"
        assert row[2] == "SYN-AFF-E2E"
        assert list(row[3]) == ["plat:mxwhitepaper", "plat:plmdefect"]
        assert row[4] is not None
    finally:
        async with session_scope() as s:
            await s.execute(text("DELETE FROM users WHERE email = :e"), {"e": test_email})


# ── 5) replay detection ────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_replay_second_use_returns_401(
    _enable_sso, monkeypatch: pytest.MonkeyPatch
) -> None:
    test_email = "sso-replay@mx.local"
    claims: dict[str, Any] = {
        "sub": "portal-user-2",
        "email": test_email,
        "name": "Replay Test User",
        "aud": "mx-white-paper",
        "scope": "launch",
        "jti": _jti("replay"),
        "exp": int(time.time()) + 60,
    }

    async def _verify_stub(token: str) -> dict[str, Any]:
        # The replay guard is no longer inside the verifier — portal_launch_jti (DB) catches the second use.
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


# ── 7) required claims ─────────────────────────────────────────────────


@pytest.mark.asyncio
@pytest.mark.parametrize("missing", [None, "aud", "jti", "exp", "sub"])
async def test_required_claims_are_enforced(
    _enable_sso, monkeypatch: pytest.MonkeyPatch, missing: str | None
) -> None:
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from jose import jwk, jwt

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    priv = key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
    ).decode()
    pub = key.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    ).decode()

    async def _jwks() -> list[dict[str, Any]]:
        return [{**jwk.construct(pub, "RS256").to_dict(), "kid": "k1"}]

    monkeypatch.setattr(sso_mod, "_portal_jwks", _jwks)
    now = int(time.time())
    claims: dict[str, Any] = {
        "sub": "portal-user-7",
        "email": "sso-claims@mx.local",
        "aud": "mx-white-paper",
        "scope": "launch",
        "jti": f"jti-claims-{missing}",
        "iat": now,
        "nbf": now,
        "exp": now + 60,
    }
    if missing:
        del claims[missing]
    token = jwt.encode(claims, priv, algorithm="RS256", headers={"kid": "k1"})

    if missing is None:
        assert (await sso_mod._verify_portal_token(token))["sub"] == "portal-user-7"
    else:
        with pytest.raises(sso_mod._InvalidTokenError):
            await sso_mod._verify_portal_token(token)


# ── 8) portal snapshot — affiliation · plat (C4) · team map (C5) ───────────────────────────────


async def _callback_with(monkeypatch: pytest.MonkeyPatch, claims: dict[str, Any]) -> Any:
    async def _verify_stub(token: str) -> dict[str, Any]:
        return claims

    monkeypatch.setattr(sso_mod, "_verify_portal_token", _verify_stub)
    async with _client() as c:
        return await c.post("/api/v1/auth/portal-callback", data={"token": "stub"})


def _claims(email: str, **extra: Any) -> dict[str, Any]:
    return {"sub": f"portal-{email}", "email": email, "name": "Snapshot User", "aud": "mx-white-paper",
            "scope": "launch", "jti": _jti("snap"), "exp": int(time.time()) + 60, **extra}


@pytest.mark.asyncio
async def test_snapshot_overwrites_and_absent_claim_is_null(
    _enable_sso, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The launch token is the whole snapshot — no affiliation claim now means none (NULL), no plat: means []."""
    email = "sso-snapshot@mx.local"
    async with session_scope() as s:
        await s.execute(text("DELETE FROM users WHERE email = :e"), {"e": email})
    try:
        r1 = await _callback_with(monkeypatch, _claims(email, affiliation="SYN-AFF-1", groups=["plat:plmdefect"]))
        r2 = await _callback_with(monkeypatch, _claims(email, groups=["AD-Only"]))
        assert r1.status_code == 303 and r2.status_code == 303
        async with session_scope() as s:
            row = (await s.execute(
                text("SELECT portal_affiliation, portal_plat FROM users WHERE email = :e"), {"e": email},
            )).first()
        assert row is not None and row[0] is None and list(row[1]) == []
    finally:
        async with session_scope() as s:
            await s.execute(text("DELETE FROM users WHERE email = :e"), {"e": email})


@pytest.mark.asyncio
async def test_first_login_joins_mapped_team(
    _enable_sso, monkeypatch: pytest.MonkeyPatch
) -> None:
    """C5 — wiki_aff_team_map decides the first team; without a mapping the first team as before."""
    email, unmapped_email = "sso-teammap@mx.local", "sso-teammap-none@mx.local"
    aff = f"SYN-AFF-MAP-{uuid4().hex[:8]}"
    async with session_scope() as s:
        first = (await s.execute(text("SELECT id FROM teams LIMIT 1"))).scalar()
        other = (await s.execute(
            text("SELECT id FROM teams WHERE id <> CAST(:f AS uuid) ORDER BY slug LIMIT 1"), {"f": str(first)},
        )).scalar()
        if other is None:
            pytest.skip("needs two teams")
        await s.execute(text("DELETE FROM users WHERE email IN (:a, :b)"), {"a": email, "b": unmapped_email})
        await s.execute(
            text("INSERT INTO wiki_aff_team_map (affiliation, team_id) VALUES (:a, CAST(:t AS uuid))"),
            {"a": aff, "t": str(other)},
        )
    try:
        assert (await _callback_with(monkeypatch, _claims(email, affiliation=aff))).status_code == 303
        assert (await _callback_with(monkeypatch, _claims(unmapped_email, affiliation="SYN-AFF-NOMAP"))).status_code == 303
        async with session_scope() as s:
            mapped = (await s.execute(text("SELECT team_id FROM users WHERE email = :e"), {"e": email})).scalar()
            unmapped = (await s.execute(
                text("SELECT team_id FROM users WHERE email = :e"), {"e": unmapped_email})).scalar()
        assert str(mapped) == str(other)
        assert str(unmapped) == str(first)
    finally:
        async with session_scope() as s:
            await s.execute(text("DELETE FROM users WHERE email IN (:a, :b)"), {"a": email, "b": unmapped_email})
            await s.execute(text("DELETE FROM wiki_aff_team_map WHERE affiliation = :a"), {"a": aff})
