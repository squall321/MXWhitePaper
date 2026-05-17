"""Cycle 18 — workflow_chains CRUD + run engine.

Covers:

  - CRUD round-trip (create -> list -> get -> patch (replace steps) -> delete)
  - Steps XOR validation (rule_id vs action_kind)
  - Run engine happy path (multiple inline steps)
  - Fail strategies: halt, continue, rollback
  - delay_seconds capping
  - trigger_chain action_kind in automation_dispatcher fans out to a chain

Each test wipes its own rows so they don't bleed.
"""
from __future__ import annotations

import json

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.core.db import session_scope
from app.main import app
from app.services import automation_dispatcher, workflow_chain

SEED_SLUG = "month-end-closing"


async def _client() -> AsyncClient:
    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://test")


@pytest.fixture(autouse=True)
async def _wipe():
    async with session_scope() as s:
        await s.execute(text("DELETE FROM workflow_chain_runs"))
        await s.execute(text("DELETE FROM workflow_chain_steps"))
        await s.execute(text("DELETE FROM workflow_chains"))
        await s.execute(text("DELETE FROM automation_run_log"))
        await s.execute(text("DELETE FROM automation_rules"))
        await s.execute(
            text("DELETE FROM notifications WHERE kind = 'automation_blast'")
        )
    yield
    async with session_scope() as s:
        await s.execute(text("DELETE FROM workflow_chain_runs"))
        await s.execute(text("DELETE FROM workflow_chain_steps"))
        await s.execute(text("DELETE FROM workflow_chains"))
        await s.execute(text("DELETE FROM automation_run_log"))
        await s.execute(text("DELETE FROM automation_rules"))
        await s.execute(
            text("DELETE FROM notifications WHERE kind = 'automation_blast'")
        )


async def _doc_id_for_slug(slug: str) -> str:
    async with session_scope() as s:
        row = (await s.execute(
            text("SELECT id FROM documents WHERE slug = :s"), {"s": slug},
        )).first()
        assert row, f"seed doc {slug} missing"
        return str(row[0])


# ── CRUD ────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_create_then_list_then_patch_then_delete() -> None:
    async with await _client() as ac:
        r = await ac.post(
            "/api/v1/workflow-chains",
            json={
                "name": "publish-fanout",
                "description": "공개 시 다단 처리",
                "steps": [
                    {
                        "ordering": 0,
                        "action_kind": "notification_blast",
                        "action_payload": {"message_template": "공개됨"},
                    },
                    {
                        "ordering": 1,
                        "action_kind": "add_tag",
                        "action_payload": {"tag": "fanout-x"},
                        "delay_seconds": 0,
                    },
                ],
            },
        )
        assert r.status_code == 201, r.text
        cid = r.json()["data"]["id"]
        assert len(r.json()["data"]["steps"]) == 2

        r = await ac.get("/api/v1/workflow-chains")
        assert r.status_code == 200
        items = r.json()["data"]["items"]
        assert any(it["id"] == cid and it["step_count"] == 2 for it in items)

        # PATCH replaces the steps array atomically.
        r = await ac.patch(
            f"/api/v1/workflow-chains/{cid}",
            json={
                "name": "renamed",
                "steps": [
                    {
                        "ordering": 0,
                        "action_kind": "notification_blast",
                        "action_payload": {"message_template": "only one now"},
                    },
                ],
            },
        )
        assert r.status_code == 200, r.text
        body = r.json()["data"]
        assert body["name"] == "renamed"
        assert len(body["steps"]) == 1

        r = await ac.delete(f"/api/v1/workflow-chains/{cid}")
        assert r.status_code == 204
        r = await ac.get(f"/api/v1/workflow-chains/{cid}")
        assert r.status_code == 404


@pytest.mark.asyncio
async def test_create_rejects_step_with_both_rule_id_and_action_kind() -> None:
    async with await _client() as ac:
        r = await ac.post(
            "/api/v1/workflow-chains",
            json={
                "name": "x",
                "steps": [
                    {
                        "ordering": 0,
                        "rule_id": "00000000-0000-0000-0000-000000000000",
                        "action_kind": "webhook",
                    },
                ],
            },
        )
        assert r.status_code == 422


@pytest.mark.asyncio
async def test_create_rejects_step_with_neither_rule_id_nor_action_kind() -> None:
    async with await _client() as ac:
        r = await ac.post(
            "/api/v1/workflow-chains",
            json={
                "name": "x",
                "steps": [{"ordering": 0}],
            },
        )
        assert r.status_code == 422


@pytest.mark.asyncio
async def test_create_rejects_unknown_action_kind() -> None:
    async with await _client() as ac:
        r = await ac.post(
            "/api/v1/workflow-chains",
            json={
                "name": "x",
                "steps": [
                    {
                        "ordering": 0,
                        "action_kind": "definitely_not_an_action",
                        "action_payload": {},
                    },
                ],
            },
        )
        assert r.status_code == 422


# ── Run engine ──────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_run_chain_happy_path_inline_steps() -> None:
    """Two inline notification_blast steps → both succeed, run row closes ok."""
    async with await _client() as ac:
        r = await ac.post(
            "/api/v1/workflow-chains",
            json={
                "name": "happy",
                "steps": [
                    {
                        "ordering": 0,
                        "action_kind": "notification_blast",
                        "action_payload": {"message_template": "step 1"},
                    },
                    {
                        "ordering": 1,
                        "action_kind": "notification_blast",
                        "action_payload": {"message_template": "step 2"},
                    },
                ],
            },
        )
        cid = r.json()["data"]["id"]
        r = await ac.post(f"/api/v1/workflow-chains/{cid}/run-now", json={})
        assert r.status_code == 200, r.text
        body = r.json()["data"]
        assert body["status"] == "ok"
        assert body["steps_completed"] == 2
        assert body["steps_failed"] == 0

        r = await ac.get(f"/api/v1/workflow-chains/{cid}/runs")
        items = r.json()["data"]["items"]
        assert len(items) == 1
        assert items[0]["status"] == "ok"
        assert items[0]["steps_completed"] == 2


@pytest.mark.asyncio
async def test_fail_strategy_halt_stops_chain() -> None:
    """Step 1 fails (missing required payload key) with strategy=halt → step 2 never runs."""
    async with await _client() as ac:
        r = await ac.post(
            "/api/v1/workflow-chains",
            json={
                "name": "halt-chain",
                "steps": [
                    {
                        "ordering": 0,
                        # add_tag without document_id in payload → 'skipped'.
                        # We treat skipped as non-progressing failure for halt.
                        "action_kind": "webhook",
                        "action_payload": {},  # missing url → returns 'skipped'
                        "fail_strategy": "halt",
                    },
                    {
                        "ordering": 1,
                        "action_kind": "notification_blast",
                        "action_payload": {"message_template": "should not run"},
                    },
                ],
            },
        )
        cid = r.json()["data"]["id"]
        r = await ac.post(f"/api/v1/workflow-chains/{cid}/run-now", json={})
        body = r.json()["data"]
        assert body["status"] == "failed"
        assert body["steps_completed"] == 0
        assert body["steps_failed"] == 1


@pytest.mark.asyncio
async def test_fail_strategy_continue_runs_remaining_steps() -> None:
    """First step fails with continue → second step still runs to completion."""
    async with await _client() as ac:
        r = await ac.post(
            "/api/v1/workflow-chains",
            json={
                "name": "continue-chain",
                "steps": [
                    {
                        "ordering": 0,
                        "action_kind": "webhook",
                        "action_payload": {},  # skipped
                        "fail_strategy": "continue",
                    },
                    {
                        "ordering": 1,
                        "action_kind": "notification_blast",
                        "action_payload": {"message_template": "still ran"},
                        "fail_strategy": "continue",
                    },
                ],
            },
        )
        cid = r.json()["data"]["id"]
        r = await ac.post(f"/api/v1/workflow-chains/{cid}/run-now", json={})
        body = r.json()["data"]
        # Final status reflects there were failures.
        assert body["status"] == "failed"
        assert body["steps_completed"] == 1
        assert body["steps_failed"] == 1


@pytest.mark.asyncio
async def test_fail_strategy_rollback_undoes_add_tag() -> None:
    """Step 1: add_tag (succeeds). Step 2: webhook (fails, strategy=rollback).
    The rollback should remove the tag added by step 1."""
    doc_id = await _doc_id_for_slug(SEED_SLUG)
    async with await _client() as ac:
        r = await ac.post(
            "/api/v1/workflow-chains",
            json={
                "name": "rollback-chain",
                "steps": [
                    {
                        "ordering": 0,
                        "action_kind": "add_tag",
                        "action_payload": {"tag": "rollback-marker"},
                        "fail_strategy": "rollback",
                    },
                    {
                        "ordering": 1,
                        "action_kind": "webhook",
                        "action_payload": {},  # skipped → triggers rollback
                        "fail_strategy": "rollback",
                    },
                ],
            },
        )
        cid = r.json()["data"]["id"]
        r = await ac.post(
            f"/api/v1/workflow-chains/{cid}/run-now",
            json={"trigger_payload": {"document_id": doc_id, "slug": SEED_SLUG}},
        )
        body = r.json()["data"]
        assert body["status"] == "rolled_back"
        assert body["steps_completed"] == 1
        assert body["steps_failed"] == 1

    # Verify tag was rolled back.
    async with session_scope() as s:
        row = (await s.execute(
            text("SELECT content_json FROM documents WHERE id = CAST(:d AS uuid)"),
            {"d": doc_id},
        )).first()
        assert row is not None  # seed document
        c = row[0] if isinstance(row[0], dict) else json.loads(row[0])
        tags = (c.get("metadata") or {}).get("tags") or []
        assert "rollback-marker" not in tags


# ── Delay capping ───────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_delay_seconds_capped_at_300() -> None:
    """A step requesting a 9999s delay should be clamped to ≤300s.

    We swap in a fake sleep that records its argument so the test runs
    instantly and we can assert the cap is honored.
    """
    captured: list[float] = []

    async def fake_sleep(seconds: float) -> None:
        captured.append(float(seconds))

    async with await _client() as ac:
        r = await ac.post(
            "/api/v1/workflow-chains",
            json={
                "name": "delay-capped",
                "steps": [
                    {
                        "ordering": 0,
                        "action_kind": "notification_blast",
                        "action_payload": {"message_template": "after delay"},
                        "delay_seconds": 9999,
                    },
                ],
            },
        )
        cid = r.json()["data"]["id"]

    result = await workflow_chain.run_chain(cid, {}, sleep=fake_sleep)
    assert result["status"] == "ok"
    assert captured == [workflow_chain.DELAY_CAP_SECONDS]


# ── trigger_chain action ────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_trigger_chain_action_in_automation_dispatcher() -> None:
    """A rule with action_kind='trigger_chain' fires its target chain."""
    async with await _client() as ac:
        # Create a chain with one harmless step.
        r = await ac.post(
            "/api/v1/workflow-chains",
            json={
                "name": "fan-target",
                "steps": [
                    {
                        "ordering": 0,
                        "action_kind": "notification_blast",
                        "action_payload": {"message_template": "from chain"},
                    },
                ],
            },
        )
        cid = r.json()["data"]["id"]

        # Create a rule that fires the chain on doc_published.
        r = await ac.post(
            "/api/v1/automation/rules",
            json={
                "name": "fan-out rule",
                "trigger_kind": "doc_published",
                "action_kind": "trigger_chain",
                "action_payload": {"chain_id": cid},
            },
        )
        assert r.status_code == 201, r.text
        rid = r.json()["data"]["id"]

    # The rule fires; the chain task is scheduled and the run-log row
    # for the rule is written promptly.
    fired = await automation_dispatcher.dispatch_event(
        "doc_published", {"document_id": "x", "slug": "y"},
    )
    assert fired == 1

    async with await _client() as ac:
        r = await ac.get(f"/api/v1/automation/rules/{rid}/runs")
        items = r.json()["data"]["items"]
        assert len(items) == 1
        assert items[0]["status"] == "ok"


@pytest.mark.asyncio
async def test_run_now_disabled_chain_returns_failed() -> None:
    async with await _client() as ac:
        r = await ac.post(
            "/api/v1/workflow-chains",
            json={
                "name": "off",
                "enabled": False,
                "steps": [
                    {
                        "ordering": 0,
                        "action_kind": "notification_blast",
                        "action_payload": {"message_template": "n/a"},
                    },
                ],
            },
        )
        cid = r.json()["data"]["id"]
        r = await ac.post(f"/api/v1/workflow-chains/{cid}/run-now", json={})
        body = r.json()["data"]
        assert body["status"] == "failed"
        assert body["error_message"] == "chain disabled"
