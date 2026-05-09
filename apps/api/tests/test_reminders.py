"""Cycle 0028 — reminders CRUD + ticker fan-out.

Coverage targets:
  - POST/GET/PATCH/DELETE endpoints round-trip on the seed doc
  - tick_once fires due rows, inserts a notifications(kind='reminder') row,
    and stamps fired_at so the same row never re-fires
  - tick_once skips reminders whose remind_at is still in the future
  - tick_once is gated on `settings.reminder_runner_enabled`
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.core.db import session_scope
from app.main import app
from app.services import reminder_runner

SEED_SLUG = "month-end-closing"


async def _client() -> AsyncClient:
    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://test")


@pytest.fixture(autouse=True)
async def _wipe_reminders():
    """Clean reminders + reminder notifications before AND after each test."""
    async with session_scope() as s:
        await s.execute(text("DELETE FROM reminders"))
        await s.execute(
            text("DELETE FROM notifications WHERE kind = 'reminder'")
        )
    yield
    async with session_scope() as s:
        await s.execute(text("DELETE FROM reminders"))
        await s.execute(
            text("DELETE FROM notifications WHERE kind = 'reminder'")
        )


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


# ── Endpoint round-trip ──────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_create_then_list_then_patch_then_delete() -> None:
    in_two_hours = (
        datetime.now(timezone.utc) + timedelta(hours=2)
    ).isoformat()
    async with await _client() as ac:
        r1 = await ac.post(
            f"/api/v1/documents/{SEED_SLUG}/reminders",
            json={"remind_at": in_two_hours, "message": "Follow up"},
        )
        assert r1.status_code == 201, r1.text
        rid = r1.json()["data"]["id"]
        assert rid
        assert r1.json()["data"]["message"] == "Follow up"

        r2 = await ac.get("/api/v1/me/reminders")
        assert r2.status_code == 200
        items = r2.json()["data"]["items"]
        match = next((it for it in items if it["id"] == rid), None)
        assert match is not None
        assert match["slug"] == SEED_SLUG
        assert match["fired_at"] is None

        # PATCH — bump remind_at + drop the message
        in_three_hours = (
            datetime.now(timezone.utc) + timedelta(hours=3)
        ).isoformat()
        r3 = await ac.patch(
            f"/api/v1/reminders/{rid}",
            json={"remind_at": in_three_hours, "message": None},
        )
        assert r3.status_code == 200, r3.text
        assert r3.json()["data"]["message"] is None

        r4 = await ac.delete(f"/api/v1/reminders/{rid}")
        assert r4.status_code == 204

        # And the list goes back to empty for unfired rows.
        r5 = await ac.get("/api/v1/me/reminders")
        assert r5.status_code == 200
        assert r5.json()["data"]["items"] == []


@pytest.mark.asyncio
async def test_create_validation_rejects_bad_timestamp() -> None:
    async with await _client() as ac:
        r = await ac.post(
            f"/api/v1/documents/{SEED_SLUG}/reminders",
            json={"remind_at": "not-a-real-date"},
        )
        assert r.status_code == 422


@pytest.mark.asyncio
async def test_create_404_on_unknown_slug() -> None:
    in_two_hours = (
        datetime.now(timezone.utc) + timedelta(hours=2)
    ).isoformat()
    async with await _client() as ac:
        r = await ac.post(
            "/api/v1/documents/not-a-real-doc/reminders",
            json={"remind_at": in_two_hours},
        )
        assert r.status_code == 404


# ── Runner: ticker fan-out ───────────────────────────────────────────────


async def _seed_reminder(
    user_id: str,
    doc_id: str,
    *,
    remind_at: datetime,
    message: str | None = None,
) -> str:
    async with session_scope() as s:
        row = (await s.execute(
            text(
                """
                INSERT INTO reminders (user_id, document_id, message, remind_at)
                VALUES (CAST(:u AS uuid), CAST(:d AS uuid), :m, :ra)
                RETURNING id
                """
            ),
            {"u": user_id, "d": doc_id, "m": message, "ra": remind_at},
        )).first()
        await s.commit()
        return str(row[0])


@pytest.mark.asyncio
async def test_tick_once_fires_due_reminder_and_stamps_fired_at() -> None:
    user_id, doc_id = await _resolve_seed()
    past = datetime.now(timezone.utc) - timedelta(minutes=1)
    rid = await _seed_reminder(
        user_id, doc_id, remind_at=past, message="ping me"
    )

    fired = await reminder_runner.tick_once()
    assert fired == 1

    async with session_scope() as s:
        cnt = (await s.execute(
            text(
                "SELECT COUNT(*) FROM notifications "
                "WHERE user_id = CAST(:u AS uuid) AND kind = 'reminder'"
            ),
            {"u": user_id},
        )).scalar_one()
        assert int(cnt) == 1

        stamped = (await s.execute(
            text(
                "SELECT fired_at FROM reminders WHERE id = CAST(:r AS uuid)"
            ),
            {"r": rid},
        )).scalar_one()
        assert stamped is not None

    # Second tick must NOT re-fire the same row.
    fired_again = await reminder_runner.tick_once()
    assert fired_again == 0


@pytest.mark.asyncio
async def test_tick_once_skips_future_reminder() -> None:
    user_id, doc_id = await _resolve_seed()
    future = datetime.now(timezone.utc) + timedelta(hours=1)
    await _seed_reminder(user_id, doc_id, remind_at=future)

    fired = await reminder_runner.tick_once()
    assert fired == 0


@pytest.mark.asyncio
async def test_tick_once_gated_on_settings_flag() -> None:
    from app.core.config import get_settings

    user_id, doc_id = await _resolve_seed()
    past = datetime.now(timezone.utc) - timedelta(minutes=1)
    await _seed_reminder(user_id, doc_id, remind_at=past)

    settings = get_settings()
    settings.reminder_runner_enabled = False
    try:
        n = await reminder_runner.tick_once()
        assert n == 0
    finally:
        settings.reminder_runner_enabled = True
