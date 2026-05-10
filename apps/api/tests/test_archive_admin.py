"""Cycle 8 — admin archive list / restore / purge + 7-day safety.

Each test creates a fresh `documents` row in 'archived' state (so we don't
collide with the seed corpus) and cleans it up on teardown.
"""
from __future__ import annotations

import uuid
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.core.db import session_scope
from app.main import app


async def _login_admin(ac: AsyncClient) -> str:
    r = await ac.post(
        "/api/v1/auth/login",
        json={"email": "admin@mx.local", "password": "admin1234!"},
    )
    assert r.status_code == 200, r.text
    return r.json()["data"]["access_token"]


async def _admin_owner_id() -> str:
    async with session_scope() as s:
        row = (await s.execute(
            text(
                "SELECT id FROM users WHERE role = 'admin' AND is_active = TRUE "
                "ORDER BY created_at LIMIT 1"
            )
        )).first()
        assert row is not None
        return str(row[0])


async def _make_archived_doc(*, age_days: int = 30) -> str:
    """Insert a fresh archived doc whose updated_at is `age_days` old."""
    slug = f"archive-test-{uuid.uuid4().hex[:8]}"
    owner_id = await _admin_owner_id()
    async with session_scope() as s:
        await s.execute(
            text(
                """
                INSERT INTO documents (slug, title, summary, content_json,
                                       owner_id, schema_ver, version, status,
                                       updated_at)
                VALUES (:slug, :title, '', '{}'::jsonb, CAST(:owner AS uuid),
                        '1.0.0', 1, 'archived',
                        NOW() - (CAST(:days AS text) || ' days')::interval)
                """
            ),
            {
                "slug": slug,
                "title": f"archive-test {slug}",
                "owner": owner_id,
                "days": str(age_days),
            },
        )
        await s.commit()
    return slug


async def _drop_doc(slug: str) -> None:
    async with session_scope() as s:
        await s.execute(
            text("DELETE FROM documents WHERE slug = :s"),
            {"s": slug},
        )
        await s.commit()


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_list_archived_returns_archived_docs() -> None:
    """Confirm the response shape: items envelope + each item has the expected
    fields. We don't require our just-inserted doc to be on the first page —
    the seed corpus has hundreds of archived docs — but we do require `total`
    to grow by one and the response shape to match the contract."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        token = await _login_admin(ac)
        r0 = await ac.get(
            "/api/v1/admin/archived-docs",
            params={"limit": 1},
            headers=_bearer(token),
        )
        assert r0.status_code == 200, r0.text
        before_total = r0.json()["meta"]["total"]

        slug = await _make_archived_doc(age_days=2)
        try:
            r1 = await ac.get(
                "/api/v1/admin/archived-docs",
                params={"limit": 1},
                headers=_bearer(token),
            )
            assert r1.status_code == 200, r1.text
            body = r1.json()
            assert body["meta"]["total"] == before_total + 1
            # Newest first → our just-inserted doc (age_days=2) may not be at
            # the top (some seed docs have NOW() updated_at), but the first
            # row's shape must match the contract.
            if body["data"]:
                first = body["data"][0]
                for k in (
                    "slug", "title", "archived_at",
                    "owner_id", "owner_name", "owner_email", "last_edited_at",
                ):
                    assert k in first, k
        finally:
            await _drop_doc(slug)


@pytest.mark.asyncio
async def test_list_archived_since_days_filter() -> None:
    """30-day filter excludes 400-day-old doc and includes 1-day-old doc.
    Verified by comparing totals before/after each insert."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        token = await _login_admin(ac)
        # Baseline total within 30 days.
        r0 = await ac.get(
            "/api/v1/admin/archived-docs",
            params={"since_days": 30, "limit": 1},
            headers=_bearer(token),
        )
        assert r0.status_code == 200
        base_30 = r0.json()["meta"]["total"]

        fresh = await _make_archived_doc(age_days=1)
        old = await _make_archived_doc(age_days=400)
        try:
            r1 = await ac.get(
                "/api/v1/admin/archived-docs",
                params={"since_days": 30, "limit": 1},
                headers=_bearer(token),
            )
            assert r1.status_code == 200
            # Only `fresh` should fall under the 30-day window.
            assert r1.json()["meta"]["total"] == base_30 + 1
        finally:
            await _drop_doc(fresh)
            await _drop_doc(old)


@pytest.mark.asyncio
async def test_non_admin_cannot_list_archived() -> None:
    """Reader token must be 403."""
    from app.core.security import hash_password, make_access_token

    email = f"archive-reader-{uuid.uuid4().hex[:6]}@mx.local"
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
            r = await ac.get(
                "/api/v1/admin/archived-docs",
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
async def test_restore_flips_status_to_draft() -> None:
    slug = await _make_archived_doc(age_days=10)
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            token = await _login_admin(ac)
            r = await ac.post(
                "/api/v1/admin/archived-docs/restore",
                json={"slugs": [slug]},
                headers=_bearer(token),
            )
        assert r.status_code == 200, r.text
        data = r.json()["data"]
        assert slug in data["restored"]
        async with session_scope() as s:
            row = (await s.execute(
                text("SELECT status FROM documents WHERE slug = :s"),
                {"s": slug},
            )).first()
            assert row is not None
            assert row[0] == "draft"
    finally:
        await _drop_doc(slug)


@pytest.mark.asyncio
async def test_restore_skips_non_archived() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        token = await _login_admin(ac)
        r = await ac.post(
            "/api/v1/admin/archived-docs/restore",
            json={"slugs": ["__nope__"]},
            headers=_bearer(token),
        )
    assert r.status_code == 200
    data: dict[str, Any] = r.json()["data"]
    assert data["restored"] == []
    assert any(s["slug"] == "__nope__" for s in data["skipped"])


@pytest.mark.asyncio
async def test_purge_refuses_when_archived_too_recently() -> None:
    """7-day safety: docs archived <7 days ago must NOT be purgeable."""
    slug = await _make_archived_doc(age_days=2)
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            token = await _login_admin(ac)
            r = await ac.request(
                "DELETE",
                "/api/v1/admin/archived-docs/purge",
                json={"slugs": [slug]},
                headers=_bearer(token),
            )
        assert r.status_code == 422, r.text
        details = r.json()["error"]["details"]
        assert slug in details["too_recent"]
        # doc must still exist
        async with session_scope() as s:
            row = (await s.execute(
                text("SELECT 1 FROM documents WHERE slug = :s"),
                {"s": slug},
            )).first()
            assert row is not None
    finally:
        await _drop_doc(slug)


@pytest.mark.asyncio
async def test_purge_force_bypasses_grace_window() -> None:
    """Admin opt-in: `force=true` purges docs archived <7 days ago."""
    slug = await _make_archived_doc(age_days=1)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        token = await _login_admin(ac)
        r = await ac.request(
            "DELETE",
            "/api/v1/admin/archived-docs/purge",
            json={"slugs": [slug], "force": True},
            headers=_bearer(token),
        )
    assert r.status_code == 200, r.text
    assert slug in r.json()["data"]["purged"]
    async with session_scope() as s:
        row = (await s.execute(
            text("SELECT 1 FROM documents WHERE slug = :s"),
            {"s": slug},
        )).first()
        assert row is None


@pytest.mark.asyncio
async def test_purge_hard_deletes_old_archived_doc() -> None:
    slug = await _make_archived_doc(age_days=14)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        token = await _login_admin(ac)
        r = await ac.request(
            "DELETE",
            "/api/v1/admin/archived-docs/purge",
            json={"slugs": [slug]},
            headers=_bearer(token),
        )
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert slug in data["purged"]
    async with session_scope() as s:
        row = (await s.execute(
            text("SELECT 1 FROM documents WHERE slug = :s"),
            {"s": slug},
        )).first()
        assert row is None
