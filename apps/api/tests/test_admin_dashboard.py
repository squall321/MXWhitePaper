"""Tier 2D — admin dashboard endpoints + RBAC + audit/health/maintenance."""
from __future__ import annotations

import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.core.db import session_scope
from app.core.security import hash_password, make_access_token
from app.main import app


async def _login_admin(ac: AsyncClient) -> str:
    r = await ac.post(
        "/api/v1/auth/login",
        json={"email": "admin@mx.local", "password": "admin1234!"},
    )
    assert r.status_code == 200, r.text
    return r.json()["data"]["access_token"]


async def _ensure_reader_user() -> tuple[str, str, str]:
    """Idempotent — create a reader test user. Returns (id, email, token)."""
    email = "reader-tier2d@mx.local"
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
                {"e": email, "n": "Reader", "pw": hash_password("test1234!")},
            )
            row = (await s.execute(
                text("SELECT id FROM users WHERE email = :e"), {"e": email}
            )).first()
        assert row is not None
        uid = str(row[0])
    return uid, email, make_access_token(uid)


# ── Users CRUD ──────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_admin_can_list_users() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        token = await _login_admin(ac)
        r = await ac.get(
            "/api/v1/admin/users",
            headers={"Authorization": f"Bearer {token}"},
            params={"q": "admin"},
        )
    assert r.status_code == 200, r.text
    body = r.json()
    emails = [u["email"] for u in body["data"]]
    assert "admin@mx.local" in emails


@pytest.mark.asyncio
async def test_non_admin_cannot_list_users() -> None:
    transport = ASGITransport(app=app)
    _uid, _email, token = await _ensure_reader_user()
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get(
            "/api/v1/admin/users",
            headers={"Authorization": f"Bearer {token}"},
        )
    assert r.status_code == 403, r.text


@pytest.mark.asyncio
async def test_admin_can_patch_user_role_and_revert() -> None:
    """Patch role for the reader user → editor → reader (revert)."""
    uid, _email, _token = await _ensure_reader_user()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        atoken = await _login_admin(ac)
        h = {"Authorization": f"Bearer {atoken}"}
        r = await ac.patch(
            f"/api/v1/admin/users/{uid}",
            json={"role": "editor"},
            headers=h,
        )
        assert r.status_code == 200, r.text
        assert r.json()["data"]["role"] == "editor"

        # revert
        r2 = await ac.patch(
            f"/api/v1/admin/users/{uid}",
            json={"role": "reader"},
            headers=h,
        )
        assert r2.status_code == 200, r2.text
        assert r2.json()["data"]["role"] == "reader"


# ── Audit / Health / Maintenance ────────────────────────────────────────


@pytest.mark.asyncio
async def test_admin_audit_returns_recent_rows() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        token = await _login_admin(ac)
        r = await ac.get(
            "/api/v1/admin/audit",
            params={"limit": 5},
            headers={"Authorization": f"Bearer {token}"},
        )
    assert r.status_code == 200, r.text
    assert isinstance(r.json()["data"], list)


@pytest.mark.asyncio
async def test_admin_health_counters_present() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        token = await _login_admin(ac)
        r = await ac.get(
            "/api/v1/admin/health",
            headers={"Authorization": f"Bearer {token}"},
        )
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    for key in (
        "docs_active",
        "docs_archived",
        "users_active",
        "users_inactive",
        "audit_24h",
        "images",
        "pending_uploads",
        "meilisearch_docs",
    ):
        assert key in data, key
        assert isinstance(data[key], int)


@pytest.mark.asyncio
async def test_admin_maintenance_run_idempotent() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        token = await _login_admin(ac)
        h = {"Authorization": f"Bearer {token}"}
        r1 = await ac.post("/api/v1/admin/maintenance/run", headers=h)
        assert r1.status_code == 200, r1.text
        r2 = await ac.post("/api/v1/admin/maintenance/run", headers=h)
        assert r2.status_code == 200, r2.text
        # second run should yield zero compactions (idempotent).
        assert r2.json()["data"]["compacted_versions"] == 0


@pytest.mark.asyncio
async def test_non_admin_cannot_run_maintenance() -> None:
    transport = ASGITransport(app=app)
    _uid, _email, token = await _ensure_reader_user()
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post(
            "/api/v1/admin/maintenance/run",
            headers={"Authorization": f"Bearer {token}"},
        )
    assert r.status_code == 403, r.text


# ── Document view ping ──────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_document_view_ping_creates_audit_row() -> None:
    """POST /documents/{slug}/view 가 audit_logs 에 행을 1건 추가한다."""
    transport = ASGITransport(app=app)
    # 첫 번째 published 문서 하나 빌려쓰기.
    async with session_scope() as s:
        row = (await s.execute(
            text(
                "SELECT slug FROM documents WHERE status = 'published' "
                "ORDER BY created_at LIMIT 1"
            )
        )).first()
    if row is None:
        pytest.skip("no published document available")
    slug = row[0]
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        token = await _login_admin(ac)
        h = {"Authorization": f"Bearer {token}"}
        marker = uuid.uuid4().hex[:6]
        # view ping 1
        r1 = await ac.post(f"/api/v1/documents/{slug}/view", headers=h)
        assert r1.status_code == 204, r1.text
        # 60초 rate-limit 안에서 두번째 호출은 audit row 추가 안 함 (그래도 204).
        r2 = await ac.post(f"/api/v1/documents/{slug}/view", headers=h)
        assert r2.status_code == 204, r2.text
        _ = marker  # silence linter

    async with session_scope() as s:
        cnt = int((await s.execute(
            text(
                "SELECT COUNT(*) FROM audit_logs WHERE action = 'document.view' "
                "AND target = :t AND created_at >= NOW() - INTERVAL '5 minutes'"
            ),
            {"t": f"document:{slug}"},
        )).scalar() or 0)
    assert cnt >= 1
