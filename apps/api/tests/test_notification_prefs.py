"""Cycle 0019 — notification_prefs CRUD + dispatcher honors prefs.

Coverage targets:
  - GET returns the documented default matrix when nothing is stored
  - PUT round-trip persists the blob and merges partial updates
  - PUT rejects unknown kinds / channels / non-bool values (422)
  - dispatcher (mention insert) skips notifications when in_app=false
  - digest_runner.dispatch skips subscription_event when in_app=false
  - emit_digests_for_user skips digest row when subscription_digest.in_app=false
"""
from __future__ import annotations

import json

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.core.db import session_scope
from app.main import app
from app.services import digest_runner

SEED_SLUG = "month-end-closing"


async def _client() -> AsyncClient:
    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://test")


@pytest.fixture(autouse=True)
async def _reset_user_prefs():
    """Restore the admin user's prefs to {} between tests so failures don't
    bleed into adjacent suites."""
    async with session_scope() as s:
        await s.execute(
            text(
                "UPDATE users SET notification_prefs = CAST('{}' AS jsonb) "
                "WHERE email = 'admin@mx.local'"
            )
        )
        await s.execute(
            text(
                "DELETE FROM notifications WHERE kind IN "
                "('comment_mention','review_request','review_decision',"
                " 'subscription_event','subscription_digest')"
            )
        )
        await s.execute(text("DELETE FROM pending_digest_items"))
        await s.execute(text("DELETE FROM subscriptions"))
    yield
    async with session_scope() as s:
        await s.execute(
            text(
                "UPDATE users SET notification_prefs = CAST('{}' AS jsonb) "
                "WHERE email = 'admin@mx.local'"
            )
        )
        await s.execute(
            text(
                "DELETE FROM notifications WHERE kind IN "
                "('comment_mention','review_request','review_decision',"
                " 'subscription_event','subscription_digest')"
            )
        )
        await s.execute(text("DELETE FROM pending_digest_items"))
        await s.execute(text("DELETE FROM subscriptions"))


# ── GET / PUT round-trip ────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_returns_default_matrix_when_unset() -> None:
    async with await _client() as ac:
        r = await ac.get("/api/v1/me/notification-prefs")
        assert r.status_code == 200, r.text
        prefs = r.json()["data"]["prefs"]
        # Six known kinds (`reaction_added` added in cycle 0021).
        assert set(prefs.keys()) == {
            "comment_mention",
            "review_request",
            "review_decision",
            "subscription_event",
            "subscription_digest",
            "reaction_added",
        }
        # Documented defaults.
        assert prefs["comment_mention"] == {"in_app": True, "email": True}
        assert prefs["review_decision"] == {"in_app": True, "email": False}
        assert prefs["subscription_digest"] == {"in_app": True, "email": True}


@pytest.mark.asyncio
async def test_put_round_trip_merges_partial_body() -> None:
    async with await _client() as ac:
        r1 = await ac.put(
            "/api/v1/me/notification-prefs",
            json={"comment_mention": {"email": False}},
        )
        assert r1.status_code == 200, r1.text
        prefs = r1.json()["data"]["prefs"]
        # Partial PUT applied + other kinds untouched.
        assert prefs["comment_mention"]["email"] is False
        assert prefs["comment_mention"]["in_app"] is True
        assert prefs["review_request"] == {"in_app": True, "email": True}

        # GET sees the same merged state.
        r2 = await ac.get("/api/v1/me/notification-prefs")
        assert r2.status_code == 200
        assert (
            r2.json()["data"]["prefs"]["comment_mention"]["email"] is False
        )


@pytest.mark.asyncio
async def test_put_rejects_unknown_kind() -> None:
    async with await _client() as ac:
        r = await ac.put(
            "/api/v1/me/notification-prefs",
            json={"bogus_kind": {"in_app": True, "email": False}},
        )
        assert r.status_code == 422, r.text


@pytest.mark.asyncio
async def test_put_rejects_non_boolean_channel() -> None:
    async with await _client() as ac:
        r = await ac.put(
            "/api/v1/me/notification-prefs",
            json={"comment_mention": {"in_app": "yes"}},
        )
        assert r.status_code == 422, r.text


# ── Dispatcher honours prefs ─────────────────────────────────────────────


async def _resolve_seed() -> tuple[str, str]:
    async with session_scope() as s:
        u = (await s.execute(
            text("SELECT id FROM users WHERE email = 'admin@mx.local'")
        )).first()
        d = (await s.execute(
            text("SELECT id FROM documents WHERE slug = :s"), {"s": SEED_SLUG}
        )).first()
        assert u and d
        return str(u[0]), str(d[0])


async def _set_prefs_for_admin(blob: dict[str, dict[str, bool]]) -> None:
    async with session_scope() as s:
        await s.execute(
            text(
                "UPDATE users SET notification_prefs = CAST(:p AS jsonb) "
                "WHERE email = 'admin@mx.local'"
            ),
            {"p": json.dumps(blob)},
        )


@pytest.mark.asyncio
async def test_subscription_event_skipped_when_in_app_disabled() -> None:
    user_id, doc_id = await _resolve_seed()
    await _set_prefs_for_admin(
        {"subscription_event": {"in_app": False, "email": False}}
    )
    # Seed an instant subscription.
    async with session_scope() as s:
        await s.execute(
            text(
                """
                INSERT INTO subscriptions
                  (user_id, document_id, events, digest_cadence)
                VALUES (
                  CAST(:u AS uuid), CAST(:d AS uuid),
                  CAST('["doc_edited"]' AS jsonb), 'instant'
                )
                """
            ),
            {"u": user_id, "d": doc_id},
        )
        await s.commit()

    n = await digest_runner.dispatch_subscription_event(
        "doc_edited",
        document_id=doc_id,
        payload={"slug": SEED_SLUG, "title": "x"},
        actor_user_id=None,
    )
    # Pref disabled → no notification row created and no row counted.
    assert n == 0
    async with session_scope() as s:
        cnt = (await s.execute(
            text(
                "SELECT COUNT(*) FROM notifications "
                "WHERE user_id = CAST(:u AS uuid) "
                "AND kind = 'subscription_event'"
            ),
            {"u": user_id},
        )).scalar_one()
        assert int(cnt) == 0


@pytest.mark.asyncio
async def test_subscription_event_inserted_when_pref_unset() -> None:
    """Sanity: defaults treat subscription_event.in_app as True."""
    user_id, doc_id = await _resolve_seed()
    async with session_scope() as s:
        await s.execute(
            text(
                """
                INSERT INTO subscriptions
                  (user_id, document_id, events, digest_cadence)
                VALUES (
                  CAST(:u AS uuid), CAST(:d AS uuid),
                  CAST('["doc_edited"]' AS jsonb), 'instant'
                )
                """
            ),
            {"u": user_id, "d": doc_id},
        )
        await s.commit()

    n = await digest_runner.dispatch_subscription_event(
        "doc_edited",
        document_id=doc_id,
        payload={"slug": SEED_SLUG},
        actor_user_id=None,
    )
    assert n == 1


@pytest.mark.asyncio
async def test_digest_skipped_when_subscription_digest_in_app_disabled() -> None:
    user_id, doc_id = await _resolve_seed()
    await _set_prefs_for_admin(
        {"subscription_digest": {"in_app": False, "email": False}}
    )
    async with session_scope() as s:
        sub_row = (await s.execute(
            text(
                """
                INSERT INTO subscriptions
                  (user_id, document_id, events, digest_cadence)
                VALUES (
                  CAST(:u AS uuid), CAST(:d AS uuid),
                  CAST('["doc_edited"]' AS jsonb), 'daily'
                )
                RETURNING id
                """
            ),
            {"u": user_id, "d": doc_id},
        )).first()
        sub_id = str(sub_row[0])
        await s.execute(
            text(
                """
                INSERT INTO pending_digest_items
                  (subscription_id, user_id, document_id,
                   event_kind, payload)
                VALUES (CAST(:sid AS uuid), CAST(:u AS uuid),
                        CAST(:d AS uuid), 'doc_edited',
                        CAST('{}' AS jsonb))
                """
            ),
            {"sid": sub_id, "u": user_id, "d": doc_id},
        )
        await s.commit()

    async with session_scope() as s:
        bundled = await digest_runner.emit_digests_for_user(s, user_id=user_id)
    # Pref disabled → bundled count still drains the buffer (so we don't
    # accumulate forever) but no notification row is created.
    assert bundled == 1
    async with session_scope() as s:
        cnt = (await s.execute(
            text(
                "SELECT COUNT(*) FROM notifications "
                "WHERE user_id = CAST(:u AS uuid) "
                "AND kind = 'subscription_digest'"
            ),
            {"u": user_id},
        )).scalar_one()
        assert int(cnt) == 0
        # Buffer drained either way.
        left = (await s.execute(
            text("SELECT COUNT(*) FROM pending_digest_items")
        )).scalar_one()
        assert int(left) == 0


@pytest.mark.asyncio
async def test_comment_mention_skipped_when_in_app_disabled() -> None:
    """End-to-end check that the comments router consults prefs."""
    user_id, _ = await _resolve_seed()
    await _set_prefs_for_admin(
        {"comment_mention": {"in_app": False, "email": False}}
    )
    async with await _client() as ac:
        r = await ac.post(
            f"/api/v1/documents/{SEED_SLUG}/comments",
            json={
                "anchor_kind": "document",
                "body_md": "ping",
                "mention_user_ids": [user_id],
            },
        )
        assert r.status_code == 201, r.text
    # No mention notification was inserted.
    async with session_scope() as s:
        cnt = (await s.execute(
            text(
                "SELECT COUNT(*) FROM notifications "
                "WHERE user_id = CAST(:u AS uuid) "
                "AND kind = 'comment_mention'"
            ),
            {"u": user_id},
        )).scalar_one()
        assert int(cnt) == 0
