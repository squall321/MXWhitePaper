"""Phase 5 — 시스템 지식 (knowledge) 검색 통합 테스트.

knowledge 인덱스는 repo 의 docs/ 마크다운에서 빌드되므로 DB seed 와 무관.
Meilisearch 가 죽어있으면 skip (test_search.py 와 동일 정책).
"""
from __future__ import annotations

import os
import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.core.db import session_scope
from app.main import app
from app.search import knowledge_indexer


@pytest.fixture(autouse=True)
def _meili_required() -> None:
    if os.environ.get("MXWP_SKIP_MEILI") == "1":
        pytest.skip("MXWP_SKIP_MEILI is set")


async def _login_admin(ac: AsyncClient) -> str:
    r = await ac.post(
        "/api/v1/auth/login",
        json={"email": "admin@mx.local", "password": "admin1234!"},
    )
    assert r.status_code == 200, r.text
    return r.json()["data"]["access_token"]


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_knowledge_search_requires_auth_in_production(monkeypatch) -> None:
    """APP_ENV=production 강제 → bearer 없이 401 (dev fallback 차단)."""
    from app.core import config as cfg
    monkeypatch.setenv("APP_ENV", "production")
    cfg.get_settings.cache_clear()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/v1/search/knowledge", params={"q": "lat"})

    cfg.get_settings.cache_clear()  # 다른 테스트 영향 차단
    assert r.status_code == 401, r.text


@pytest.mark.asyncio
async def test_reindex_requires_admin() -> None:
    """Reader token 으로 reindex 호출 시 403."""
    from app.core.security import hash_password, make_access_token

    email = f"knowledge-reader-{uuid.uuid4().hex[:6]}@mx.local"
    async with session_scope() as s:
        await s.execute(
            text(
                "INSERT INTO users (email, name, password_hash, role) "
                "VALUES (:e, 'r', :pw, 'reader')"
            ),
            {"e": email, "pw": hash_password("xx")},
        )
        await s.commit()
        row = (await s.execute(
            text("SELECT id FROM users WHERE email = :e"), {"e": email}
        )).first()
        assert row is not None
        uid = str(row[0])
    token = make_access_token(uid)
    transport = ASGITransport(app=app)
    try:
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            r = await ac.post(
                "/api/v1/search/knowledge/reindex",
                headers=_bearer(token),
            )
        assert r.status_code == 403, r.text
    finally:
        async with session_scope() as s:
            await s.execute(
                text("DELETE FROM users WHERE email = :e"), {"e": email}
            )
            await s.commit()


@pytest.mark.asyncio
async def test_admin_reindex_returns_count() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        token = await _login_admin(ac)
        r = await ac.post(
            "/api/v1/search/knowledge/reindex",
            headers=_bearer(token),
        )
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["count"] > 0
    assert data["by_kind"].get("lat", 0) > 0
    assert data["by_kind"].get("archive", 0) > 0


@pytest.mark.asyncio
async def test_query_returns_hits() -> None:
    knowledge_indexer.rebuild_index()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        token = await _login_admin(ac)
        r = await ac.get(
            "/api/v1/search/knowledge",
            params={"q": "apptainer", "limit": 10},
            headers=_bearer(token),
        )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["meta"]["total"] >= 1, body
    first = body["data"][0]
    for k in ("id", "kind", "area", "doc_path", "heading", "snippet", "highlights"):
        assert k in first, k
