"""Tier 2D — usage analytics endpoints."""
from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.security import hash_password, make_access_token
from app.core.db import session_scope
from app.main import app
from sqlalchemy import text


async def _login_admin(ac: AsyncClient) -> str:
    r = await ac.post(
        "/api/v1/auth/login",
        json={"email": "admin@mx.local", "password": "admin1234!"},
    )
    assert r.status_code == 200, r.text
    return r.json()["data"]["access_token"]


async def _ensure_reader_token() -> str:
    email = "reader-analytics@mx.local"
    async with session_scope() as s:
        row = (await s.execute(
            text("SELECT id FROM users WHERE email = :e"), {"e": email}
        )).first()
        if row is None:
            await s.execute(
                text(
                    "INSERT INTO users (email, name, password_hash, role) "
                    "VALUES (:e, :n, :pw, 'reader')"
                ),
                {"e": email, "n": "Reader (analytics)", "pw": hash_password("test1234!")},
            )
            row = (await s.execute(
                text("SELECT id FROM users WHERE email = :e"), {"e": email}
            )).first()
        assert row is not None
        uid = str(row[0])
    return make_access_token(uid)


@pytest.mark.asyncio
async def test_analytics_overview_basic_shape() -> None:
    transport = ASGITransport(app=app)
    token = await _ensure_reader_token()
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get(
            "/api/v1/analytics/overview",
            headers={"Authorization": f"Bearer {token}"},
        )
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    for key in (
        "mau",
        "total_docs",
        "total_links",
        "avg_backlinks",
        "top_searches",
        "top_viewed_docs",
    ):
        assert key in data, key
    assert isinstance(data["mau"], int)
    assert isinstance(data["top_searches"], list)
    assert isinstance(data["top_viewed_docs"], list)


@pytest.mark.asyncio
async def test_analytics_daily_returns_window_length() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        token = await _login_admin(ac)
        r = await ac.get(
            "/api/v1/analytics/daily?days=7",
            headers={"Authorization": f"Bearer {token}"},
        )
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert isinstance(data, list)
    assert len(data) == 7
    for row in data:
        for key in ("date", "active_users", "doc_writes", "doc_reads", "search_count"):
            assert key in row, key


@pytest.mark.asyncio
async def test_analytics_top_views_returns_list() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        token = await _login_admin(ac)
        r = await ac.get(
            "/api/v1/analytics/top-views?days=30",
            headers={"Authorization": f"Bearer {token}"},
        )
    assert r.status_code == 200, r.text
    body = r.json()
    assert isinstance(body["data"], list)


@pytest.mark.asyncio
async def test_search_logs_audit_row_with_rate_limit() -> None:
    """첫 검색은 audit_logs 에 'search' 1건을 남기고, 60s 내 같은 쿼리 재호출은 추가 X."""
    from app.services import search_audit
    search_audit.reset()

    transport = ASGITransport(app=app)
    q = f"tier2dQuery_{__import__('uuid').uuid4().hex[:6]}"
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        token = await _login_admin(ac)
        h = {"Authorization": f"Bearer {token}"}
        r1 = await ac.get(f"/api/v1/search?q={q}", headers=h)
        assert r1.status_code == 200, r1.text
        r2 = await ac.get(f"/api/v1/search?q={q}", headers=h)
        assert r2.status_code == 200, r2.text

    async with session_scope() as s:
        cnt = int((await s.execute(
            text(
                "SELECT COUNT(*) FROM audit_logs WHERE action = 'search' "
                "AND target = :t AND created_at >= NOW() - INTERVAL '5 minutes'"
            ),
            {"t": q},
        )).scalar() or 0)
    assert cnt == 1, f"expected exactly 1 audit row, got {cnt}"
