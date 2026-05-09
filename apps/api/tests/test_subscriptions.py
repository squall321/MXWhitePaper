"""Cycle 0018 — subscriptions CRUD + dispatcher + digest_runner.

Coverage targets:
  - POST/DELETE/PATCH/GET endpoints round-trip for the seed doc
  - dispatcher inserts notifications for instant subs and pending_digest_items
    for daily/weekly subs (and skips the actor)
  - digest_runner.emit_digests_for_user bundles items, deletes them, and
    advances `last_digest_at` past the cutoff
  - tick_once is gated on the settings flag

The dispatcher unit test directly seeds rows in the DB; the API tests use the
dev-fallback admin so we don't have to mint extra users.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

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
async def _wipe_subscriptions():
    """Clean both tables before AND after each test so failures don't bleed."""
    async with session_scope() as s:
        await s.execute(text("DELETE FROM pending_digest_items"))
        await s.execute(text("DELETE FROM subscriptions"))
        await s.execute(
            text("DELETE FROM notifications WHERE kind IN "
                 "('subscription_event','subscription_digest')")
        )
    yield
    async with session_scope() as s:
        await s.execute(text("DELETE FROM pending_digest_items"))
        await s.execute(text("DELETE FROM subscriptions"))
        await s.execute(
            text("DELETE FROM notifications WHERE kind IN "
                 "('subscription_event','subscription_digest')")
        )


# ── Endpoint round-trip ──────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_subscribe_then_list_then_unsubscribe() -> None:
    async with await _client() as ac:
        r1 = await ac.post(
            f"/api/v1/documents/{SEED_SLUG}/subscribe",
            json={"digest_cadence": "daily"},
        )
        assert r1.status_code == 201, r1.text
        sub_id = r1.json()["data"]["subscription_id"]
        assert sub_id

        r2 = await ac.get("/api/v1/me/subscriptions")
        assert r2.status_code == 200
        items = r2.json()["data"]["items"]
        match = next((it for it in items if it["slug"] == SEED_SLUG), None)
        assert match is not None
        assert match["digest_cadence"] == "daily"
        assert "doc_edited" in match["events"]

        # Subscribers list (admin role from dev fallback satisfies editor+).
        r3 = await ac.get(f"/api/v1/documents/{SEED_SLUG}/subscribers")
        assert r3.status_code == 200
        sub_items = r3.json()["data"]["items"]
        assert any(s["subscription_id"] == sub_id for s in sub_items)

        r4 = await ac.delete(f"/api/v1/documents/{SEED_SLUG}/subscribe")
        assert r4.status_code == 204


@pytest.mark.asyncio
async def test_subscribe_is_idempotent_and_patch_updates_cadence() -> None:
    async with await _client() as ac:
        r1 = await ac.post(
            f"/api/v1/documents/{SEED_SLUG}/subscribe",
            json={"digest_cadence": "instant"},
        )
        assert r1.status_code == 201
        sid = r1.json()["data"]["subscription_id"]

        # Re-subscribe with different cadence — must not 409, must update.
        r2 = await ac.post(
            f"/api/v1/documents/{SEED_SLUG}/subscribe",
            json={"digest_cadence": "weekly", "events": ["doc_edited"]},
        )
        assert r2.status_code == 201
        assert r2.json()["data"]["subscription_id"] == sid

        # PATCH route also works.
        r3 = await ac.patch(
            f"/api/v1/subscriptions/{sid}",
            json={"digest_cadence": "daily"},
        )
        assert r3.status_code == 200, r3.text
        assert r3.json()["data"]["digest_cadence"] == "daily"


@pytest.mark.asyncio
async def test_subscribe_validation_rejects_unknown_event() -> None:
    async with await _client() as ac:
        r = await ac.post(
            f"/api/v1/documents/{SEED_SLUG}/subscribe",
            json={"events": ["doc_edited", "bogus"]},
        )
        # Pydantic v2 validation errors come back as 422.
        assert r.status_code == 422


# ── Dispatcher: instant vs digest separation ─────────────────────────────


async def _seed_subscription(
    user_id: str, doc_id: str, cadence: str
) -> str:
    async with session_scope() as s:
        row = (await s.execute(
            text(
                """
                INSERT INTO subscriptions
                  (user_id, document_id, events, digest_cadence)
                VALUES (
                  CAST(:u AS uuid), CAST(:d AS uuid),
                  CAST('["doc_edited","comment_added","review_decided","doc_published"]' AS jsonb),
                  :c
                )
                RETURNING id
                """
            ),
            {"u": user_id, "d": doc_id, "c": cadence},
        )).first()
        await s.commit()
        return str(row[0])


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


@pytest.mark.asyncio
async def test_dispatcher_instant_inserts_notification() -> None:
    user_id, doc_id = await _resolve_seed()
    await _seed_subscription(user_id, doc_id, "instant")

    n = await digest_runner.dispatch_subscription_event(
        "doc_edited",
        document_id=doc_id,
        payload={"document_id": doc_id, "slug": SEED_SLUG, "title": "x"},
        actor_user_id=None,
    )
    assert n == 1
    async with session_scope() as s:
        row = (await s.execute(
            text("SELECT kind FROM notifications WHERE user_id = CAST(:u AS uuid)"
                 " AND kind = 'subscription_event'"),
            {"u": user_id},
        )).first()
        assert row is not None
        # No buffer rows queued for instant subs.
        cnt = (await s.execute(
            text("SELECT COUNT(*) FROM pending_digest_items")
        )).scalar_one()
        assert int(cnt) == 0


@pytest.mark.asyncio
async def test_dispatcher_daily_buffers_and_skips_actor() -> None:
    user_id, doc_id = await _resolve_seed()
    await _seed_subscription(user_id, doc_id, "daily")

    # actor==self → no insert (don't notify yourself)
    n = await digest_runner.dispatch_subscription_event(
        "doc_edited",
        document_id=doc_id,
        payload={"document_id": doc_id, "slug": SEED_SLUG},
        actor_user_id=user_id,
    )
    assert n == 0

    # actor None → buffered
    n2 = await digest_runner.dispatch_subscription_event(
        "comment_added",
        document_id=doc_id,
        payload={"document_id": doc_id, "slug": SEED_SLUG},
    )
    assert n2 == 1
    async with session_scope() as s:
        cnt = (await s.execute(
            text("SELECT COUNT(*) FROM pending_digest_items")
        )).scalar_one()
        assert int(cnt) == 1


# ── Digest runner ────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_emit_digests_bundles_items_and_advances_cutoff() -> None:
    user_id, doc_id = await _resolve_seed()
    sub_id = await _seed_subscription(user_id, doc_id, "daily")

    # Buffer two items
    async with session_scope() as s:
        for kind in ("doc_edited", "comment_added"):
            await s.execute(
                text(
                    """
                    INSERT INTO pending_digest_items
                      (subscription_id, user_id, document_id,
                       event_kind, payload)
                    VALUES (CAST(:sid AS uuid), CAST(:u AS uuid),
                            CAST(:d AS uuid), :k,
                            CAST('{"slug":"month-end-closing","title":"X"}' AS jsonb))
                    """
                ),
                {"sid": sub_id, "u": user_id, "d": doc_id, "k": kind},
            )
        await s.commit()

    # Cutoff fires (last_digest_at IS NULL, so it's automatically due).
    async with session_scope() as s:
        bundled = await digest_runner.emit_digests_for_user(
            s, user_id=user_id
        )
    assert bundled == 2

    async with session_scope() as s:
        # One subscription_digest notification
        cnt = (await s.execute(
            text("SELECT COUNT(*) FROM notifications WHERE user_id = CAST(:u AS uuid)"
                 " AND kind = 'subscription_digest'"),
            {"u": user_id},
        )).scalar_one()
        assert int(cnt) == 1
        # Buffer cleared
        left = (await s.execute(
            text("SELECT COUNT(*) FROM pending_digest_items")
        )).scalar_one()
        assert int(left) == 0
        # last_digest_at advanced
        last = (await s.execute(
            text("SELECT last_digest_at FROM subscriptions"
                 " WHERE id = CAST(:s AS uuid)"),
            {"s": sub_id},
        )).scalar_one()
        assert last is not None


@pytest.mark.asyncio
async def test_emit_digests_skips_when_within_cutoff() -> None:
    user_id, doc_id = await _resolve_seed()
    sub_id = await _seed_subscription(user_id, doc_id, "weekly")

    # Set last_digest_at to "1 hour ago" — far less than 7 days.
    async with session_scope() as s:
        await s.execute(
            text("UPDATE subscriptions SET last_digest_at = :t"
                 " WHERE id = CAST(:s AS uuid)"),
            {
                "t": datetime.now(timezone.utc) - timedelta(hours=1),
                "s": sub_id,
            },
        )
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
    assert bundled == 0


@pytest.mark.asyncio
async def test_tick_once_gated_on_settings_flag() -> None:
    from app.core.config import get_settings

    settings = get_settings()
    settings.subscription_digest_enabled = False
    try:
        n = await digest_runner.tick_once()
        assert n == 0
    finally:
        settings.subscription_digest_enabled = True
