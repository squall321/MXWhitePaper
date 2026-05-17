"""Activity feed router — aggregation across multiple source tables.

Each test seeds (or reuses seed) rows in one source table, then exercises
either the aggregate endpoint or `?kind=` / `?since=` / `?limit=` filters.
"""
from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.core.db import get_db
from app.core.security import make_access_token
from app.main import app

SEED_SLUG = "month-end-closing"


async def _client() -> AsyncClient:
    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://test")


async def _new_session():
    gen = get_db()
    s = await anext(gen)
    return s, gen


async def _close_session(gen) -> None:
    try:
        await anext(gen)
    except StopAsyncIteration:
        pass


async def _seed_doc_id() -> tuple[str, str]:
    s, gen = await _new_session()
    try:
        row = (await s.execute(
            text("SELECT id, owner_id FROM documents WHERE slug = :s"),
            {"s": SEED_SLUG},
        )).first()
        assert row is not None, "seed document missing"
        return str(row[0]), str(row[1])
    finally:
        await _close_session(gen)


async def _ensure_user(email: str, role: str = "reader") -> str:
    s, gen = await _new_session()
    try:
        await s.execute(
            text(
                """
                INSERT INTO users (email, name, role, password_hash, is_active)
                VALUES (:e, :n, :r, 'placeholder', TRUE)
                ON CONFLICT (email) DO UPDATE
                  SET role = EXCLUDED.role, is_active = TRUE
                """
            ),
            {"e": email, "n": email.split("@")[0], "r": role},
        )
        await s.commit()
        row = (await s.execute(
            text("SELECT id FROM users WHERE email = :e"), {"e": email}
        )).first()
        return str(row[0])
    finally:
        await _close_session(gen)


@pytest.mark.asyncio
async def test_activity_aggregates_multiple_kinds() -> None:
    """The /activity endpoint should yield rows across more than one source."""
    _doc_id, _ = await _seed_doc_id()
    # Drop a fresh comment so we know at least one comment_added is in the feed.
    async with await _client() as ac:
        rc = await ac.post(
            f"/api/v1/documents/{SEED_SLUG}/comments",
            json={"anchor_kind": "document", "body_md": "활동 피드 테스트"},
        )
        assert rc.status_code == 201, rc.text

        r = await ac.get("/api/v1/activity", params={"limit": 100})
    assert r.status_code == 200, r.text
    items = r.json()["data"]["items"]
    kinds = {it["kind"] for it in items}
    # Seed migration leaves at least version=1 doc rows + the new comment.
    assert "comment_added" in kinds
    assert any(
        k in kinds for k in ("doc_created", "doc_edited")
    ), kinds
    # Ordering: timestamps must be non-increasing.
    ts = [it["timestamp"] for it in items if it.get("timestamp")]
    assert ts == sorted(ts, reverse=True)


@pytest.mark.asyncio
async def test_activity_kind_filter_returns_only_requested() -> None:
    async with await _client() as ac:
        await ac.post(
            f"/api/v1/documents/{SEED_SLUG}/comments",
            json={"anchor_kind": "document", "body_md": "kind filter"},
        )
        r = await ac.get("/api/v1/activity", params={"kind": "comment_added"})
    assert r.status_code == 200, r.text
    items = r.json()["data"]["items"]
    assert items, "expected at least one comment_added row"
    assert {it["kind"] for it in items} == {"comment_added"}


@pytest.mark.asyncio
async def test_activity_since_filter_excludes_older_rows() -> None:
    # Anchor in the future — nothing should match.
    future = (datetime.now(tz=UTC) + timedelta(days=365)).isoformat()
    async with await _client() as ac:
        r = await ac.get("/api/v1/activity", params={"since": future})
    assert r.status_code == 200, r.text
    assert r.json()["data"]["items"] == []


@pytest.mark.asyncio
async def test_activity_limit_caps_results() -> None:
    # Drop several comments, then ask for limit=2.
    async with await _client() as ac:
        for i in range(5):
            await ac.post(
                f"/api/v1/documents/{SEED_SLUG}/comments",
                json={"anchor_kind": "document", "body_md": f"limit-{i}"},
            )
        r = await ac.get(
            "/api/v1/activity",
            params={"kind": "comment_added", "limit": 2},
        )
    assert r.status_code == 200, r.text
    assert len(r.json()["data"]["items"]) == 2


@pytest.mark.asyncio
async def test_activity_me_filters_to_user_targets() -> None:
    """`/activity/me` should only return rows where the actor / owner is me."""
    other_email = "activity-other@mx.local"
    me_email = "activity-me@mx.local"
    other_id = await _ensure_user(other_email, "editor")
    me_id = await _ensure_user(me_email, "editor")

    me_jwt = make_access_token(me_id)
    me_headers = {"Authorization": f"Bearer {me_jwt}"}

    other_jwt = make_access_token(other_id)
    other_headers = {"Authorization": f"Bearer {other_jwt}"}

    async with await _client() as ac:
        # Other user files a comment under the seed doc; me does too.
        ro = await ac.post(
            f"/api/v1/documents/{SEED_SLUG}/comments",
            json={"anchor_kind": "document", "body_md": "OTHER"},
            headers=other_headers,
        )
        assert ro.status_code == 201, ro.text
        rm = await ac.post(
            f"/api/v1/documents/{SEED_SLUG}/comments",
            json={"anchor_kind": "document", "body_md": "MINE"},
            headers=me_headers,
        )
        assert rm.status_code == 201, rm.text

        r = await ac.get(
            "/api/v1/activity/me",
            params={"kind": "comment_added", "limit": 100},
            headers=me_headers,
        )
    assert r.status_code == 200, r.text
    items = r.json()["data"]["items"]
    # All returned comment_added rows must have actor.user_id == me.
    # (Owner-of-seed-doc is a separate admin user; me is not the owner.)
    actor_ids = {it["actor"]["user_id"] for it in items}
    assert me_id in actor_ids
    assert other_id not in actor_ids


@pytest.mark.asyncio
async def test_activity_event_shape_has_required_fields() -> None:
    async with await _client() as ac:
        await ac.post(
            f"/api/v1/documents/{SEED_SLUG}/comments",
            json={"anchor_kind": "document", "body_md": "shape"},
        )
        r = await ac.get(
            "/api/v1/activity",
            params={"kind": "comment_added", "limit": 1},
        )
    assert r.status_code == 200, r.text
    items = r.json()["data"]["items"]
    assert items, "expected one event"
    ev = items[0]
    for key in ("id", "kind", "actor", "target", "timestamp", "summary", "metadata"):
        assert key in ev, key
    assert ev["actor"].get("name")
    assert ev["target"].get("slug") == SEED_SLUG


@pytest.mark.asyncio
async def test_activity_ignores_unknown_kinds() -> None:
    async with await _client() as ac:
        r = await ac.get("/api/v1/activity", params={"kind": "bogus,thing"})
    assert r.status_code == 200, r.text
    # Falls back to all kinds when none of the requested ones are valid.
    meta = r.json().get("meta") or {}
    assert "kinds" in meta and len(meta["kinds"]) >= 1
