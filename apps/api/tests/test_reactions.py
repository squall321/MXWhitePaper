"""Cycle 0021 — emoji reactions: CRUD + aggregate + toggle + notification.

Coverage targets:
  - POST /reactions inserts a row, GET aggregate returns the count
  - second POST with the same emoji removes it (toggle)
  - POST with an unknown emoji rejects with 422
  - GET /me/reactions/:slug returns the caller's emojis
  - reacting to a doc owned by another user inserts a `reaction_added`
    notification for that owner; reacting to your own doc does not
"""
from __future__ import annotations

import json
import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.core.db import session_scope
from app.main import app

SEED_SLUG = "month-end-closing"


async def _client() -> AsyncClient:
    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://test")


@pytest.fixture(autouse=True)
async def _wipe_reactions():
    """Drain reactions + reaction_added notifications between tests so a
    failing case can't bleed counts into the next one."""
    async with session_scope() as s:
        await s.execute(text("DELETE FROM reactions"))
        await s.execute(
            text("DELETE FROM notifications WHERE kind = 'reaction_added'")
        )
        await s.execute(
            text(
                "UPDATE users SET notification_prefs = CAST('{}' AS jsonb) "
                "WHERE email = 'admin@mx.local'"
            )
        )
    yield
    async with session_scope() as s:
        await s.execute(text("DELETE FROM reactions"))
        await s.execute(
            text("DELETE FROM notifications WHERE kind = 'reaction_added'")
        )


async def _resolve_doc_id() -> str:
    async with session_scope() as s:
        d = (await s.execute(
            text("SELECT id FROM documents WHERE slug = :s"),
            {"s": SEED_SLUG},
        )).first()
        assert d
        return str(d[0])


async def _seed_secondary_user(email: str) -> str:
    """Create an extra editor; return its UUID. Used as the doc-owner stand-in
    for the "self-react" suppression test."""
    async with session_scope() as s:
        existing = (await s.execute(
            text("SELECT id FROM users WHERE email = :e"), {"e": email}
        )).first()
        if existing:
            return str(existing[0])
        row = (await s.execute(
            text(
                """
                INSERT INTO users (email, name, role, is_active, password_hash)
                VALUES (:e, :n, 'editor', TRUE, 'x')
                RETURNING id
                """
            ),
            {"e": email, "n": email.split("@")[0]},
        )).first()
        assert row is not None  # INSERT...RETURNING always emits one row
        await s.commit()
        return str(row[0])


# ── core CRUD + aggregate ───────────────────────────────────────────────


@pytest.mark.asyncio
async def test_post_then_aggregate_counts_one() -> None:
    async with await _client() as ac:
        doc_id = await _resolve_doc_id()
        r = await ac.post(
            "/api/v1/reactions",
            json={"document_id": doc_id, "emoji": "thumbs-up"},
        )
        assert r.status_code == 201, r.text
        assert r.json()["data"]["removed"] is False

        agg = await ac.get(f"/api/v1/documents/{SEED_SLUG}/reactions")
        assert agg.status_code == 200
        data = agg.json()["data"]
        assert data["doc"].get("thumbs-up") == 1
        assert data["blocks"] == {}


@pytest.mark.asyncio
async def test_toggle_removes_existing() -> None:
    async with await _client() as ac:
        doc_id = await _resolve_doc_id()
        r1 = await ac.post(
            "/api/v1/reactions",
            json={"document_id": doc_id, "emoji": "heart"},
        )
        assert r1.status_code == 201, r1.text
        assert r1.json()["data"]["removed"] is False

        r2 = await ac.post(
            "/api/v1/reactions",
            json={"document_id": doc_id, "emoji": "heart"},
        )
        assert r2.status_code == 201, r2.text
        assert r2.json()["data"]["removed"] is True

        agg = await ac.get(f"/api/v1/documents/{SEED_SLUG}/reactions")
        assert agg.json()["data"]["doc"].get("heart", 0) == 0


@pytest.mark.asyncio
async def test_block_level_reaction_grouped_per_block() -> None:
    """Two different blocks each get their own reaction bucket."""
    async with await _client() as ac:
        doc_id = await _resolve_doc_id()
        b1 = "01ABCDEFGH0123456789ABCDEF"
        b2 = "01ABCDEFGH0123456789FFFFFF"
        for bid in (b1, b2):
            r = await ac.post(
                "/api/v1/reactions",
                json={"document_id": doc_id, "block_id": bid, "emoji": "tada"},
            )
            assert r.status_code == 201, r.text

        agg = await ac.get(f"/api/v1/documents/{SEED_SLUG}/reactions")
        data = agg.json()["data"]
        assert data["blocks"][b1].get("tada") == 1
        assert data["blocks"][b2].get("tada") == 1
        # Doc-level bucket untouched.
        assert data["doc"].get("tada", 0) == 0


@pytest.mark.asyncio
async def test_unknown_emoji_rejected() -> None:
    async with await _client() as ac:
        doc_id = await _resolve_doc_id()
        r = await ac.post(
            "/api/v1/reactions",
            json={"document_id": doc_id, "emoji": "rocket"},
        )
        assert r.status_code == 422, r.text


@pytest.mark.asyncio
async def test_my_reactions_lists_my_emojis_only() -> None:
    async with await _client() as ac:
        doc_id = await _resolve_doc_id()
        r1 = await ac.post(
            "/api/v1/reactions",
            json={"document_id": doc_id, "emoji": "thinking"},
        )
        assert r1.status_code == 201, r1.text
        block_id = "01ABCDEFGH0123456789AAAAAA"
        r2 = await ac.post(
            "/api/v1/reactions",
            json={
                "document_id": doc_id,
                "block_id": block_id,
                "emoji": "pray",
            },
        )
        assert r2.status_code == 201, r2.text

        me = await ac.get(f"/api/v1/me/reactions/{SEED_SLUG}")
        assert me.status_code == 200, me.text
        data = me.json()["data"]
        assert "thinking" in data["doc"]
        assert "pray" in data["blocks"][block_id]


@pytest.mark.asyncio
async def test_aggregate_404_for_unknown_slug() -> None:
    async with await _client() as ac:
        r = await ac.get(
            f"/api/v1/documents/no-such-slug-{uuid.uuid4().hex[:6]}/reactions"
        )
        assert r.status_code == 404


# ── notification fan-out ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_reaction_on_other_owner_doc_inserts_notification() -> None:
    """When the doc owner is *not* the actor, a `reaction_added` row exists."""
    async with session_scope() as s:
        # Ensure the seed doc is owned by a different user than the dev
        # admin fallback (admin@mx.local). We swap owner_id for the duration
        # of the test, then reset on teardown.
        admin = (await s.execute(
            text("SELECT id FROM users WHERE email = 'admin@mx.local'")
        )).first()
        original = (await s.execute(
            text(
                "SELECT owner_id FROM documents WHERE slug = :s"
            ),
            {"s": SEED_SLUG},
        )).first()
        assert admin and original
        original_owner = str(original[0])

    other_user = await _seed_secondary_user(
        f"react-owner-{uuid.uuid4().hex[:6]}@mx.local"
    )
    async with session_scope() as s:
        await s.execute(
            text(
                "UPDATE documents SET owner_id = CAST(:o AS uuid) "
                "WHERE slug = :s"
            ),
            {"o": other_user, "s": SEED_SLUG},
        )
        await s.commit()

    try:
        async with await _client() as ac:
            doc_id = await _resolve_doc_id()
            r = await ac.post(
                "/api/v1/reactions",
                json={"document_id": doc_id, "emoji": "tada"},
            )
            assert r.status_code == 201, r.text

        async with session_scope() as s:
            row = (await s.execute(
                text(
                    "SELECT payload FROM notifications "
                    "WHERE kind = 'reaction_added' "
                    "AND user_id = CAST(:u AS uuid)"
                ),
                {"u": other_user},
            )).first()
            assert row is not None
            payload = row[0]
            if isinstance(payload, str):
                payload = json.loads(payload)
            assert payload.get("emoji") == "tada"
            assert payload.get("slug") == SEED_SLUG
    finally:
        # Restore owner so adjacent tests aren't surprised.
        async with session_scope() as s:
            await s.execute(
                text(
                    "UPDATE documents SET owner_id = CAST(:o AS uuid) "
                    "WHERE slug = :s"
                ),
                {"o": original_owner, "s": SEED_SLUG},
            )
            await s.commit()


@pytest.mark.asyncio
async def test_self_react_does_not_notify() -> None:
    """Reacting to your own doc produces no `reaction_added` row."""
    async with await _client() as ac:
        doc_id = await _resolve_doc_id()
        r = await ac.post(
            "/api/v1/reactions",
            json={"document_id": doc_id, "emoji": "heart"},
        )
        assert r.status_code == 201, r.text
    async with session_scope() as s:
        cnt = (await s.execute(
            text(
                "SELECT COUNT(*) FROM notifications "
                "WHERE kind = 'reaction_added'"
            )
        )).scalar_one()
        assert int(cnt) == 0
