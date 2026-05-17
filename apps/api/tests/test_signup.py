"""Self-signup flow tests — POST /auth/signup + downstream login.

Touches the real DB via the same conftest that the other auth tests
use; each test uses a unique uuid-suffixed email to stay isolated.
"""
from __future__ import annotations

import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.core.db import session_scope
from app.main import app


def _unique_email(tag: str = "u") -> str:
    return f"signup-{tag}-{uuid.uuid4().hex[:10]}@mx.local"


@pytest.fixture(autouse=True)
def _reset_signup_rate_limit() -> None:
    """Each test gets a fresh signup rate-limit window — the limiter is
    a process-local dict and tests share an event loop."""
    from app.routers import auth as _auth
    _auth._signup_hits.clear()


async def _admin_token(ac: AsyncClient) -> str:
    r = await ac.post(
        "/api/v1/auth/login",
        json={"email": "admin@mx.local", "password": "admin1234!"},
    )
    assert r.status_code == 200, r.text
    return r.json()["data"]["access_token"]


async def _seed_team(slug_hint: str) -> tuple[str, str, str]:
    """Returns (division_slug, team_slug, team_id) — bypasses the admin
    routers because we want unit-test-style isolation independent of the
    admin login session."""
    div_slug = f"sup-div-{slug_hint}-{uuid.uuid4().hex[:6]}"
    team_slug = f"sup-team-{slug_hint}-{uuid.uuid4().hex[:6]}"
    async with session_scope() as s, s.begin():
        d = (await s.execute(
            text("INSERT INTO divisions (slug, name) VALUES (:s, :n) RETURNING id"),
            {"s": div_slug, "n": f"Test Div {slug_hint}"},
        )).scalar_one()
        t = (await s.execute(
            text("""
                INSERT INTO teams (division_id, slug, name)
                VALUES (:d, :s, :n) RETURNING id
            """),
            {"d": d, "s": team_slug, "n": f"Test Team {slug_hint}"},
        )).scalar_one()
    return div_slug, team_slug, str(t)


async def _seed_group(team_id: str, kind: str = "group") -> str:
    slug = f"sup-grp-{uuid.uuid4().hex[:6]}"
    async with session_scope() as s, s.begin():
        g = (await s.execute(
            text("""
                INSERT INTO groups (team_id, slug, name, kind)
                VALUES (:t, :s, :n, :k) RETURNING id
            """),
            {"t": team_id, "s": slug, "n": f"Test {kind}", "k": kind},
        )).scalar_one()
    return str(g)


@pytest.mark.asyncio
async def test_signup_happy_path_creates_reader() -> None:
    _, _, team_id = await _seed_team("happy")
    email = _unique_email("happy")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post("/api/v1/auth/signup", json={
            "email": email, "name": "테스트 사용자",
            "password": "Sample!Pass2026",
            "team_id": team_id,
        })
    assert r.status_code == 201, r.text
    user = r.json()["data"]["user"]
    assert user["email"] == email
    assert user["role"] == "reader"
    assert user["team_id"] == team_id
    assert user["group_id"] is None


@pytest.mark.asyncio
async def test_signup_then_login_succeeds() -> None:
    _, _, team_id = await _seed_team("login")
    email = _unique_email("login")
    pw = "Sample!Pass2026"
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r1 = await ac.post("/api/v1/auth/signup", json={
            "email": email, "name": "로그인 사용자",
            "password": pw, "team_id": team_id,
        })
        assert r1.status_code == 201, r1.text
        r2 = await ac.post(
            "/api/v1/auth/login", json={"email": email, "password": pw}
        )
    assert r2.status_code == 200, r2.text
    assert r2.json()["data"]["user"]["email"] == email


@pytest.mark.asyncio
async def test_signup_with_group_belonging_to_team() -> None:
    _, _, team_id = await _seed_team("group")
    group_id = await _seed_group(team_id, kind="lab")
    email = _unique_email("lab")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post("/api/v1/auth/signup", json={
            "email": email, "name": "랩 사용자",
            "password": "Sample!Pass2026",
            "team_id": team_id, "group_id": group_id,
        })
    assert r.status_code == 201, r.text
    assert r.json()["data"]["user"]["group_id"] == group_id


@pytest.mark.asyncio
async def test_signup_group_belongs_to_wrong_team_rejected() -> None:
    _, _, team_a_id = await _seed_team("a")
    _, _, team_b_id = await _seed_team("b")
    other_group = await _seed_group(team_b_id, kind="group")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post("/api/v1/auth/signup", json={
            "email": _unique_email("wronggroup"),
            "name": "오류 사용자", "password": "Sample!Pass2026",
            "team_id": team_a_id, "group_id": other_group,
        })
    assert r.status_code == 422, r.text


@pytest.mark.asyncio
async def test_signup_duplicate_email_returns_409() -> None:
    _, _, team_id = await _seed_team("dup")
    email = _unique_email("dup")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r1 = await ac.post("/api/v1/auth/signup", json={
            "email": email, "name": "첫번째",
            "password": "Sample!Pass2026", "team_id": team_id,
        })
        assert r1.status_code == 201, r1.text
        r2 = await ac.post("/api/v1/auth/signup", json={
            "email": email, "name": "두번째",
            "password": "Sample!Pass2026", "team_id": team_id,
        })
    assert r2.status_code == 409, r2.text
    assert r2.json()["error"]["code"] == "CONFLICT"


@pytest.mark.asyncio
async def test_signup_bad_password_returns_422() -> None:
    _, _, team_id = await _seed_team("pw")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # pydantic min_length=12 → 422
        r = await ac.post("/api/v1/auth/signup", json={
            "email": _unique_email("pw1"), "name": "짧은비번",
            "password": "short", "team_id": team_id,
        })
        assert r.status_code == 422, r.text
        # 12자 이상이지만 정책 (digit) 미충족 → service 단에서 422
        r2 = await ac.post("/api/v1/auth/signup", json={
            "email": _unique_email("pw2"), "name": "정책위반",
            "password": "OnlyLettersOnly!", "team_id": team_id,
        })
        assert r2.status_code == 422, r2.text


@pytest.mark.asyncio
async def test_signup_unknown_team_returns_422() -> None:
    transport = ASGITransport(app=app)
    fake_team = str(uuid.uuid4())
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post("/api/v1/auth/signup", json={
            "email": _unique_email("noteam"), "name": "유령팀",
            "password": "Sample!Pass2026", "team_id": fake_team,
        })
    assert r.status_code == 422, r.text


@pytest.mark.asyncio
async def test_signup_domain_whitelist_blocks(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.core import config as cfg
    monkeypatch.setattr(
        cfg.get_settings(), "signup_allowed_email_domains", "samsung.com"
    )
    _, _, team_id = await _seed_team("dom")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post("/api/v1/auth/signup", json={
            "email": _unique_email("dom") + ".not",  # @mx.local.not → not allowed
            "name": "외부 도메인", "password": "Sample!Pass2026",
            "team_id": team_id,
        })
    # email regex 자체는 통과하지만 도메인 미허용으로 422
    assert r.status_code == 422, r.text
