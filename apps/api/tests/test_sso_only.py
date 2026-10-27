# SSO 전용 시험 — 가입 닫힘 · 비밀번호 길은 비상 관리자만 · refresh 는 포털 사진이 살아 있을 때만 · 진입 세션 24시간 · 진입마다 소속 → 팀 · 목록
"""사용자 결정 10-25(docs/llm-wiki checklist 'SSO 전용', app/core/sso_only.py). 포털 진입은 test_portal_sso 의 도우미(검증 대역)로 연다."""
from __future__ import annotations

import time
from typing import Any
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from jose import jwt
from sqlalchemy import text

from app.core.config import get_settings
from app.core.db import session_scope
from app.core.security import hash_password, make_refresh_token
from app.main import app
from app.routers import auth_flows
from app.routers import portal_sso as sso_mod

RUN = uuid4().hex[:8]
LOCAL = f"sso-only-local-{RUN}@mx.local"
NORMAL = f"sso-only-normal-{RUN}@mx.local"
PW = "Sso-Only-Pass-123!"


def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test", follow_redirects=False)


@pytest.fixture
async def world(monkeypatch: pytest.MonkeyPatch) -> Any:
    st = get_settings()
    for key, value in (("mxwp_sso_only", True), ("mxwp_local_login_allow", f" {LOCAL.upper()} , other@mx.local"),
                       ("portal_launch_url", "/launch/mx-white-paper"),
                       ("portal_jwks_url", "https://portal.test/.well-known/jwks.json"),
                       ("portal_audience", "mx-white-paper"), ("portal_sso_landing", "/mx-white-paper/")):
        monkeypatch.setattr(st, key, value)
    sso_mod._jwks_cache["keys"] = None
    async with session_scope() as s:
        team = str((await s.execute(text("SELECT id FROM teams ORDER BY slug LIMIT 1"))).scalar())
        ids = {}
        for email, role in ((LOCAL, "admin"), (NORMAL, "editor")):
            ids[email] = str((await s.execute(text("""
                INSERT INTO users (email, name, password_hash, role, team_id, is_active)
                VALUES (:e, 'SSO 전용 시험', :pw, :r, CAST(:t AS uuid), TRUE) RETURNING id
            """), {"e": email, "pw": hash_password(PW), "r": role, "t": team})).scalar())
        await s.commit()
    yield {"ids": ids, "team": team}
    async with session_scope() as s:
        await s.execute(text("DELETE FROM portal_launch_jti WHERE jti LIKE 'jti-test-%'"))
        await s.execute(text("DELETE FROM wiki_aff_team_map WHERE affiliation LIKE :a"), {"a": f"SYN-SSO-{RUN}%"})
        for table in ("auth_tokens", "audit_logs"):
            await s.execute(text(f"DELETE FROM {table} WHERE user_id = ANY(CAST(:i AS uuid[]))"), {"i": list(ids.values())})
        await s.execute(text("DELETE FROM users WHERE id = ANY(CAST(:i AS uuid[]))"), {"i": list(ids.values())})


def _err(r: Any) -> tuple[int, str | None, str | None]:
    body = r.json()
    err = body.get("error") or {}
    return r.status_code, err.get("code"), (err.get("details") or {}).get("launch_url")


async def test_mode_tells_the_screen(world: dict[str, Any], monkeypatch: pytest.MonkeyPatch) -> None:
    async with _client() as c:
        on = (await c.get("/api/v1/auth/mode")).json()["data"]
        monkeypatch.setattr(get_settings(), "mxwp_sso_only", False)
        off = (await c.get("/api/v1/auth/mode")).json()["data"]
    assert on == {"sso_only": True, "launch_url": "/launch/mx-white-paper"} and off["sso_only"] is False


async def test_signup_and_register_are_closed_to_everyone(world: dict[str, Any]) -> None:
    async with _client() as c:
        signup = await c.post("/api/v1/auth/signup", json={"email": LOCAL, "name": "x", "password": PW, "team_id": world["team"]})
        register = await c.post("/api/v1/auth/register", json={"email": f"sso-new-{RUN}@mx.local", "name": "x", "password": PW})
    assert _err(signup) == (403, "SSO_ONLY", "/launch/mx-white-paper")
    assert _err(register)[:2] == (403, "SSO_ONLY")  # 비상 관리자 이메일이어도 가입은 없다


async def test_password_login_only_for_local_admins(world: dict[str, Any], monkeypatch: pytest.MonkeyPatch) -> None:
    async with _client() as c:
        normal = await c.post("/api/v1/auth/login", json={"email": NORMAL, "password": PW})
        normal_wrong = await c.post("/api/v1/auth/login", json={"email": NORMAL, "password": "wrong"})
        local = await c.post("/api/v1/auth/login", json={"email": LOCAL, "password": PW})
        local_wrong = await c.post("/api/v1/auth/login", json={"email": LOCAL, "password": "wrong"})
        monkeypatch.setattr(get_settings(), "mxwp_sso_only", False)
        off = await c.post("/api/v1/auth/login", json={"email": NORMAL, "password": PW})
    assert _err(normal)[:2] == (403, "SSO_ONLY")
    assert _err(normal_wrong)[:2] == (403, "SSO_ONLY")  # 비밀번호를 보기 전에 막는다 — 맞았는지 알려 주지 않는다
    assert local.status_code == 200 and local.json()["data"]["user"]["email"] == LOCAL  # 비상 관리자(대소문자 · 빈칸 무시)
    assert local_wrong.status_code == 401
    assert off.status_code == 200  # 꺼지면 그대로


async def test_password_and_email_flows_are_local_only(world: dict[str, Any]) -> None:
    async with session_scope() as s:
        reset = await auth_flows._mint_token(s, user_id=world["ids"][NORMAL], kind="password_reset", ttl_seconds=900)
        verify = await auth_flows._mint_token(s, user_id=world["ids"][NORMAL], kind="email_verify", ttl_seconds=900)
    async with _client() as c:
        forgot_normal = await c.post("/api/v1/auth/password/forgot", json={"email": NORMAL})
        forgot_local = await c.post("/api/v1/auth/password/forgot", json={"email": LOCAL})
        reset_normal = await c.post("/api/v1/auth/password/reset", json={"token": reset, "new_password": "new-Pass-123!"})
        verify_normal = await c.post("/api/v1/auth/email/verify", json={"token": verify})
    assert _err(forgot_normal)[:2] == (403, "SSO_ONLY") and forgot_local.status_code == 200
    assert _err(reset_normal)[:2] == (403, "SSO_ONLY") and _err(verify_normal)[:2] == (403, "SSO_ONLY")
    async with session_scope() as s:
        hashed = (await s.execute(text("SELECT password_hash FROM users WHERE email = :e"), {"e": NORMAL})).scalar()
    from app.core.security import verify_password
    assert verify_password(PW, hashed)  # 막힌 재설정은 비밀번호를 바꾸지 않았다


async def _refresh(user_id: str) -> Any:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test",
                           cookies={"mxwp_refresh": make_refresh_token(user_id)}) as c:
        return await c.post("/api/v1/auth/refresh")


async def _snapshot(email: str, hours_ago: float | None) -> None:
    async with session_scope() as s:
        await s.execute(text("""
            UPDATE users SET portal_access_at = CASE WHEN CAST(:h AS float) IS NULL THEN NULL
                                                     ELSE NOW() - make_interval(secs => CAST(:h AS float) * 3600) END
             WHERE email = :e
        """), {"e": email, "h": hours_ago})


async def test_refresh_needs_a_fresh_portal_snapshot(world: dict[str, Any], monkeypatch: pytest.MonkeyPatch) -> None:
    normal, local = world["ids"][NORMAL], world["ids"][LOCAL]
    await _snapshot(NORMAL, None)
    never = await _refresh(normal)
    await _snapshot(NORMAL, 25)
    stale = await _refresh(normal)
    await _snapshot(NORMAL, 1)
    fresh = await _refresh(normal)
    local_ok = await _refresh(local)  # 비상 관리자는 사진 없이도
    await _snapshot(NORMAL, None)
    monkeypatch.setattr(get_settings(), "mxwp_sso_only", False)
    off = await _refresh(normal)
    assert _err(never) == (401, "PORTAL_REENTRY", "/launch/mx-white-paper")
    assert _err(stale)[:2] == (401, "PORTAL_REENTRY")  # 켜기 전에 비밀번호로 연 7일 세션도 여기서 끝난다
    assert fresh.status_code == 200 and local_ok.status_code == 200 and off.status_code == 200


def _claims(email: str, **extra: Any) -> dict[str, Any]:
    return {"sub": f"portal-{email}", "email": email, "name": "SSO 전용 시험", "aud": "mx-white-paper", "scope": "launch",
            "jti": f"jti-test-sso-{uuid4().hex[:12]}", "exp": int(time.time()) + 60, **extra}


async def _enter(monkeypatch: pytest.MonkeyPatch, claims: dict[str, Any]) -> Any:
    async def _verify_stub(token: str) -> dict[str, Any]:
        return claims

    monkeypatch.setattr(sso_mod, "_verify_portal_token", _verify_stub)
    async with _client() as c:
        return await c.post("/api/v1/auth/portal-callback", data={"token": "stub"})


def _cookie_ttl(r: Any) -> tuple[int, int]:
    raw = r.headers["set-cookie"]
    max_age = int(raw.split("Max-Age=", 1)[1].split(";", 1)[0])
    token = raw.split("mxwp_refresh=", 1)[1].split(";", 1)[0]
    claims = jwt.get_unverified_claims(token)
    return max_age, int(claims["exp"]) - int(claims["iat"])


async def test_portal_entry_session_lives_as_long_as_the_snapshot(world: dict[str, Any], monkeypatch: pytest.MonkeyPatch) -> None:
    on = await _enter(monkeypatch, _claims(NORMAL))
    monkeypatch.setattr(get_settings(), "mxwp_sso_only", False)
    off = await _enter(monkeypatch, _claims(NORMAL))
    assert on.status_code == 303 and _cookie_ttl(on) == (24 * 3600, 24 * 3600)
    assert _cookie_ttl(off) == (get_settings().jwt_refresh_ttl_seconds,) * 2  # 꺼지면 그대로


async def test_portal_entry_moves_the_team_every_time(world: dict[str, Any], monkeypatch: pytest.MonkeyPatch) -> None:
    aff = f"SYN-SSO-{RUN}"
    async with session_scope() as s:
        other = (await s.execute(text("SELECT id FROM teams WHERE id <> CAST(:t AS uuid) ORDER BY slug LIMIT 1"),
                                 {"t": world["team"]})).scalar()
        if other is None:
            pytest.skip("needs two teams")
        group = (await s.execute(text("SELECT id FROM groups WHERE team_id = CAST(:t AS uuid) LIMIT 1"),
                                 {"t": world["team"]})).scalar()
        await s.execute(text("UPDATE users SET group_id = :g WHERE email = :e"), {"g": group, "e": NORMAL})
        await s.execute(text("INSERT INTO wiki_aff_team_map (affiliation, team_id) VALUES (:a, CAST(:t AS uuid))"),
                        {"a": aff, "t": str(other)})
        await s.commit()
    assert (await _enter(monkeypatch, _claims(NORMAL, affiliation=aff))).status_code == 303
    unmapped = await _enter(monkeypatch, _claims(NORMAL, affiliation=f"{aff}-NOMAP"))
    async with session_scope() as s:
        team, grp = (await s.execute(text("SELECT team_id, group_id FROM users WHERE email = :e"), {"e": NORMAL})).one()
        audit = (await s.execute(text("""
            SELECT payload ->> 'from', payload ->> 'to' FROM audit_logs WHERE action = 'auth.portal.team_sync' AND user_id = CAST(:u AS uuid)
        """), {"u": world["ids"][NORMAL]})).all()
    assert unmapped.status_code == 303
    assert str(team) == str(other) and grp is None  # 다른 팀의 그룹은 비운다 · 표에 없는 소속은 팀을 그대로 둔다
    assert [tuple(a) for a in audit] == [(world["team"], str(other))]


async def test_listing_skips_service_accounts_and_marks_local(world: dict[str, Any], monkeypatch: pytest.MonkeyPatch) -> None:
    from app.scripts.sso_only_check import never_entered

    monkeypatch.setattr(get_settings(), "mxwp_service_accounts", f"admin@mx.local,{NORMAL}")
    rows = {r["email"]: r for r in await never_entered()}
    assert NORMAL not in rows  # 서비스 계정은 뺀다
    assert rows[LOCAL]["local"] is True


async def test_wildcard_affiliation_never_moves_the_team(world: dict[str, Any], monkeypatch: pytest.MonkeyPatch) -> None:
    async with session_scope() as s:
        other = (await s.execute(text("SELECT id FROM teams WHERE id <> CAST(:t AS uuid) ORDER BY slug LIMIT 1"),
                                 {"t": world["team"]})).scalar()
        if other is None:
            pytest.skip("needs two teams")
        # 창구는 '*' 를 막지만 손으로 넣은 줄이 있어도 팀은 움직이지 않아야 한다
        await s.execute(text("INSERT INTO wiki_aff_team_map (affiliation, team_id) VALUES ('*', CAST(:t AS uuid))"),
                        {"t": str(other)})
        await s.commit()
    try:
        assert (await _enter(monkeypatch, _claims(NORMAL, affiliation="*"))).status_code == 303
        async with session_scope() as s:
            team, aff = (await s.execute(text("SELECT team_id, portal_affiliation FROM users WHERE email = :e"),
                                         {"e": NORMAL})).one()
        assert str(team) == world["team"] and aff == "*"  # 소속 사진은 그대로 남기고 팀만 안 옮긴다
    finally:
        async with session_scope() as s:
            await s.execute(text("DELETE FROM wiki_aff_team_map WHERE affiliation = '*'"))
