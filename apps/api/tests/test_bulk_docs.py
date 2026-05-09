"""POST /api/v1/admin/bulk-docs — multi-doc admin operations.

Each test posts 2-3 docs (unique slugs), invokes the bulk endpoint, then
asserts state via direct SQL. Per-slug failures (missing slug) are tested
through partial-failure mode.

Auth model:
  - move-part / transition / delete: admin only.
  - add-tag / remove-tag: editor+ on docs they own.
"""
from __future__ import annotations

import json
import uuid
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.core.db import session_scope
from app.core.security import hash_password, make_access_token
from app.main import app

SAMPLES = Path("/workspace/packages/shared/samples")
if not SAMPLES.exists():
    SAMPLES = Path(__file__).resolve().parents[3] / "packages" / "shared" / "samples"


def _ulid_like() -> str:
    import secrets
    alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
    return "".join(secrets.choice(alphabet) for _ in range(26))


def _suffix() -> str:
    return uuid.uuid4().hex[:8]


async def _login_admin(ac: AsyncClient) -> str:
    r = await ac.post(
        "/api/v1/auth/login",
        json={"email": "admin@mx.local", "password": "admin1234!"},
    )
    assert r.status_code == 200, r.text
    return r.json()["data"]["access_token"]


async def _post_doc(
    ac: AsyncClient,
    *,
    slug: str,
    title: str,
    tags: list[str] | None = None,
    headers: dict | None = None,
) -> str:
    sample = json.loads((SAMPLES / "05-minimal-doc.json").read_text(encoding="utf-8"))
    sample["slug"] = slug
    sample["id"] = _ulid_like()
    sample["title"] = title
    sample.setdefault("metadata", {})
    if tags is not None:
        sample["metadata"]["tags"] = list(tags)
    r = await ac.post(
        "/api/v1/documents",
        json=sample,
        headers=headers or {},
    )
    assert r.status_code == 201, r.text
    return r.json()["data"]["slug"]


async def _cleanup(slugs: list[str]) -> None:
    if not slugs:
        return
    async with session_scope() as s:
        await s.execute(
            text("DELETE FROM documents WHERE slug = ANY(:slugs)"),
            {"slugs": slugs},
        )


async def _ensure_editor() -> tuple[str, str]:
    """Idempotent — create an editor user. Returns (id, token)."""
    email = "editor-bulk@mx.local"
    async with session_scope() as s:
        row = (await s.execute(
            text("SELECT id FROM users WHERE email = :e"), {"e": email}
        )).first()
        if row is None:
            await s.execute(
                text(
                    "INSERT INTO users (email, name, password_hash, role) "
                    "VALUES (:e, :n, :pw, 'editor')"
                ),
                {"e": email, "n": "Editor Bulk", "pw": hash_password("test1234!")},
            )
            row = (await s.execute(
                text("SELECT id FROM users WHERE email = :e"), {"e": email}
            )).first()
        assert row is not None
        uid = str(row[0])
    return uid, make_access_token(uid)


# ── move-part ───────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_bulk_move_part_two_docs_succeed() -> None:
    suffix = _suffix()
    slug_a = f"bulk-move-a-{suffix}"
    slug_b = f"bulk-move-b-{suffix}"

    async with session_scope() as s:
        # Pick two distinct parts to ensure we observe the move.
        rows = (await s.execute(
            text("SELECT id FROM parts ORDER BY name LIMIT 2")
        )).all()
    if len(rows) < 2:
        pytest.skip("need at least 2 parts for move test")
    target_part_id = str(rows[1][0])

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        token = await _login_admin(ac)
        h = {"Authorization": f"Bearer {token}"}
        await _post_doc(ac, slug=slug_a, title="MoveA", headers=h)
        await _post_doc(ac, slug=slug_b, title="MoveB", headers=h)
        try:
            r = await ac.post(
                "/api/v1/admin/bulk-docs",
                json={
                    "slugs": [slug_a, slug_b],
                    "op": "move-part",
                    "payload": {"part_id": target_part_id},
                },
                headers=h,
            )
            assert r.status_code == 200, r.text
            data = r.json()["data"]
            assert data["ok"] == 2
            assert data["failed"] == 0
            # Confirm the SQL update.
            async with session_scope() as s:
                rows = (await s.execute(
                    text(
                        "SELECT slug, part_id FROM documents "
                        "WHERE slug = ANY(:slugs)"
                    ),
                    {"slugs": [slug_a, slug_b]},
                )).all()
            for r2 in rows:
                assert str(r2[1]) == target_part_id
        finally:
            await _cleanup([slug_a, slug_b])


@pytest.mark.asyncio
async def test_bulk_move_part_invalid_part_id_400() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        token = await _login_admin(ac)
        r = await ac.post(
            "/api/v1/admin/bulk-docs",
            json={
                "slugs": ["any-slug"],
                "op": "move-part",
                "payload": {"part_id": str(uuid.uuid4())},
            },
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 422, r.text


# ── add-tag / remove-tag ────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_bulk_add_tag_then_remove_tag() -> None:
    suffix = _suffix()
    tag = f"xbulk-{suffix}"
    slug_a = f"bulk-tag-a-{suffix}"
    slug_b = f"bulk-tag-b-{suffix}"
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        token = await _login_admin(ac)
        h = {"Authorization": f"Bearer {token}"}
        await _post_doc(ac, slug=slug_a, title="TA", tags=["existing"], headers=h)
        await _post_doc(ac, slug=slug_b, title="TB", tags=[], headers=h)
        try:
            r1 = await ac.post(
                "/api/v1/admin/bulk-docs",
                json={
                    "slugs": [slug_a, slug_b],
                    "op": "add-tag",
                    "payload": {"tag": tag},
                },
                headers=h,
            )
            assert r1.status_code == 200, r1.text
            assert r1.json()["data"]["ok"] == 2

            # Verify metadata.tags includes the new tag.
            async with session_scope() as s:
                rows = (await s.execute(
                    text(
                        "SELECT slug, content_json -> 'metadata' -> 'tags' "
                        "FROM documents WHERE slug = ANY(:slugs)"
                    ),
                    {"slugs": [slug_a, slug_b]},
                )).all()
            for r in rows:
                tags = r[1]
                if isinstance(tags, str):
                    tags = json.loads(tags)
                assert tag in tags

            # Now remove.
            r2 = await ac.post(
                "/api/v1/admin/bulk-docs",
                json={
                    "slugs": [slug_a, slug_b],
                    "op": "remove-tag",
                    "payload": {"tag": tag},
                },
                headers=h,
            )
            assert r2.status_code == 200, r2.text
            assert r2.json()["data"]["ok"] == 2

            async with session_scope() as s:
                rows = (await s.execute(
                    text(
                        "SELECT content_json -> 'metadata' -> 'tags' "
                        "FROM documents WHERE slug = ANY(:slugs)"
                    ),
                    {"slugs": [slug_a, slug_b]},
                )).all()
            for r in rows:
                tags = r[0]
                if isinstance(tags, str):
                    tags = json.loads(tags)
                assert tag not in tags
        finally:
            await _cleanup([slug_a, slug_b])


@pytest.mark.asyncio
async def test_bulk_tag_op_requires_editor_plus() -> None:
    """A reader user gets 403 on add-tag."""
    # Ensure a reader.
    email = "reader-bulk@mx.local"
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
                {"e": email, "n": "Reader Bulk", "pw": hash_password("test1234!")},
            )
            row = (await s.execute(
                text("SELECT id FROM users WHERE email = :e"), {"e": email}
            )).first()
        assert row is not None
        token = make_access_token(str(row[0]))

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post(
            "/api/v1/admin/bulk-docs",
            json={
                "slugs": ["any-slug"],
                "op": "add-tag",
                "payload": {"tag": "ignored"},
            },
            headers={"Authorization": f"Bearer {token}"},
        )
    assert r.status_code == 403, r.text


@pytest.mark.asyncio
async def test_bulk_editor_can_only_tag_owned_docs() -> None:
    """Editor tagging an admin-owned doc gets a per-slug failure."""
    suffix = _suffix()
    slug = f"bulk-editor-not-owner-{suffix}"
    _uid, etoken = await _ensure_editor()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # Doc created as admin (X-MXWP-User defaulting to admin owner).
        atoken = await _login_admin(ac)
        await _post_doc(
            ac, slug=slug, title="OwnedByAdmin", tags=[],
            headers={"Authorization": f"Bearer {atoken}"},
        )
        try:
            r = await ac.post(
                "/api/v1/admin/bulk-docs",
                json={
                    "slugs": [slug],
                    "op": "add-tag",
                    "payload": {"tag": f"x-{suffix}"},
                },
                headers={"Authorization": f"Bearer {etoken}"},
            )
            assert r.status_code == 200, r.text
            data = r.json()["data"]
            assert data["ok"] == 0
            assert data["failed"] == 1
            assert data["errors"][0]["slug"] == slug
        finally:
            await _cleanup([slug])


# ── transition ──────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_bulk_transition_to_in_review() -> None:
    suffix = _suffix()
    slug = f"bulk-transition-{suffix}"
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        token = await _login_admin(ac)
        h = {"Authorization": f"Bearer {token}"}
        await _post_doc(ac, slug=slug, title="T", headers=h)
        try:
            r = await ac.post(
                "/api/v1/admin/bulk-docs",
                json={
                    "slugs": [slug],
                    "op": "transition",
                    "payload": {"status": "in_review"},
                },
                headers=h,
            )
            assert r.status_code == 200, r.text
            assert r.json()["data"]["ok"] == 1
            async with session_scope() as s:
                row = (await s.execute(
                    text("SELECT status FROM documents WHERE slug = :s"),
                    {"s": slug},
                )).first()
            assert row is not None and row[0] == "in_review"
        finally:
            await _cleanup([slug])


@pytest.mark.asyncio
async def test_bulk_transition_invalid_status_400() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        token = await _login_admin(ac)
        r = await ac.post(
            "/api/v1/admin/bulk-docs",
            json={
                "slugs": ["whatever"],
                "op": "transition",
                "payload": {"status": "totally-bogus"},
            },
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 422, r.text


# ── delete (soft) ───────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_bulk_delete_soft_archives_docs() -> None:
    suffix = _suffix()
    slug_a = f"bulk-del-a-{suffix}"
    slug_b = f"bulk-del-b-{suffix}"
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        token = await _login_admin(ac)
        h = {"Authorization": f"Bearer {token}"}
        await _post_doc(ac, slug=slug_a, title="A", headers=h)
        await _post_doc(ac, slug=slug_b, title="B", headers=h)
        try:
            r = await ac.post(
                "/api/v1/admin/bulk-docs",
                json={"slugs": [slug_a, slug_b], "op": "delete", "payload": {}},
                headers=h,
            )
            assert r.status_code == 200, r.text
            assert r.json()["data"]["ok"] == 2
            async with session_scope() as s:
                rows = (await s.execute(
                    text("SELECT slug, status FROM documents WHERE slug = ANY(:slugs)"),
                    {"slugs": [slug_a, slug_b]},
                )).all()
            for r2 in rows:
                assert r2[1] == "archived"
        finally:
            await _cleanup([slug_a, slug_b])


# ── partial-failure ─────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_bulk_partial_failure_unknown_slug() -> None:
    """Mixing a real slug with a missing slug → ok=1, failed=1, error[0].slug='ghost'."""
    suffix = _suffix()
    slug = f"bulk-partial-{suffix}"
    ghost = f"ghost-{suffix}"
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        token = await _login_admin(ac)
        h = {"Authorization": f"Bearer {token}"}
        await _post_doc(ac, slug=slug, title="P", headers=h)
        try:
            r = await ac.post(
                "/api/v1/admin/bulk-docs",
                json={
                    "slugs": [slug, ghost],
                    "op": "transition",
                    "payload": {"status": "in_review"},
                },
                headers=h,
            )
            assert r.status_code == 200, r.text
            data = r.json()["data"]
            assert data["ok"] == 1
            assert data["failed"] == 1
            assert any(e["slug"] == ghost for e in data["errors"])
        finally:
            await _cleanup([slug])


@pytest.mark.asyncio
async def test_bulk_audit_rows_inserted() -> None:
    """Each successful op should write a `bulk.docs.*` audit row."""
    suffix = _suffix()
    slug = f"bulk-audit-{suffix}"
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        token = await _login_admin(ac)
        h = {"Authorization": f"Bearer {token}"}
        await _post_doc(ac, slug=slug, title="AUD", headers=h)
        try:
            r = await ac.post(
                "/api/v1/admin/bulk-docs",
                json={"slugs": [slug], "op": "delete", "payload": {}},
                headers=h,
            )
            assert r.status_code == 200, r.text
            async with session_scope() as s:
                row = (await s.execute(
                    text(
                        "SELECT action FROM audit_logs "
                        "WHERE target = :t AND action = 'bulk.docs.delete' "
                        "ORDER BY created_at DESC LIMIT 1"
                    ),
                    {"t": f"document:{slug}"},
                )).first()
            assert row is not None
            assert row[0] == "bulk.docs.delete"
        finally:
            await _cleanup([slug])
