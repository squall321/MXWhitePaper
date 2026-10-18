"""Sprint 6 — Auth & RBAC 통합 테스트."""
from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.mark.asyncio
async def test_login_admin_returns_access_and_user() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post(
            "/api/v1/auth/login",
            json={"email": "admin@mx.local", "password": "admin1234!"},
        )
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert "access_token" in data and len(data["access_token"]) > 20
    assert data["token_type"] == "Bearer"
    assert data["user"]["email"] == "admin@mx.local"
    assert data["user"]["role"] == "admin"


@pytest.mark.asyncio
async def test_login_bad_password_returns_401() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post(
            "/api/v1/auth/login",
            json={"email": "admin@mx.local", "password": "WRONG-PASS"},
        )
    assert r.status_code == 401, r.text
    body = r.json()
    assert body["error"]["code"] == "UNAUTHORIZED"


@pytest.mark.asyncio
async def test_me_with_bearer_token() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r1 = await ac.post(
            "/api/v1/auth/login",
            json={"email": "admin@mx.local", "password": "admin1234!"},
        )
        token = r1.json()["data"]["access_token"]
        r2 = await ac.get(
            "/api/v1/me",
            headers={"Authorization": f"Bearer {token}"},
        )
    assert r2.status_code == 200, r2.text
    me = r2.json()["data"]
    assert me["email"] == "admin@mx.local"
    assert me["role"] == "admin"


@pytest.mark.asyncio
async def test_protected_route_requires_token_in_production(monkeypatch) -> None:
    """APP_ENV=production 으로 강제 → bearer 없이 GET /me 호출 시 401."""
    # get_settings 는 lru_cache 라 환경변수만 바꿔선 안되고 캐시도 비워야 한다.
    from app.core import config as cfg
    monkeypatch.setenv("APP_ENV", "production")
    cfg.get_settings.cache_clear()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/v1/me")

    cfg.get_settings.cache_clear()  # 다른 테스트 영향 차단
    assert r.status_code == 401, r.text


@pytest.mark.asyncio
async def test_dev_fallback_allows_request_without_token() -> None:
    """APP_ENV=development 이고 ALLOW_DEV_ADMIN_FALLBACK 을 켜면(conftest 가 시험 프로세스에서 켠다) bearer 없이도 GET /me 가 admin."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/v1/me")
    assert r.status_code == 200, r.text
    assert r.json()["data"]["role"] == "admin"


@pytest.mark.asyncio
@pytest.mark.parametrize("app_env, switch", [("development", False), ("production", True)])
async def test_dev_fallback_is_closed_unless_both_set(monkeypatch: pytest.MonkeyPatch, app_env: str, switch: bool) -> None:
    """b5b199c — 스위치(allow_dev_admin_fallback)의 기본은 꺼짐이고, development 와 스위치가 둘 다일 때만 열린다.
    .env 를 예제에서 복사한 운영 박스가 아무 실수 없이도 인증 없이 뜨던 것을 막는 성질이다."""
    from app.core.config import get_settings

    s = get_settings()
    monkeypatch.setattr(s, "app_env", app_env)
    monkeypatch.setattr(s, "allow_dev_admin_fallback", switch)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/v1/me")
    assert r.status_code == 401, r.text


def test_dev_fallback_switch_defaults_off() -> None:
    from app.core.config import Settings

    assert Settings.model_fields["allow_dev_admin_fallback"].default is False


@pytest.mark.asyncio
async def test_refresh_via_cookie() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r1 = await ac.post(
            "/api/v1/auth/login",
            json={"email": "admin@mx.local", "password": "admin1234!"},
        )
        assert r1.status_code == 200
        # cookie 가 set 되었는지 확인
        cookie_header = r1.headers.get("set-cookie", "")
        assert "mxwp_refresh" in cookie_header

        # refresh 호출 — httpx 가 자동으로 cookie 를 다음 요청에 실어준다
        r2 = await ac.post("/api/v1/auth/refresh")
    assert r2.status_code == 200, r2.text
    assert "access_token" in r2.json()["data"]
