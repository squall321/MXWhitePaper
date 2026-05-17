"""Cycle 0032 — audit log retention config + prune + ticker.

Same conventions as `test_retention.py` — dev-fallback admin (no
Authorization header → first admin user). Each test resets the singleton
config row and removes test-injected `audit_logs` rows.
"""
from __future__ import annotations

import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.core.db import session_scope
from app.main import app
from app.services import audit_pruner

# ── Fixtures + helpers ───────────────────────────────────────────────────


async def _client() -> AsyncClient:
    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://test")


@pytest.fixture(autouse=True)
async def _reset():
    """Restore the canonical config singleton + clear test-tagged audit rows."""
    async with session_scope() as s:
        # Wipe rows we tagged with the test marker.
        await s.execute(
            text(
                "DELETE FROM audit_logs WHERE action LIKE 'audit_retention.%' "
                "OR action = 'test.audit_retention'"
            )
        )
        # Materialise/restore singleton row to defaults.
        await s.execute(
            text(
                "INSERT INTO audit_retention_config (id, retain_days, enabled, "
                "rows_pruned_total) VALUES (1, 365, TRUE, 0) "
                "ON CONFLICT (id) DO UPDATE "
                "SET retain_days = 365, enabled = TRUE, "
                "    last_run_at = NULL, rows_pruned_total = 0"
            )
        )
        await s.commit()
    yield
    async with session_scope() as s:
        await s.execute(
            text(
                "DELETE FROM audit_logs WHERE action LIKE 'audit_retention.%' "
                "OR action = 'test.audit_retention'"
            )
        )
        await s.execute(
            text(
                "UPDATE audit_retention_config SET retain_days = 365, "
                "enabled = TRUE, last_run_at = NULL, rows_pruned_total = 0 "
                "WHERE id = 1"
            )
        )
        await s.commit()


async def _insert_old_audit(*, age_days: int) -> str:
    """Insert a fresh audit_logs row whose created_at is `age_days` old."""
    target = f"test:{uuid.uuid4().hex[:8]}"
    async with session_scope() as s:
        await s.execute(
            text(
                """
                INSERT INTO audit_logs (action, target, payload, created_at)
                VALUES ('test.audit_retention', :tg, '{}'::jsonb,
                        NOW() - (CAST(:days AS text) || ' days')::interval)
                """
            ),
            {"tg": target, "days": str(age_days)},
        )
        await s.commit()
    return target


async def _audit_count_with_target(target: str) -> int:
    async with session_scope() as s:
        row = (await s.execute(
            text("SELECT COUNT(*) FROM audit_logs WHERE target = :t"),
            {"t": target},
        )).first()
        return int(row[0]) if row else 0


# ── GET ──────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_returns_seeded_defaults() -> None:
    async with await _client() as ac:
        r = await ac.get("/api/v1/admin/audit-retention")
        assert r.status_code == 200, r.text
        d = r.json()["data"]
        assert d["retain_days"] == 365
        assert d["enabled"] is True
        assert d["rows_pruned_total"] == 0
        # audit_log_total is non-negative.
        assert isinstance(d["audit_log_total"], int)
        assert d["audit_log_total"] >= 0


# ── PATCH ────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_patch_retain_days_and_enabled() -> None:
    async with await _client() as ac:
        r = await ac.patch(
            "/api/v1/admin/audit-retention",
            json={"retain_days": 90, "enabled": False},
        )
        assert r.status_code == 200, r.text
        d = r.json()["data"]
        assert d["retain_days"] == 90
        assert d["enabled"] is False

        # Roundtrip: GET sees the new values.
        r = await ac.get("/api/v1/admin/audit-retention")
        d = r.json()["data"]
        assert d["retain_days"] == 90
        assert d["enabled"] is False


@pytest.mark.asyncio
async def test_patch_rejects_zero_retain_days() -> None:
    async with await _client() as ac:
        r = await ac.patch(
            "/api/v1/admin/audit-retention", json={"retain_days": 0},
        )
        assert r.status_code == 422


@pytest.mark.asyncio
async def test_patch_empty_body_is_validation_error() -> None:
    async with await _client() as ac:
        r = await ac.patch("/api/v1/admin/audit-retention", json={})
        # Our errors module raises ValidationFailed which surfaces as 422.
        assert r.status_code in (400, 422)


# ── prune-now ────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_prune_now_deletes_old_rows() -> None:
    old_target = await _insert_old_audit(age_days=400)
    new_target = await _insert_old_audit(age_days=10)
    try:
        async with await _client() as ac:
            # Default retain_days is 365 → 400d row matches, 10d does not.
            r = await ac.post("/api/v1/admin/audit-retention/prune-now")
            assert r.status_code == 200, r.text
            assert r.json()["data"]["rows_pruned"] >= 1

        assert await _audit_count_with_target(old_target) == 0
        assert await _audit_count_with_target(new_target) == 1

        # Stats advanced.
        async with await _client() as ac:
            r = await ac.get("/api/v1/admin/audit-retention")
            d = r.json()["data"]
            assert d["last_run_at"] is not None
            assert d["rows_pruned_total"] >= 1
    finally:
        async with session_scope() as s:
            await s.execute(
                text("DELETE FROM audit_logs WHERE target = :t"),
                {"t": new_target},
            )
            await s.commit()


@pytest.mark.asyncio
async def test_prune_now_force_runs_when_disabled() -> None:
    """Admin run-now must work even when enabled=false."""
    old_target = await _insert_old_audit(age_days=400)
    try:
        async with await _client() as ac:
            r = await ac.patch(
                "/api/v1/admin/audit-retention", json={"enabled": False},
            )
            assert r.status_code == 200

            r = await ac.post("/api/v1/admin/audit-retention/prune-now")
            assert r.status_code == 200
            assert r.json()["data"]["rows_pruned"] >= 1
        assert await _audit_count_with_target(old_target) == 0
    finally:
        pass  # row already pruned


# ── ticker / tick_once ───────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_tick_once_prunes_when_enabled() -> None:
    old_target = await _insert_old_audit(age_days=500)
    try:
        deleted = await audit_pruner.tick_once()
        assert deleted >= 1
        assert await _audit_count_with_target(old_target) == 0
    finally:
        async with session_scope() as s:
            await s.execute(
                text("DELETE FROM audit_logs WHERE target = :t"),
                {"t": old_target},
            )
            await s.commit()


@pytest.mark.asyncio
async def test_tick_once_skips_when_disabled() -> None:
    old_target = await _insert_old_audit(age_days=500)
    try:
        async with session_scope() as s:
            await s.execute(
                text(
                    "UPDATE audit_retention_config SET enabled = FALSE "
                    "WHERE id = 1"
                )
            )
            await s.commit()

        deleted = await audit_pruner.tick_once()
        assert deleted == 0
        assert await _audit_count_with_target(old_target) == 1
    finally:
        async with session_scope() as s:
            await s.execute(
                text("DELETE FROM audit_logs WHERE target = :t"),
                {"t": old_target},
            )
            await s.commit()


@pytest.mark.asyncio
async def test_tick_once_respects_custom_retain_days() -> None:
    """A 60-day retention must prune a 90d row but spare a 30d row."""
    old_target = await _insert_old_audit(age_days=90)
    young_target = await _insert_old_audit(age_days=30)
    try:
        async with session_scope() as s:
            await s.execute(
                text(
                    "UPDATE audit_retention_config SET retain_days = 60 "
                    "WHERE id = 1"
                )
            )
            await s.commit()

        deleted = await audit_pruner.tick_once()
        assert deleted >= 1
        assert await _audit_count_with_target(old_target) == 0
        assert await _audit_count_with_target(young_target) == 1
    finally:
        async with session_scope() as s:
            await s.execute(
                text("DELETE FROM audit_logs WHERE target = :t"),
                {"t": young_target},
            )
            await s.commit()


@pytest.mark.asyncio
async def test_tick_once_disabled_via_settings_returns_zero(monkeypatch) -> None:
    """`settings.audit_retention_enabled = False` makes tick a no-op."""
    from app.core import config as cfg_mod

    cfg_mod.get_settings.cache_clear()
    monkeypatch.setenv("AUDIT_RETENTION_ENABLED", "false")
    try:
        old_target = await _insert_old_audit(age_days=500)
        try:
            deleted = await audit_pruner.tick_once()
            assert deleted == 0
            assert await _audit_count_with_target(old_target) == 1
        finally:
            async with session_scope() as s:
                await s.execute(
                    text("DELETE FROM audit_logs WHERE target = :t"),
                    {"t": old_target},
                )
                await s.commit()
    finally:
        cfg_mod.get_settings.cache_clear()
