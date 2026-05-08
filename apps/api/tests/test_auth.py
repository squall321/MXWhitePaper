"""Sprint 6 — Auth & RBAC 통합 테스트."""
from __future__ import annotations

import os

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
    """APP_ENV=development 가 디폴트 — bearer 없이도 GET /me 가 admin 으로 동작."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/v1/me")
    assert r.status_code == 200, r.text
    assert r.json()["data"]["role"] == "admin"


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
