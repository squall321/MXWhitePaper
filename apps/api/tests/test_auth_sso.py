# 게이트웨이 · 포털 위임(C1~C4) 시험 — 창구 404 · 401 · 403 · 400 · 200, 클라이언트별 세대 회수, 소속 · 플랫폼 증명
"""docs/llm-wiki W1 완료 기준 — 위임 창구(404 · 401 · 403 · 400 · 200 · 클라이언트별 발급) · 소속 증명(맞음 · 만료 · 다른 이메일 ·
평문만) · request §4-5 의 넷. 증명은 HWAXMcpGateway `_aff_proof` · `_plat_proof` 와 같은 꼴로 시험이 직접 만든다.

시험 사용자는 `sso-dlg-<hex>@example.com` — 끝에 감사 줄과 함께 지운다(audit_logs.user_id 가 NO ACTION 이다).
"""
from __future__ import annotations

import hashlib
import hmac
import time
from typing import Any
from urllib.parse import quote
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from jose import jwt
from sqlalchemy import text

from app.core.config import get_settings
from app.core.db import session_scope
from app.core.portal_identity import verified_affiliation, verified_plat
from app.core.security import make_access_token
from app.main import app

SECRET = "test-sso-secret-0123456789abcdef"
EMAIL_LIKE = "sso-dlg-%@example.com"


def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _email() -> str:
    return f"sso-dlg-{uuid4().hex[:10]}@example.com"


def _sign(secret: str, email: str, value: str, exp: int) -> str:
    sig = hmac.new(secret.encode(), f"v1|{email}|{value}|{exp}".encode(), hashlib.sha256).hexdigest()
    return f"v1.{exp}.{sig}"


def _aff_headers(email: str, aff: str, *, secret: str = SECRET, ttl: int = 120) -> dict[str, str]:
    """게이트웨이 `_aff_proof` 와 같은 꼴 — 서명은 인코딩 전 값, 헤더는 quote(safe="")."""
    return {"X-Heax-User-Affiliation": quote(aff, safe=""),
            "X-Heax-Aff-Proof": _sign(secret, email, aff, int(time.time()) + ttl)}


def _plat_headers(email: str, plats: list[str], *, secret: str = SECRET, ttl: int = 120) -> dict[str, str]:
    """게이트웨이 `_plat_proof` 와 같은 꼴 — 정렬해 쉼표로 이은 목록, 헤더는 quote(safe=",:")."""
    joined = ",".join(sorted(plats))
    return {"X-Heax-User-Plat": quote(joined, safe=",:"),
            "X-Heax-Plat-Proof": _sign(secret, email, joined, int(time.time()) + ttl)}


@pytest.fixture
def sso_on(monkeypatch: pytest.MonkeyPatch):
    s = get_settings()
    monkeypatch.setattr(s, "mxwp_sso_secret", SECRET)
    monkeypatch.setattr(s, "mxwp_sso_jit_create", True)
    yield s


@pytest.fixture(autouse=True)
async def _cleanup_users():
    yield
    async with session_scope() as s:
        await s.execute(text(
            "DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE email LIKE :e)"), {"e": EMAIL_LIKE})
        await s.execute(text("DELETE FROM users WHERE email LIKE :e"), {"e": EMAIL_LIKE})


async def _mint(c: AsyncClient, email: str, *, client: str | None = "gateway", secret: str = SECRET,
                **extra: str) -> Any:
    headers = {"X-Heax-Gateway-Secret": secret, "X-Heax-User-Email": email, **extra}
    if client is not None:
        headers["X-Heax-Client"] = client
    return await c.post("/api/v1/auth/sso", headers=headers)


async def _token(c: AsyncClient, email: str, **kw: Any) -> str:
    r = await _mint(c, email, **kw)
    assert r.status_code == 200, r.text
    return r.json()["data"]["access_token"]


async def _me(c: AsyncClient, token: str, **headers: str) -> Any:
    return await c.get("/api/v1/me", headers={"Authorization": f"Bearer {token}", **headers})


async def _user_id(email: str) -> str:
    async with session_scope() as s:
        return str((await s.execute(text("SELECT id FROM users WHERE email = :e"), {"e": email})).scalar_one())


# ── C1 창구 ───────────────────────────────────────────────────────────────────────────────────

async def test_off_without_secret_is_404(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "mxwp_sso_secret", "")
    async with _client() as c:
        r = await _mint(c, _email(), secret="anything")
    assert r.status_code == 404 and r.json()["error"]["code"] == "sso_disabled"


async def test_wrong_or_missing_secret_is_401(sso_on: Any) -> None:
    async with _client() as c:
        wrong = await _mint(c, _email(), secret="not-the-secret")
        missing = await c.post("/api/v1/auth/sso", headers={"X-Heax-User-Email": _email()})
    assert wrong.status_code == 401 and wrong.json()["error"]["code"] == "bad_secret"
    assert missing.status_code == 401


async def test_verify_compares_only_the_secret(sso_on: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    """포털 update-all(HP-26)이 견준다 — 같으면 204 · 다르거나 없으면 401. 위임이 꺼져도 401(포털이 '창구 없음' 으로 넘기지 않게)."""
    async with _client() as c:
        same = await c.post("/api/v1/auth/sso/verify", headers={"X-Heax-Gateway-Secret": SECRET})
        other = await c.post("/api/v1/auth/sso/verify", headers={"X-Heax-Gateway-Secret": SECRET + "-x"})
        missing = await c.post("/api/v1/auth/sso/verify")
        monkeypatch.setattr(sso_on, "mxwp_sso_secret", "")
        off = await c.post("/api/v1/auth/sso/verify", headers={"X-Heax-Gateway-Secret": ""})
    assert same.status_code == 204 and same.content == b""
    assert [other.status_code, missing.status_code, off.status_code] == [401, 401, 401]
    assert other.json()["error"]["code"] == "bad_secret"


async def test_missing_email_is_400(sso_on: Any) -> None:
    async with _client() as c:
        none = await c.post("/api/v1/auth/sso", headers={"X-Heax-Gateway-Secret": SECRET})
        bad = await _mint(c, "not-an-email")
    assert none.status_code == 400 and none.json()["error"]["code"] == "no_email"
    assert bad.status_code == 400


async def test_jit_create_then_200_shape(sso_on: Any) -> None:
    email = _email()
    async with _client() as c:
        r = await _mint(c, email, **{"X-Heax-User-Name": quote("위임 시험", safe="")})
        assert r.status_code == 200
        data = r.json()["data"]
        assert data["token_type"] == "bearer" and data["expires_in"] >= 12 * 3600
        claims = jwt.get_unverified_claims(data["access_token"])
        assert claims["typ"] == "delegated" and claims["cli"] == "gateway" and claims["scope"] == ["read", "write"]
        assert claims["exp"] - claims["iat"] >= 12 * 3600
        me = await _me(c, data["access_token"])
    assert me.status_code == 200
    body = me.json()["data"]
    assert body["email"] == email and body["name"] == "위임 시험" and body["auth_via"] == "delegated:gateway"


async def test_jit_off_unknown_is_403(sso_on: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(sso_on, "mxwp_sso_jit_create", False)
    async with _client() as c:
        r = await _mint(c, _email())
    assert r.status_code == 403 and r.json()["error"]["code"] == "jit_disabled"


async def test_inactive_user_is_403_and_token_dies(sso_on: Any) -> None:
    email = _email()
    async with _client() as c:
        token = await _token(c, email)
        async with session_scope() as s:
            await s.execute(text("UPDATE users SET is_active = FALSE WHERE email = :e"), {"e": email})
        again = await _mint(c, email)
        me = await _me(c, token)
    assert again.status_code == 403 and again.json()["error"]["code"] == "user_inactive"
    assert me.status_code == 401


async def test_delegate_header_wins(sso_on: Any) -> None:
    """게이트웨이는 X-Hwax-Delegate-Email 을 함께 싣는다 — 앞 헤더가 Caddy 로 덮여도 진짜 호출자로 낸다."""
    real, folded = _email(), _email()
    async with _client() as c:
        token = await _token(c, folded, **{"X-Hwax-Delegate-Email": real})
        me = await _me(c, token)
    assert me.json()["data"]["email"] == real


# ── C2 토큰 · 세대 ────────────────────────────────────────────────────────────────────────────

async def test_clients_are_separate_and_revoke_by_generation(sso_on: Any) -> None:
    """gateway 회수가 hwax-portal 발급 · 웹 세션을 죽이지 않는다. 발급은 아무것도 회수하지 않는다."""
    email = _email()
    async with _client() as c:
        gw1 = await _token(c, email, client="gateway")
        gw2 = await _token(c, email, client="gateway")
        portal = await _token(c, email, client="hwax-portal")
        uid = await _user_id(email)
        web = make_access_token(uid, extra={"role": "editor"})
        assert (await _me(c, gw1)).status_code == 200  # 두 번째 발급이 첫째를 죽이지 않는다

        r = await c.post(f"/api/v1/admin/sso-delegations/{uid}/revoke", json={"client": "gateway"})
        assert r.status_code == 200 and r.json()["data"]["revoked"] == [{"client": "gateway", "generation": 2}]
        assert (await _me(c, gw1)).status_code == 401
        assert (await _me(c, gw2)).status_code == 401
        assert (await _me(c, portal)).status_code == 200
        assert (await _me(c, web)).status_code == 200

        fresh = await _token(c, email, client="gateway")
        assert jwt.get_unverified_claims(fresh)["gen"] == 2
        assert (await _me(c, fresh)).status_code == 200

        r = await c.post(f"/api/v1/admin/sso-delegations/{uid}/revoke")
        assert {x["client"] for x in r.json()["data"]["revoked"]} == {"gateway", "hwax-portal"}
        assert (await _me(c, portal)).status_code == 401


async def test_secret_off_or_rotated_kills_tokens(sso_on: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    email = _email()
    async with _client() as c:
        token = await _token(c, email)
        monkeypatch.setattr(sso_on, "mxwp_sso_secret", SECRET + "-rotated")
        rotated = await _me(c, token)
        monkeypatch.setattr(sso_on, "mxwp_sso_secret", "")
        off = await _me(c, token)
    assert rotated.status_code == 401 and off.status_code == 401


async def test_scope_read_write_not_admin(sso_on: Any) -> None:
    """admin 이어도 위임으로는 /admin/* · API 토큰 · 2FA 를 못 다루고 역할은 owner 로 낮아진다."""
    email = _email()
    async with _client() as c:
        await _token(c, email)
        async with session_scope() as s:
            await s.execute(text("UPDATE users SET role = 'admin' WHERE email = :e"), {"e": email})
        token = await _token(c, email)
        me = await _me(c, token)
        admin_path = await c.get("/api/v1/admin/aff-team-map", headers={"Authorization": f"Bearer {token}"})
        new_pat = await c.post("/api/v1/me/api-tokens", json={"name": "x"},
                               headers={"Authorization": f"Bearer {token}"})
        twofa = await c.post("/api/v1/me/2fa/setup", headers={"Authorization": f"Bearer {token}"})
    assert me.json()["data"]["role"] == "owner"
    assert admin_path.status_code == 403 and admin_path.json()["error"]["code"] == "SCOPE_INSUFFICIENT"
    assert new_pat.status_code == 403 and twofa.status_code == 403


# ── C4 소속 · 플랫폼 증명 ─────────────────────────────────────────────────────────────────────

async def test_affiliation_proof_cases(sso_on: Any) -> None:
    email, other = _email(), _email()
    aff = "SYN-소속-1"
    async with _client() as c:
        token = await _token(c, email)
        ok = (await _me(c, token, **_aff_headers(email, aff))).json()["data"]
        expired = (await _me(c, token, **_aff_headers(email, aff, ttl=-5))).json()["data"]
        other_email = (await _me(c, token, **_aff_headers(other, aff))).json()["data"]
        plain = (await _me(c, token, **{"X-Heax-User-Affiliation": quote(aff, safe="")})).json()["data"]
        forged = {**_aff_headers(email, aff), "X-Heax-User-Affiliation": quote("SYN-남의소속", safe="")}
        swapped = (await _me(c, token, **forged)).json()["data"]
    assert ok["portal_affiliation"] == aff and ok["portal_access_at"] is not None
    for case in (expired, other_email, plain, swapped):
        assert case["portal_affiliation"] is None


async def test_plat_proof_cases(sso_on: Any) -> None:
    email = _email()
    async with _client() as c:
        token = await _token(c, email)
        ok = (await _me(c, token, **_plat_headers(email, ["plat:plmdefect", "plat:mxwhitepaper"]))).json()["data"]
        widened = _plat_headers(email, ["plat:mxwhitepaper"])
        widened["X-Heax-User-Plat"] = quote("plat:mxwhitepaper,plat:plmdefect", safe=",:")
        added = (await _me(c, token, **widened)).json()["data"]
        none = (await _me(c, token)).json()["data"]
    assert ok["portal_plat"] == ["plat:mxwhitepaper", "plat:plmdefect"]
    assert added["portal_plat"] is None  # 남의 권한을 붙인 목록은 서명이 안 맞는다
    assert none["portal_plat"] is None and none["portal_affiliation"] is None


async def test_portal_fields_on_delegated_call_ignore_stored_values(sso_on: Any) -> None:
    """위임 호출의 소속 · 플랫폼은 저장된 진입 토큰 값이 아니라 그 호출의 증명으로만 — 헤더가 없으면 없다(닫힌 쪽)."""
    email = _email()
    async with _client() as c:
        token = await _token(c, email)
        async with session_scope() as s:
            await s.execute(text("""
                UPDATE users SET portal_affiliation = 'SYN-AFF-STORED', portal_plat = ARRAY['plat:plmdefect'],
                       portal_access_at = NOW() WHERE email = :e"""), {"e": email})
        me = (await _me(c, token)).json()["data"]
    assert me["portal_affiliation"] is None and me["portal_plat"] is None


def test_proof_functions_directly() -> None:
    # 요청 헤더(Starlette)는 대소문자를 가리지 않지만 dict 는 가린다 — 소문자 열쇠로 넘긴다.
    email, now = "a@example.com", time.time()
    h = {k.lower(): v for k, v in _aff_headers(email, "X").items()}
    assert verified_affiliation(h, secret=SECRET, email=email, now=now) == "X"
    assert verified_affiliation(h, secret="other", email=email, now=now) is None
    assert verified_affiliation(h, secret=SECRET, email=email, now=now + 600) is None
    assert verified_affiliation({**h, "x-heax-aff-proof": "v2.1.x"}, secret=SECRET, email=email, now=now) is None
    p = {k.lower(): v for k, v in _plat_headers(email, ["plat:b", "plat:a"]).items()}
    assert verified_plat(p, secret=SECRET, email=email, now=now) == ["plat:a", "plat:b"]
    assert verified_plat(p, secret="", email=email, now=now) is None


# ── C5 소속 → 팀 표(관리자) ───────────────────────────────────────────────────────────────────

async def test_aff_team_map_crud() -> None:
    aff = f"SYN-소속-{uuid4().hex[:8]}"
    path = f"/api/v1/admin/aff-team-map/{quote(aff, safe='')}"
    async with session_scope() as s:
        team = str((await s.execute(text("SELECT id FROM teams ORDER BY slug LIMIT 1"))).scalar_one())
    try:
        async with _client() as c:
            put = await c.put(path, json={"team_id": team})
            listed = (await c.get("/api/v1/admin/aff-team-map")).json()["data"]
            missing_team = await c.put(path, json={"team_id": str(uuid4())})
            bad_aff = await c.put("/api/v1/admin/aff-team-map/has%20space", json={"team_id": team})
            star = await c.put("/api/v1/admin/aff-team-map/%2A", json={"team_id": team})
            deleted = await c.delete(path)
            again = await c.delete(path)
        assert put.status_code == 200 and put.json()["data"]["affiliation"] == aff
        assert any(x["affiliation"] == aff and x["team_id"] == team for x in listed)
        assert missing_team.status_code == 404
        assert bad_aff.status_code == 422
        assert star.status_code == 422  # '*' 는 모든 사람 — 넣으면 모두가 한 팀으로 옮겨진다(MW-05)
        assert deleted.status_code == 200 and again.status_code == 404
    finally:
        async with session_scope() as s:
            await s.execute(text("DELETE FROM wiki_aff_team_map WHERE affiliation = :a"), {"a": aff})
