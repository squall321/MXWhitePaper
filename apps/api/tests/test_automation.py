"""Cycle 0025 — automation rules CRUD + dispatcher per-action happy paths.

The test suite uses the dev-fallback admin (no Authorization header in the
test client → first admin user). Each test wipes `automation_rules` so they
don't bleed.

We don't actually post to external webhook URLs — `webhook_dispatcher`'s
client factory is replaced with a stub that records the calls.
"""
from __future__ import annotations

import json
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.core.db import session_scope
from app.main import app
from app.services import automation_dispatcher, webhook_dispatcher

SEED_SLUG = "month-end-closing"


async def _client() -> AsyncClient:
    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://test")


# ── Stub httpx for the `webhook` action ──────────────────────────────────


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
        await s.execute(
            text("DELETE FROM notifications WHERE kind = 'automation_blast'")
        )
    webhook_dispatcher.reset_client_factory()
    yield
    async with session_scope() as s:
        await s.execute(text("DELETE FROM automation_run_log"))
        await s.execute(text("DELETE FROM automation_rules"))
        await s.execute(
            text("DELETE FROM notifications WHERE kind = 'automation_blast'")
        )
    webhook_dispatcher.reset_client_factory()


async def _doc_id_for_slug(slug: str) -> str:
    async with session_scope() as s:
        row = (await s.execute(
            text("SELECT id FROM documents WHERE slug = :s"), {"s": slug},
        )).first()
        assert row, f"seed doc {slug} missing"
        return str(row[0])


# ── filter_matches unit ──────────────────────────────────────────────────


def test_filter_matches_empty_filter_matches_anything() -> None:
    assert automation_dispatcher.filter_matches({}, {"foo": 1}) is True


def test_filter_matches_equality() -> None:
    assert automation_dispatcher.filter_matches({"k": "v"}, {"k": "v"}) is True
    assert automation_dispatcher.filter_matches({"k": "v"}, {"k": "x"}) is False
    assert automation_dispatcher.filter_matches({"k": "v"}, {}) is False


def test_filter_matches_list_value_acts_as_in() -> None:
    f = {"status": ["approved", "rejected"]}
    assert automation_dispatcher.filter_matches(f, {"status": "approved"}) is True
    assert automation_dispatcher.filter_matches(f, {"status": "draft"}) is False


# ── CRUD ────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_create_then_list_then_patch_then_delete() -> None:
    async with await _client() as ac:
        r = await ac.post(
            "/api/v1/automation/rules",
            json={
                "name": "publish → slack",
                "trigger_kind": "doc_published",
                "trigger_filter": {},
                "action_kind": "webhook",
                "action_payload": {
                    "url": "https://hooks.example.com/slack",
                    "secret": "s3cret",
                },
            },
        )
        assert r.status_code == 201, r.text
        rid = r.json()["data"]["id"]
        assert r.json()["data"]["fire_count"] == 0

        r = await ac.get("/api/v1/automation/rules")
        assert r.status_code == 200
        assert any(it["id"] == rid for it in r.json()["data"]["items"])

        r = await ac.patch(
            f"/api/v1/automation/rules/{rid}",
            json={"enabled": False, "name": "new name"},
        )
        assert r.status_code == 200
        assert r.json()["data"]["enabled"] is False
        assert r.json()["data"]["name"] == "new name"

        r = await ac.delete(f"/api/v1/automation/rules/{rid}")
        assert r.status_code == 204
        r = await ac.get(f"/api/v1/automation/rules/{rid}")
        assert r.status_code == 404


@pytest.mark.asyncio
async def test_create_rejects_unknown_trigger() -> None:
    async with await _client() as ac:
        r = await ac.post(
            "/api/v1/automation/rules",
            json={
                "name": "x",
                "trigger_kind": "definitely_not_a_trigger",
                "action_kind": "webhook",
                "action_payload": {"url": "https://x"},
            },
        )
        assert r.status_code == 422


@pytest.mark.asyncio
async def test_create_rejects_unknown_action() -> None:
    async with await _client() as ac:
        r = await ac.post(
            "/api/v1/automation/rules",
            json={
                "name": "x",
                "trigger_kind": "doc_published",
                "action_kind": "definitely_not_an_action",
                "action_payload": {},
            },
        )
        assert r.status_code == 422


# ── Dispatch happy paths ────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_dispatch_filter_match_and_skip() -> None:
    """Two rules — one matches the filter, one doesn't. Only the matching
    rule fires."""
    async with await _client() as ac:
        r_match = await ac.post(
            "/api/v1/automation/rules",
            json={
                "name": "tagged-A",
                "trigger_kind": "tag_added",
                "trigger_filter": {"tag": "A"},
                "action_kind": "notification_blast",
                "action_payload": {"kind": "automation_blast", "message_template": "A!"},
            },
        )
        rid_match = r_match.json()["data"]["id"]
        r_skip = await ac.post(
            "/api/v1/automation/rules",
            json={
                "name": "tagged-B",
                "trigger_kind": "tag_added",
                "trigger_filter": {"tag": "B"},
                "action_kind": "notification_blast",
                "action_payload": {"kind": "automation_blast", "message_template": "B!"},
            },
        )
        rid_skip = r_skip.json()["data"]["id"]

    fired = await automation_dispatcher.dispatch_event(
        "tag_added", {"tag": "A", "document_id": "x", "slug": "x"},
    )
    assert fired == 1

    async with await _client() as ac:
        r = await ac.get(f"/api/v1/automation/rules/{rid_match}/runs")
        assert r.status_code == 200
        assert len(r.json()["data"]["items"]) == 1
        assert r.json()["data"]["items"][0]["status"] == "ok"

        r = await ac.get(f"/api/v1/automation/rules/{rid_skip}/runs")
        assert len(r.json()["data"]["items"]) == 0

        # Counters bumped only on the firing rule.
        r = await ac.get(f"/api/v1/automation/rules/{rid_match}")
        assert r.json()["data"]["fire_count"] == 1
        assert r.json()["data"]["last_fired_at"] is not None
        r = await ac.get(f"/api/v1/automation/rules/{rid_skip}")
        assert r.json()["data"]["fire_count"] == 0


@pytest.mark.asyncio
async def test_action_webhook_uses_dispatcher() -> None:
    factory = _FakeFactory()
    webhook_dispatcher.set_client_factory(factory)
    async with await _client() as ac:
        r = await ac.post(
            "/api/v1/automation/rules",
            json={
                "name": "publish -> slack",
                "trigger_kind": "doc_published",
                "action_kind": "webhook",
                "action_payload": {
                    "url": "https://hooks.example.com/wh",
                    "secret": "topsecret",
                },
            },
        )
        rid = r.json()["data"]["id"]

    fired = await automation_dispatcher.dispatch_event(
        "doc_published", {"document_id": "abc", "slug": "z"},
    )
    assert fired == 1
    assert len(factory.calls) >= 1
    assert factory.calls[0]["url"] == "https://hooks.example.com/wh"
    payload = json.loads(factory.calls[0]["body"].decode("utf-8"))
    assert payload.get("event") == "doc_published"

    async with await _client() as ac:
        r = await ac.get(f"/api/v1/automation/rules/{rid}/runs")
        assert r.json()["data"]["items"][0]["status"] == "ok"


@pytest.mark.asyncio
async def test_action_notification_blast_inserts_per_user() -> None:
    async with await _client() as ac:
        r = await ac.post(
            "/api/v1/automation/rules",
            json={
                "name": "blast",
                "trigger_kind": "doc_archived",
                "action_kind": "notification_blast",
                "action_payload": {"kind": "automation_blast", "message_template": "보관됨"},
            },
        )
        r.json()["data"]["id"]

    await automation_dispatcher.dispatch_event(
        "doc_archived", {"document_id": "x", "slug": "y"},
    )

    async with session_scope() as s:
        cnt = (await s.execute(
            text(
                "SELECT COUNT(*) FROM notifications WHERE kind = 'automation_blast'"
            ),
        )).scalar_one()
        assert cnt > 0
        # And every active user got exactly one row.
        per_user = (await s.execute(
            text(
                """
                SELECT user_id, COUNT(*) FROM notifications
                WHERE kind = 'automation_blast'
                GROUP BY user_id
                """
            ),
        )).all()
        assert all(c == 1 for _, c in per_user)


@pytest.mark.asyncio
async def test_action_add_tag_mutates_doc_metadata() -> None:
    doc_id = await _doc_id_for_slug(SEED_SLUG)

    async with await _client() as ac:
        r = await ac.post(
            "/api/v1/automation/rules",
            json={
                "name": "add tag",
                "trigger_kind": "doc_published",
                "action_kind": "add_tag",
                "action_payload": {"tag": "auto-published"},
            },
        )
        assert r.status_code == 201
        rid = r.json()["data"]["id"]

    fired = await automation_dispatcher.dispatch_event(
        "doc_published", {"document_id": doc_id, "slug": SEED_SLUG},
    )
    assert fired == 1

    async with session_scope() as s:
        row = (await s.execute(
            text("SELECT content_json FROM documents WHERE id = CAST(:d AS uuid)"),
            {"d": doc_id},
        )).first()
        assert row is not None  # seed document
        content = row[0] if isinstance(row[0], dict) else json.loads(row[0])
        assert "auto-published" in (content.get("metadata") or {}).get("tags", [])

    async with await _client() as ac:
        r = await ac.get(f"/api/v1/automation/rules/{rid}/runs")
        assert r.json()["data"]["items"][0]["status"] == "ok"

    # Cleanup — strip the tag we wrote so other tests aren't surprised.
    async with session_scope() as s:
        row = (await s.execute(
            text("SELECT content_json FROM documents WHERE id = CAST(:d AS uuid)"),
            {"d": doc_id},
        )).first()
        assert row is not None  # seed document
        c = row[0] if isinstance(row[0], dict) else json.loads(row[0])
        m = c.get("metadata") or {}
        m["tags"] = [t for t in (m.get("tags") or []) if t != "auto-published"]
        c["metadata"] = m
        await s.execute(
            text("UPDATE documents SET content_json = CAST(:c AS jsonb) WHERE id = CAST(:d AS uuid)"),
            {"c": json.dumps(c), "d": doc_id},
        )


@pytest.mark.asyncio
async def test_action_remove_tag_idempotent_when_absent() -> None:
    doc_id = await _doc_id_for_slug(SEED_SLUG)
    async with await _client() as ac:
        r = await ac.post(
            "/api/v1/automation/rules",
            json={
                "name": "rm tag",
                "trigger_kind": "doc_published",
                "action_kind": "remove_tag",
                "action_payload": {"tag": "definitely-not-on-this-doc"},
            },
        )
        rid = r.json()["data"]["id"]
    await automation_dispatcher.dispatch_event(
        "doc_published", {"document_id": doc_id, "slug": SEED_SLUG},
    )
    async with await _client() as ac:
        r = await ac.get(f"/api/v1/automation/rules/{rid}/runs")
        # Skipped — tag wasn't there to remove.
        assert r.json()["data"]["items"][0]["status"] == "skipped"


@pytest.mark.asyncio
async def test_action_transition_flips_status() -> None:
    doc_id = await _doc_id_for_slug(SEED_SLUG)

    # Snapshot original status so we can restore.
    async with session_scope() as s:
        original = (await s.execute(
            text("SELECT status FROM documents WHERE id = CAST(:d AS uuid)"),
            {"d": doc_id},
        )).scalar_one()

    async with await _client() as ac:
        r = await ac.post(
            "/api/v1/automation/rules",
            json={
                "name": "to archived",
                "trigger_kind": "doc_archived",
                "action_kind": "transition",
                "action_payload": {"status": "archived"},
            },
        )
        r.json()["data"]["id"]

    await automation_dispatcher.dispatch_event(
        "doc_archived", {"document_id": doc_id, "slug": SEED_SLUG},
    )

    async with session_scope() as s:
        new_status = (await s.execute(
            text("SELECT status FROM documents WHERE id = CAST(:d AS uuid)"),
            {"d": doc_id},
        )).scalar_one()
        assert new_status == "archived"
        # Restore.
        await s.execute(
            text("UPDATE documents SET status = :s WHERE id = CAST(:d AS uuid)"),
            {"s": original, "d": doc_id},
        )


@pytest.mark.asyncio
async def test_test_endpoint_dry_run_does_not_persist() -> None:
    async with await _client() as ac:
        r = await ac.post(
            "/api/v1/automation/rules",
            json={
                "name": "dry-test",
                "trigger_kind": "doc_published",
                "action_kind": "notification_blast",
                "action_payload": {"kind": "automation_blast", "message_template": "x"},
            },
        )
        rid = r.json()["data"]["id"]

        r = await ac.post(
            f"/api/v1/automation/rules/{rid}/test",
            json={"dry_run": True, "payload": {"document_id": "x", "slug": "y"}},
        )
        assert r.status_code == 200
        assert r.json()["data"]["dry_run"] is True

        r = await ac.get(f"/api/v1/automation/rules/{rid}/runs")
        # Dry run did not persist a row.
        assert len(r.json()["data"]["items"]) == 0
        r = await ac.get(f"/api/v1/automation/rules/{rid}")
        assert r.json()["data"]["fire_count"] == 0


@pytest.mark.asyncio
async def test_disabled_rule_does_not_fire() -> None:
    async with await _client() as ac:
        r = await ac.post(
            "/api/v1/automation/rules",
            json={
                "name": "off",
                "trigger_kind": "doc_published",
                "action_kind": "notification_blast",
                "action_payload": {"kind": "automation_blast", "message_template": "x"},
                "enabled": False,
            },
        )
        rid = r.json()["data"]["id"]

    fired = await automation_dispatcher.dispatch_event(
        "doc_published", {"document_id": "x", "slug": "y"},
    )
    assert fired == 0
    async with await _client() as ac:
        r = await ac.get(f"/api/v1/automation/rules/{rid}/runs")
        assert len(r.json()["data"]["items"]) == 0
