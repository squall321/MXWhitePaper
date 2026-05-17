"""Cycle 0027 — retention policies CRUD + dry-run + run + ticker happy paths.

Same conventions as `test_automation.py` — dev-fallback admin (no
Authorization header → first admin user), each test wipes
`retention_policies`/`retention_runs` so they don't bleed.

Stale docs are seeded by INSERT-ing a fresh `documents` row with
``updated_at`` and ``created_at`` shifted into the past, then deleted on
teardown.
"""
from __future__ import annotations

import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.core.db import session_scope
from app.main import app
from app.services import retention_runner

# ── Fixtures + helpers ───────────────────────────────────────────────────


async def _client() -> AsyncClient:
    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://test")


@pytest.fixture(autouse=True)
async def _wipe():
    async with session_scope() as s:
        await s.execute(text("DELETE FROM retention_runs"))
        await s.execute(text("DELETE FROM retention_policies"))
        await s.execute(
            text("DELETE FROM notifications WHERE kind = 'retention_warning'")
        )
    yield
    async with session_scope() as s:
        await s.execute(text("DELETE FROM retention_runs"))
        await s.execute(text("DELETE FROM retention_policies"))
        await s.execute(
            text("DELETE FROM notifications WHERE kind = 'retention_warning'")
        )


async def _admin_owner_id() -> str:
    async with session_scope() as s:
        row = (await s.execute(
            text(
                "SELECT id FROM users WHERE role = 'admin' AND is_active = TRUE "
                "ORDER BY created_at LIMIT 1"
            )
        )).first()
        assert row is not None
        return str(row[0])


async def _make_stale_doc(*, age_days: int = 90, status: str = "draft") -> str:
    """Insert a fresh doc whose updated_at is `age_days` old. Returns slug."""
    slug = f"retention-test-{uuid.uuid4().hex[:8]}"
    owner_id = await _admin_owner_id()
    async with session_scope() as s:
        await s.execute(
            text(
                """
                INSERT INTO documents (slug, title, summary, content_json,
                                       owner_id, schema_ver, version, status,
                                       created_at, updated_at)
                VALUES (:slug, :title, '', '{}'::jsonb, CAST(:owner AS uuid),
                        '1.0.0', 1, :status,
                        NOW() - (CAST(:days AS text) || ' days')::interval,
                        NOW() - (CAST(:days AS text) || ' days')::interval)
                """
            ),
            {
                "slug": slug,
                "title": f"retention test {slug}",
                "owner": owner_id,
                "status": status,
                "days": str(age_days),
            },
        )
        await s.commit()
    return slug


async def _drop_doc(slug: str) -> None:
    async with session_scope() as s:
        await s.execute(
            text("DELETE FROM documents WHERE slug = :s"),
            {"s": slug},
        )
        await s.commit()


async def _doc_status(slug: str) -> str:
    async with session_scope() as s:
        row = (await s.execute(
            text("SELECT status FROM documents WHERE slug = :s"),
            {"s": slug},
        )).first()
        assert row is not None
        return row[0]


# ── CRUD ─────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_create_then_list_then_patch_then_delete() -> None:
    async with await _client() as ac:
        r = await ac.post(
            "/api/v1/admin/retention-policies",
            json={
                "name": "stale draft archiver",
                "scope_filter": {"status": "draft"},
                "action": "archive",
                "action_payload": {},
                "trigger_age_days": 60,
                "trigger_field": "updated_at",
            },
        )
        assert r.status_code == 201, r.text
        pid = r.json()["data"]["id"]
        assert r.json()["data"]["enabled"] is True
        assert r.json()["data"]["trigger_age_days"] == 60

        r = await ac.get("/api/v1/admin/retention-policies")
        assert r.status_code == 200
        items = r.json()["data"]["items"]
        assert any(p["id"] == pid for p in items)
        # run_count is included on the list payload.
        assert all("run_count" in p for p in items)

        r = await ac.patch(
            f"/api/v1/admin/retention-policies/{pid}",
            json={"enabled": False, "trigger_age_days": 90},
        )
        assert r.status_code == 200
        assert r.json()["data"]["enabled"] is False
        assert r.json()["data"]["trigger_age_days"] == 90

        r = await ac.delete(f"/api/v1/admin/retention-policies/{pid}")
        assert r.status_code == 204
        r = await ac.get(f"/api/v1/admin/retention-policies/{pid}")
        assert r.status_code == 404


@pytest.mark.asyncio
async def test_create_rejects_unknown_action() -> None:
    async with await _client() as ac:
        r = await ac.post(
            "/api/v1/admin/retention-policies",
            json={
                "name": "x",
                "action": "definitely_not_an_action",
                "trigger_age_days": 30,
                "trigger_field": "updated_at",
            },
        )
        assert r.status_code == 422


@pytest.mark.asyncio
async def test_create_rejects_unknown_trigger_field() -> None:
    async with await _client() as ac:
        r = await ac.post(
            "/api/v1/admin/retention-policies",
            json={
                "name": "x",
                "action": "archive",
                "trigger_age_days": 30,
                "trigger_field": "definitely_not_a_field",
            },
        )
        assert r.status_code == 422


@pytest.mark.asyncio
async def test_create_rejects_zero_age() -> None:
    async with await _client() as ac:
        r = await ac.post(
            "/api/v1/admin/retention-policies",
            json={
                "name": "x",
                "action": "archive",
                "trigger_age_days": 0,
                "trigger_field": "updated_at",
            },
        )
        assert r.status_code == 422


# ── Dry-run + run ────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_dry_run_lists_matches_without_changing_status() -> None:
    slug = await _make_stale_doc(age_days=120, status="draft")
    try:
        async with await _client() as ac:
            r = await ac.post(
                "/api/v1/admin/retention-policies",
                json={
                    "name": "dry-test",
                    "scope_filter": {"status": "draft"},
                    "action": "archive",
                    "trigger_age_days": 30,
                    "trigger_field": "updated_at",
                },
            )
            pid = r.json()["data"]["id"]

            r = await ac.post(
                f"/api/v1/admin/retention-policies/{pid}/dry-run"
            )
            assert r.status_code == 200, r.text
            assert r.json()["data"]["status"] == "dry_run"
            assert slug in r.json()["data"]["doc_slugs"]

        # Doc must remain untouched.
        assert await _doc_status(slug) == "draft"
    finally:
        await _drop_doc(slug)


@pytest.mark.asyncio
async def test_run_archive_action_flips_status() -> None:
    slug = await _make_stale_doc(age_days=120, status="draft")
    try:
        async with await _client() as ac:
            r = await ac.post(
                "/api/v1/admin/retention-policies",
                json={
                    "name": "auto-archive",
                    "scope_filter": {"status": "draft"},
                    "action": "archive",
                    "trigger_age_days": 30,
                    "trigger_field": "updated_at",
                },
            )
            pid = r.json()["data"]["id"]

            r = await ac.post(
                f"/api/v1/admin/retention-policies/{pid}/run"
            )
            assert r.status_code == 200, r.text
            assert r.json()["data"]["status"] == "ok"
            assert r.json()["data"]["affected_doc_count"] >= 1

            # Run row was logged + last_run_at advanced.
            r = await ac.get(f"/api/v1/admin/retention-policies/{pid}/runs")
            assert r.status_code == 200
            runs = r.json()["data"]["items"]
            assert len(runs) == 1
            assert runs[0]["status"] == "ok"
            assert slug in runs[0]["doc_slugs"]
            r = await ac.get(f"/api/v1/admin/retention-policies/{pid}")
            assert r.json()["data"]["last_run_at"] is not None

        assert await _doc_status(slug) == "archived"
    finally:
        await _drop_doc(slug)


@pytest.mark.asyncio
async def test_run_notify_owner_action_inserts_notification() -> None:
    slug = await _make_stale_doc(age_days=120, status="draft")
    try:
        async with await _client() as ac:
            r = await ac.post(
                "/api/v1/admin/retention-policies",
                json={
                    "name": "warn-owner",
                    "scope_filter": {"status": "draft"},
                    "action": "notify_owner",
                    "trigger_age_days": 30,
                    "trigger_field": "updated_at",
                },
            )
            pid = r.json()["data"]["id"]
            r = await ac.post(
                f"/api/v1/admin/retention-policies/{pid}/run"
            )
            assert r.status_code == 200
            assert r.json()["data"]["status"] == "ok"

        # Doc status must NOT have changed.
        assert await _doc_status(slug) == "draft"
        async with session_scope() as s:
            cnt = (await s.execute(
                text(
                    "SELECT COUNT(*) FROM notifications "
                    "WHERE kind = 'retention_warning'"
                ),
            )).scalar_one()
            assert cnt >= 1
    finally:
        await _drop_doc(slug)


@pytest.mark.asyncio
async def test_run_transition_action_uses_target_status() -> None:
    slug = await _make_stale_doc(age_days=120, status="draft")
    try:
        async with await _client() as ac:
            r = await ac.post(
                "/api/v1/admin/retention-policies",
                json={
                    "name": "to-archived",
                    "scope_filter": {"status": "draft"},
                    "action": "transition",
                    "action_payload": {"target_status": "archived"},
                    "trigger_age_days": 30,
                    "trigger_field": "updated_at",
                },
            )
            pid = r.json()["data"]["id"]
            r = await ac.post(
                f"/api/v1/admin/retention-policies/{pid}/run"
            )
            assert r.status_code == 200
            assert r.json()["data"]["status"] == "ok"

        assert await _doc_status(slug) == "archived"
    finally:
        await _drop_doc(slug)


@pytest.mark.asyncio
async def test_run_skips_younger_docs() -> None:
    """A doc only 5 days old must NOT match a 30-day policy."""
    slug = await _make_stale_doc(age_days=5, status="draft")
    try:
        async with await _client() as ac:
            r = await ac.post(
                "/api/v1/admin/retention-policies",
                json={
                    "name": "30d archive",
                    "scope_filter": {"status": "draft"},
                    "action": "archive",
                    "trigger_age_days": 30,
                    "trigger_field": "updated_at",
                },
            )
            pid = r.json()["data"]["id"]
            r = await ac.post(
                f"/api/v1/admin/retention-policies/{pid}/dry-run"
            )
            assert slug not in r.json()["data"]["doc_slugs"]
        assert await _doc_status(slug) == "draft"
    finally:
        await _drop_doc(slug)


# ── Ticker ───────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_ticker_picks_due_policy_and_advances_next_run_at() -> None:
    """`tick_once()` must execute due policies AND advance their schedule."""
    slug = await _make_stale_doc(age_days=120, status="draft")
    try:
        async with await _client() as ac:
            r = await ac.post(
                "/api/v1/admin/retention-policies",
                json={
                    "name": "ticker target",
                    "scope_filter": {"status": "draft"},
                    "action": "archive",
                    "trigger_age_days": 30,
                    "trigger_field": "updated_at",
                },
            )
            pid = r.json()["data"]["id"]

        # next_run_at is NULL for a fresh policy → tick_once() must pick it.
        executed = await retention_runner.tick_once()
        assert executed >= 1

        async with session_scope() as s:
            row = (await s.execute(
                text(
                    "SELECT last_run_at, next_run_at "
                    "FROM retention_policies WHERE id = CAST(:p AS uuid)"
                ),
                {"p": pid},
            )).first()
            assert row is not None
            assert row[0] is not None  # last_run_at set
            assert row[1] is not None  # next_run_at advanced

        assert await _doc_status(slug) == "archived"
    finally:
        await _drop_doc(slug)


@pytest.mark.asyncio
async def test_ticker_skips_disabled_policies() -> None:
    slug = await _make_stale_doc(age_days=120, status="draft")
    try:
        async with await _client() as ac:
            r = await ac.post(
                "/api/v1/admin/retention-policies",
                json={
                    "name": "disabled",
                    "scope_filter": {"status": "draft"},
                    "action": "archive",
                    "trigger_age_days": 30,
                    "trigger_field": "updated_at",
                    "enabled": False,
                },
            )
            r.json()["data"]["id"]

        executed = await retention_runner.tick_once()
        # Other tests' policies are wiped by the autouse fixture, so 0 here.
        assert executed == 0
        assert await _doc_status(slug) == "draft"
    finally:
        await _drop_doc(slug)


# ── find_matching_docs unit  ─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_find_matching_docs_respects_owner_filter() -> None:
    """A scope_filter on owner_id must only match docs owned by that user."""
    slug_match = await _make_stale_doc(age_days=120, status="draft")
    try:
        owner_id = await _admin_owner_id()
        async with session_scope() as s:
            docs = await retention_runner.find_matching_docs(
                s,
                trigger_field="updated_at",
                trigger_age_days=30,
                scope_filter={"owner_id": owner_id, "status": "draft"},
            )
        slugs = [d["slug"] for d in docs]
        assert slug_match in slugs
        # All returned docs are draft + owned by owner_id.
        for d in docs:
            assert d["status"] == "draft"
            assert d["owner_id"] == owner_id
    finally:
        await _drop_doc(slug_match)
