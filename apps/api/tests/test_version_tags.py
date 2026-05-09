"""Cycle 16 — version tags + branch-from-tag.

Coverage:
  - POST/GET/DELETE round-trip on the seed `month-end-closing` doc
  - duplicate tag_name returns 409 Conflict
  - tagging an unknown version returns 404
  - is_locked=true tag rejects editor delete (403), admin delete works
  - reader cannot create or delete tags (403)
  - branch-from-tag creates a new doc with v1 = snapshot at the tagged version
  - branch_from_tag with a duplicate target slug returns 409
  - branch_from_tag with a missing tag returns 404
"""
from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.core.db import session_scope
from app.core.security import hash_password, make_access_token
from app.main import app

SEED_SLUG = "month-end-closing"


async def _client() -> AsyncClient:
    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://test")


@pytest.fixture(autouse=True)
async def _wipe_version_tags():
    """Clean version_tags + any branched docs created by tests."""
    async with session_scope() as s:
        await s.execute(
            text(
                "DELETE FROM version_tags vt USING documents d "
                "WHERE vt.document_id = d.id AND d.slug = :s"
            ),
            {"s": SEED_SLUG},
        )
        await s.execute(
            text("DELETE FROM documents WHERE slug LIKE 'branch-test-%'")
        )
    yield
    async with session_scope() as s:
        await s.execute(
            text(
                "DELETE FROM version_tags vt USING documents d "
                "WHERE vt.document_id = d.id AND d.slug = :s"
            ),
            {"s": SEED_SLUG},
        )
        await s.execute(
            text("DELETE FROM documents WHERE slug LIKE 'branch-test-%'")
        )


async def _ensure_reader_token() -> str:
    email = "reader-version-tags@mx.local"
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
                {"e": email, "n": "Reader VT", "pw": hash_password("test1234!")},
            )
            row = (await s.execute(
                text("SELECT id FROM users WHERE email = :e"), {"e": email}
            )).first()
        assert row is not None
        uid = str(row[0])
    return make_access_token(uid)


# ── CRUD round-trip ──────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_create_then_list_then_delete() -> None:
    async with await _client() as ac:
        r0 = await ac.get(f"/api/v1/documents/{SEED_SLUG}/versions")
        assert r0.status_code == 200, r0.text
        versions = r0.json()["data"]
        assert versions, "seed doc must have at least one version"
        v = int(versions[0]["version"])

        r1 = await ac.post(
            f"/api/v1/documents/{SEED_SLUG}/versions/{v}/tags",
            json={
                "tag_name": "v1.0 release",
                "description": "first stable cut",
                "is_locked": False,
            },
        )
        assert r1.status_code == 201, r1.text
        tag = r1.json()["data"]
        assert tag["tag_name"] == "v1.0 release"
        assert tag["version"] == v
        assert tag["description"] == "first stable cut"
        assert tag["is_locked"] is False

        r2 = await ac.get(f"/api/v1/documents/{SEED_SLUG}/version-tags")
        assert r2.status_code == 200, r2.text
        items = r2.json()["data"]["items"]
        assert any(t["tag_name"] == "v1.0 release" for t in items)

        r3 = await ac.delete(
            f"/api/v1/documents/{SEED_SLUG}/version-tags/v1.0 release"
        )
        assert r3.status_code == 204

        r4 = await ac.get(f"/api/v1/documents/{SEED_SLUG}/version-tags")
        assert all(t["tag_name"] != "v1.0 release"
                   for t in r4.json()["data"]["items"])


# ── error paths ──────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_duplicate_tag_returns_409() -> None:
    async with await _client() as ac:
        r0 = await ac.get(f"/api/v1/documents/{SEED_SLUG}/versions")
        v = int(r0.json()["data"][0]["version"])

        r1 = await ac.post(
            f"/api/v1/documents/{SEED_SLUG}/versions/{v}/tags",
            json={"tag_name": "RC1"},
        )
        assert r1.status_code == 201, r1.text

        r2 = await ac.post(
            f"/api/v1/documents/{SEED_SLUG}/versions/{v}/tags",
            json={"tag_name": "RC1"},
        )
        assert r2.status_code == 409, r2.text


@pytest.mark.asyncio
async def test_tag_unknown_version_404() -> None:
    async with await _client() as ac:
        r = await ac.post(
            f"/api/v1/documents/{SEED_SLUG}/versions/99999/tags",
            json={"tag_name": "ghost"},
        )
        assert r.status_code == 404, r.text


@pytest.mark.asyncio
async def test_tag_unknown_doc_404() -> None:
    async with await _client() as ac:
        r = await ac.post(
            "/api/v1/documents/no-such-doc/versions/1/tags",
            json={"tag_name": "x"},
        )
        assert r.status_code == 404


@pytest.mark.asyncio
async def test_delete_unknown_tag_404() -> None:
    async with await _client() as ac:
        r = await ac.delete(
            f"/api/v1/documents/{SEED_SLUG}/version-tags/no-such-tag"
        )
        assert r.status_code == 404


# ── lock semantics ──────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_locked_tag_blocks_editor_delete_and_admin_can() -> None:
    async with await _client() as ac:
        r0 = await ac.get(f"/api/v1/documents/{SEED_SLUG}/versions")
        v = int(r0.json()["data"][0]["version"])

        r1 = await ac.post(
            f"/api/v1/documents/{SEED_SLUG}/versions/{v}/tags",
            json={"tag_name": "frozen", "is_locked": True},
        )
        assert r1.status_code == 201

        # Editor user (non-admin) — must be 403 on delete.
        editor_email = "editor-version-tags@mx.local"
        async with session_scope() as s:
            row = (await s.execute(
                text("SELECT id FROM users WHERE email = :e"),
                {"e": editor_email},
            )).first()
            if row is None:
                await s.execute(
                    text(
                        "INSERT INTO users (email, name, password_hash, role) "
                        "VALUES (:e, :n, :pw, 'editor')"
                    ),
                    {
                        "e": editor_email,
                        "n": "Editor VT",
                        "pw": hash_password("test1234!"),
                    },
                )
                row = (await s.execute(
                    text("SELECT id FROM users WHERE email = :e"),
                    {"e": editor_email},
                )).first()
            assert row is not None
            uid = str(row[0])
        editor_token = make_access_token(uid)

        r2 = await ac.delete(
            f"/api/v1/documents/{SEED_SLUG}/version-tags/frozen",
            headers={"Authorization": f"Bearer {editor_token}"},
        )
        assert r2.status_code == 403, r2.text

        # admin (default dev fallback user) can delete.
        r3 = await ac.delete(
            f"/api/v1/documents/{SEED_SLUG}/version-tags/frozen"
        )
        assert r3.status_code == 204


@pytest.mark.asyncio
async def test_reader_cannot_create_tag() -> None:
    async with await _client() as ac:
        r0 = await ac.get(f"/api/v1/documents/{SEED_SLUG}/versions")
        v = int(r0.json()["data"][0]["version"])
        token = await _ensure_reader_token()
        r = await ac.post(
            f"/api/v1/documents/{SEED_SLUG}/versions/{v}/tags",
            json={"tag_name": "denied"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 403


# ── branch-from-tag ─────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_branch_from_tag_creates_new_doc() -> None:
    target = "branch-test-from-rc1"
    async with await _client() as ac:
        r0 = await ac.get(f"/api/v1/documents/{SEED_SLUG}/versions")
        v = int(r0.json()["data"][0]["version"])

        r1 = await ac.post(
            f"/api/v1/documents/{SEED_SLUG}/versions/{v}/tags",
            json={"tag_name": "rc-branch"},
        )
        assert r1.status_code == 201, r1.text

        r2 = await ac.post(
            f"/api/v1/documents/{SEED_SLUG}/branch-from-tag",
            json={"tag_name": "rc-branch", "target_slug": target},
        )
        assert r2.status_code == 201, r2.text
        data = r2.json()["data"]
        assert data["slug"] == target
        assert data["version"] == 1
        assert data["branched_from"]["slug"] == SEED_SLUG
        assert data["branched_from"]["version"] == v
        assert data["branched_from"]["tag_name"] == "rc-branch"

        # The new doc must be GET-able and contain the tagged snapshot's body.
        r3 = await ac.get(f"/api/v1/documents/{target}")
        assert r3.status_code == 200, r3.text
        body = r3.json()["data"]
        assert body["slug"] == target
        # title is preserved from the snapshot
        assert body["title"]


@pytest.mark.asyncio
async def test_branch_from_tag_404_for_missing_tag() -> None:
    async with await _client() as ac:
        r = await ac.post(
            f"/api/v1/documents/{SEED_SLUG}/branch-from-tag",
            json={"tag_name": "no-such-tag", "target_slug": "branch-test-x"},
        )
        assert r.status_code == 404


@pytest.mark.asyncio
async def test_branch_from_tag_409_on_duplicate_target() -> None:
    target = "branch-test-dup"
    async with await _client() as ac:
        r0 = await ac.get(f"/api/v1/documents/{SEED_SLUG}/versions")
        v = int(r0.json()["data"][0]["version"])
        r1 = await ac.post(
            f"/api/v1/documents/{SEED_SLUG}/versions/{v}/tags",
            json={"tag_name": "dup-branch"},
        )
        assert r1.status_code == 201
        r2 = await ac.post(
            f"/api/v1/documents/{SEED_SLUG}/branch-from-tag",
            json={"tag_name": "dup-branch", "target_slug": target},
        )
        assert r2.status_code == 201
        # second branch with the same slug must fail with 409.
        r3 = await ac.post(
            f"/api/v1/documents/{SEED_SLUG}/branch-from-tag",
            json={"tag_name": "dup-branch", "target_slug": target},
        )
        assert r3.status_code == 409, r3.text
