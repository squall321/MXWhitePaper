"""Cycle 15 U4 — automation cron ticker + CRUD round-trip.

Drives the actual ticker (no mocking) against Postgres + a stub webhook
client. Verifies:

  - POST /automation/rules with trigger_kind='cron' + a valid expression
    persists cron_expression and a sensible next_cron_run_at.
  - POST without/with-bad cron_expression rejects 422.
  - PATCH switching trigger_kind off cron clears the schedule columns.
  - tick_once fires due rules, advances next_cron_run_at, and writes a
    run_log row through the existing dispatcher.
  - tick_once disables a rule whose cron_expression is poison.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.core.db import session_scope
from app.main import app
from app.services import automation_cron, webhook_dispatcher


async def _client() -> AsyncClient:
    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://test")


# ── webhook stub (mirrors test_automation.py) ────────────────────────────


class _FakeResponse:
    def __init__(self, status: int, body: str = "") -> None:
        self.status_code = status
        self.text = body


class _FakeClient:
    def __init__(self, calls: list[dict[str, Any]]) -> None:
        self._calls = calls

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def post(self, url: str, *, content: bytes, headers: dict[str, str], timeout: float):
        self._calls.append({"url": url, "body": content})
        return _FakeResponse(200, "ok")


class _FakeFactory:
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    def __call__(self) -> _FakeClient:
        return _FakeClient(self.calls)


@pytest.fixture(autouse=True)
async def _wipe():
    async with session_scope() as s:
        await s.execute(text("DELETE FROM automation_run_log"))
        await s.execute(text("DELETE FROM automation_rules"))
    webhook_dispatcher.reset_client_factory()
    yield
    async with session_scope() as s:
        await s.execute(text("DELETE FROM automation_run_log"))
        await s.execute(text("DELETE FROM automation_rules"))
    webhook_dispatcher.reset_client_factory()


# ── CRUD ─────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_create_cron_rule_validates_and_sets_schedule() -> None:
    async with await _client() as ac:
        r = await ac.post(
            "/api/v1/automation/rules",
            json={
                "name": "monthly nag",
                "trigger_kind": "cron",
                "cron_expression": "0 9 * * 1",
                "action_kind": "notification_blast",
                "action_payload": {"kind": "automation_blast", "message_template": "Mon!"},
            },
        )
        assert r.status_code == 201, r.text
        data = r.json()["data"]
        assert data["trigger_kind"] == "cron"
        assert data["cron_expression"] == "0 9 * * 1"
        assert data["next_cron_run_at"] is not None
        # next_cron_run_at must be in the future.
        nxt = datetime.fromisoformat(data["next_cron_run_at"])
        assert nxt > datetime.now(timezone.utc) - timedelta(seconds=5)


@pytest.mark.asyncio
async def test_cron_rule_rejects_missing_expression() -> None:
    async with await _client() as ac:
        r = await ac.post(
            "/api/v1/automation/rules",
            json={
                "name": "broken",
                "trigger_kind": "cron",
                # cron_expression intentionally missing
                "action_kind": "notification_blast",
                "action_payload": {},
            },
        )
        assert r.status_code == 422


@pytest.mark.asyncio
async def test_cron_rule_rejects_garbage_expression() -> None:
    async with await _client() as ac:
        r = await ac.post(
            "/api/v1/automation/rules",
            json={
                "name": "broken",
                "trigger_kind": "cron",
                "cron_expression": "not a cron",
                "action_kind": "notification_blast",
                "action_payload": {},
            },
        )
        assert r.status_code == 422


@pytest.mark.asyncio
async def test_patch_off_cron_clears_schedule() -> None:
    async with await _client() as ac:
        r = await ac.post(
            "/api/v1/automation/rules",
            json={
                "name": "switch test",
                "trigger_kind": "cron",
                "cron_expression": "0 0 * * *",
                "action_kind": "notification_blast",
                "action_payload": {},
            },
        )
        assert r.status_code == 201
        rid = r.json()["data"]["id"]
        # Switch to an event trigger — schedule columns should clear.
        r = await ac.patch(
            f"/api/v1/automation/rules/{rid}",
            json={"trigger_kind": "doc_published"},
        )
        assert r.status_code == 200, r.text
        body = r.json()["data"]
        assert body["trigger_kind"] == "doc_published"
        assert body["cron_expression"] is None
        assert body["next_cron_run_at"] is None


# ── Ticker ───────────────────────────────────────────────────────────────


async def _force_due(rule_id: str) -> None:
    """Backdate next_cron_run_at so the next tick treats this rule as due."""
    async with session_scope() as s:
        await s.execute(
            text(
                "UPDATE automation_rules "
                "SET next_cron_run_at = NOW() - INTERVAL '1 minute' "
                "WHERE id = CAST(:r AS uuid)"
            ),
            {"r": rule_id},
        )
        await s.commit()


@pytest.mark.asyncio
async def test_tick_fires_due_cron_rule_and_advances_schedule() -> None:
    async with await _client() as ac:
        r = await ac.post(
            "/api/v1/automation/rules",
            json={
                "name": "tick me",
                "trigger_kind": "cron",
                "cron_expression": "*/15 * * * *",
                "action_kind": "notification_blast",
                "action_payload": {"kind": "automation_blast", "message_template": "tick"},
            },
        )
        assert r.status_code == 201
        rid = r.json()["data"]["id"]

    await _force_due(rid)
    fired = await automation_cron.tick_once()
    assert fired == 1

    # The rule's fire_count + last_fired_at must have bumped, and
    # next_cron_run_at must be in the future again.
    async with session_scope() as s:
        row = (await s.execute(
            text(
                "SELECT fire_count, last_fired_at, next_cron_run_at "
                "FROM automation_rules WHERE id = CAST(:r AS uuid)"
            ),
            {"r": rid},
        )).first()
        assert row is not None
        assert int(row[0]) == 1
        assert row[1] is not None  # last_fired_at
        assert row[2] is not None
        assert row[2] > datetime.now(timezone.utc)

    # A run_log row landed.
    async with session_scope() as s:
        log_rows = (await s.execute(
            text(
                "SELECT status, trigger_payload FROM automation_run_log "
                "WHERE rule_id = CAST(:r AS uuid)"
            ),
            {"r": rid},
        )).all()
        assert len(log_rows) == 1
        assert log_rows[0][0] == "ok"
        # Payload carries rule_id + scheduled_at, both required by the spec.
        payload = log_rows[0][1]
        if isinstance(payload, str):
            import json
            payload = json.loads(payload)
        assert payload["rule_id"] == rid
        assert "scheduled_at" in payload


@pytest.mark.asyncio
async def test_tick_skips_disabled_cron_rule() -> None:
    async with await _client() as ac:
        r = await ac.post(
            "/api/v1/automation/rules",
            json={
                "name": "off",
                "trigger_kind": "cron",
                "cron_expression": "*/15 * * * *",
                "action_kind": "notification_blast",
                "action_payload": {},
                "enabled": False,
            },
        )
        assert r.status_code == 201
        rid = r.json()["data"]["id"]
    await _force_due(rid)
    fired = await automation_cron.tick_once()
    assert fired == 0


@pytest.mark.asyncio
async def test_tick_disables_rule_with_poison_expression() -> None:
    """A bad cron_expression on disk (synthesised here by direct UPDATE,
    since the router refuses to insert one) shouldn't crash the ticker —
    it should disable the rule and log an error row."""
    async with await _client() as ac:
        r = await ac.post(
            "/api/v1/automation/rules",
            json={
                "name": "ok then poison",
                "trigger_kind": "cron",
                "cron_expression": "0 0 * * *",
                "action_kind": "notification_blast",
                "action_payload": {},
            },
        )
        assert r.status_code == 201
        rid = r.json()["data"]["id"]

    # Synthesise a poison expression bypassing the router validator.
    async with session_scope() as s:
        await s.execute(
            text(
                "UPDATE automation_rules "
                "SET cron_expression = 'garbage', "
                "    next_cron_run_at = NOW() - INTERVAL '1 minute' "
                "WHERE id = CAST(:r AS uuid)"
            ),
            {"r": rid},
        )
        await s.commit()

    fired = await automation_cron.tick_once()
    # Poison rule never reaches the dispatcher, so fired == 0.
    assert fired == 0

    async with session_scope() as s:
        enabled = (await s.execute(
            text("SELECT enabled FROM automation_rules WHERE id = CAST(:r AS uuid)"),
            {"r": rid},
        )).scalar_one()
        assert enabled is False
        log = (await s.execute(
            text(
                "SELECT status, error_message FROM automation_run_log "
                "WHERE rule_id = CAST(:r AS uuid) ORDER BY id DESC LIMIT 1"
            ),
            {"r": rid},
        )).first()
        assert log is not None
        assert log[0] == "failed"
        assert "invalid cron_expression" in (log[1] or "")


# ── Cycle 20: cron_timezone ────────────────────────────────────────────


@pytest.mark.asyncio
async def test_cron_rule_persists_timezone() -> None:
    """Creating a cron rule with cron_timezone='Asia/Seoul' stores it and
    schedules next_cron_run_at in UTC."""
    async with await _client() as ac:
        r = await ac.post(
            "/api/v1/automation/rules",
            json={
                "name": "seoul morning",
                "trigger_kind": "cron",
                "cron_expression": "0 9 * * *",
                "cron_timezone": "Asia/Seoul",
                "action_kind": "notification_blast",
                "action_payload": {
                    "kind": "automation_blast",
                    "message_template": "morning",
                },
            },
        )
        assert r.status_code == 201, r.text
        data = r.json()["data"]
        assert data["cron_timezone"] == "Asia/Seoul"
        assert data["next_cron_run_at"] is not None


@pytest.mark.asyncio
async def test_cron_rule_rejects_unknown_timezone() -> None:
    async with await _client() as ac:
        r = await ac.post(
            "/api/v1/automation/rules",
            json={
                "name": "bad tz",
                "trigger_kind": "cron",
                "cron_expression": "0 9 * * *",
                "cron_timezone": "Mars/Olympus",
                "action_kind": "notification_blast",
                "action_payload": {
                    "kind": "automation_blast",
                    "message_template": "x",
                },
            },
        )
        assert r.status_code == 422
