"""Cycle 0015 — backup schedules + runs + tick + run_backup smoke.

Storage and per-doc renderers are mocked so tests don't touch MinIO or
exercise the real export pipelines (those have their own coverage). The
tests focus on:

  - schedules CRUD with admin RBAC
  - cadence math (`compute_next_run`)
  - ticker happy path: pulls due rows, calls `run_backup`, advances `next_run_at`
  - `run_backup` happy path with mocked MinIO upload
  - `/runs` listing + presigned download redirect
"""
from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import patch

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.core.db import session_scope
from app.main import app
from app.services import backup_runner


async def _login_admin(ac: AsyncClient) -> str:
    r = await ac.post(
        "/api/v1/auth/login",
        json={"email": "admin@mx.local", "password": "admin1234!"},
    )
    assert r.status_code == 200, r.text
    return r.json()["data"]["access_token"]


@pytest.fixture(autouse=True)
async def _wipe_backups():
    """Clean tables before AND after each test to keep things deterministic."""
    async with session_scope() as s:
        await s.execute(text("DELETE FROM backup_runs"))
        await s.execute(text("DELETE FROM backup_schedules"))
    yield
    async with session_scope() as s:
        await s.execute(text("DELETE FROM backup_runs"))
        await s.execute(text("DELETE FROM backup_schedules"))


# ── Cadence math ────────────────────────────────────────────────────


def test_compute_next_run_daily() -> None:
    base = datetime(2026, 5, 9, 1, 0, 0, tzinfo=UTC)
    nxt = backup_runner.compute_next_run(cadence="daily", hour_utc=3, after=base)
    assert nxt == datetime(2026, 5, 9, 3, 0, 0, tzinfo=UTC)


def test_compute_next_run_daily_rolls_to_tomorrow() -> None:
    # When `after` is past today's anchor we should jump to tomorrow.
    base = datetime(2026, 5, 9, 5, 0, 0, tzinfo=UTC)
    nxt = backup_runner.compute_next_run(cadence="daily", hour_utc=3, after=base)
    assert nxt == datetime(2026, 5, 10, 3, 0, 0, tzinfo=UTC)


def test_compute_next_run_weekly_and_monthly() -> None:
    base = datetime(2026, 5, 9, 1, 0, 0, tzinfo=UTC)
    weekly = backup_runner.compute_next_run(
        cadence="weekly", hour_utc=3, after=base
    )
    assert weekly - base >= timedelta(days=6)
    monthly = backup_runner.compute_next_run(
        cadence="monthly", hour_utc=3, after=base
    )
    assert monthly - base >= timedelta(days=29)


# ── Schedules CRUD ──────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_create_and_list_full_schedule_as_admin() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        token = await _login_admin(ac)
        h = {"Authorization": f"Bearer {token}"}
        r = await ac.post(
            "/api/v1/backups/schedules",
            json={
                "scope": "full",
                "cadence": "daily",
                "hour_utc": 5,
                "format": "json",
            },
            headers=h,
        )
        assert r.status_code == 201, r.text
        body = r.json()["data"]
        assert body["scope"] == "full"
        assert body["cadence"] == "daily"
        assert body["next_run_at"] is not None

        rl = await ac.get("/api/v1/backups/schedules", headers=h)
        assert rl.status_code == 200
        items = rl.json()["data"]
        assert len(items) == 1


@pytest.mark.asyncio
async def test_patch_and_delete_schedule() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        token = await _login_admin(ac)
        h = {"Authorization": f"Bearer {token}"}
        r = await ac.post(
            "/api/v1/backups/schedules",
            json={"scope": "full", "cadence": "daily", "format": "json"},
            headers=h,
        )
        sid = r.json()["data"]["id"]

        rp = await ac.patch(
            f"/api/v1/backups/schedules/{sid}",
            json={"enabled": False, "cadence": "weekly", "hour_utc": 6},
            headers=h,
        )
        assert rp.status_code == 200
        body = rp.json()["data"]
        assert body["enabled"] is False
        assert body["cadence"] == "weekly"
        assert body["hour_utc"] == 6

        rd = await ac.delete(
            f"/api/v1/backups/schedules/{sid}", headers=h
        )
        assert rd.status_code == 204


# ── run_backup happy path (storage mocked) ──────────────────────────


@pytest.mark.asyncio
async def test_run_backup_happy_path_full_json() -> None:
    """run_backup with scope=full + json renders all docs, uploads, and
    records an `ok` row in `backup_runs` with non-zero size."""
    captured: dict[str, Any] = {}

    class _FakeS3:
        def put_object(self, **kwargs: Any) -> None:
            captured["bucket"] = kwargs["Bucket"]
            captured["key"] = kwargs["Key"]
            captured["size"] = len(kwargs["Body"])

    with patch.object(
        backup_runner.minio_adapter, "internal_client", lambda: _FakeS3()
    ):
        async with session_scope() as s:
            res = await backup_runner.run_backup(
                s,
                schedule_id=None,
                scope="full",
                fmt="json",
            )

    assert res["doc_count"] >= 0
    assert res["size_bytes"] > 0
    assert captured["bucket"] == "mxwp-backups"
    assert captured["key"].startswith("full/")
    assert captured["key"].endswith("-json.zip")

    # Audit row recorded.
    async with session_scope() as s:
        rows = (await s.execute(
            text(
                "SELECT status, size_bytes, doc_count "
                "FROM backup_runs ORDER BY started_at DESC LIMIT 1"
            )
        )).all()
    assert rows and rows[0][0] == "ok"
    assert int(rows[0][1]) > 0


# ── tick_once: pulls due rows + advances next_run_at ────────────────


@pytest.mark.asyncio
async def test_tick_once_runs_due_schedule_and_reschedules() -> None:
    """Insert a schedule with `next_run_at` in the past, ensure the ticker
    triggers run_backup once (mocked) and advances next_run_at."""
    # Insert a due schedule directly so we can fix `next_run_at` in the past.
    async with session_scope() as s:
        admin = (await s.execute(
            text("SELECT id FROM users WHERE email = 'admin@mx.local'")
        )).first()
        assert admin is not None
        await s.execute(
            text(
                """
                INSERT INTO backup_schedules
                  (scope, cadence, hour_utc, format, enabled,
                   next_run_at, created_by)
                VALUES (
                  'full', 'daily', 3, 'json', true,
                  :nxt, :u
                )
                """
            ),
            {
                "nxt": datetime.now(UTC) - timedelta(minutes=5),
                "u": admin[0],
            },
        )

    invoked: list[dict[str, Any]] = []

    async def _fake_run_backup(s, **kwargs: Any) -> dict[str, Any]:  # type: ignore[no-untyped-def]
        invoked.append(kwargs)
        return {"run_id": "fake", "size_bytes": 1, "doc_count": 0}

    with patch.object(backup_runner, "run_backup", _fake_run_backup):
        executed = await backup_runner.tick_once()

    assert executed == 1
    assert invoked and invoked[0]["scope"] == "full"

    async with session_scope() as s:
        row = (await s.execute(
            text(
                "SELECT next_run_at, last_run_at FROM backup_schedules"
            )
        )).first()
    assert row is not None
    nxt, last = row[0], row[1]
    assert nxt is not None and nxt > datetime.now(UTC)
    assert last is not None


@pytest.mark.asyncio
async def test_tick_once_disabled_when_setting_off() -> None:
    """When `backup_enabled=False`, tick_once is a no-op."""
    from app.core.config import get_settings

    settings = get_settings()
    settings.backup_enabled = False
    try:
        executed = await backup_runner.tick_once()
        assert executed == 0
    finally:
        settings.backup_enabled = True


# ── /runs + download redirect ───────────────────────────────────────


@pytest.mark.asyncio
async def test_list_runs_and_download_redirects_to_presigned_url() -> None:
    # Seed an `ok` run with a known storage_key.
    async with session_scope() as s:
        row = (await s.execute(
            text(
                """
                INSERT INTO backup_runs
                  (scope, format, storage_key, size_bytes, status, finished_at)
                VALUES ('full', 'json', 'full/2026/05/test.zip', 123, 'ok', NOW())
                RETURNING id
                """
            )
        )).first()
        run_id = str(row[0])

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        token = await _login_admin(ac)
        h = {"Authorization": f"Bearer {token}"}

        rl = await ac.get("/api/v1/backups/runs", headers=h)
        assert rl.status_code == 200
        ids = [r["id"] for r in rl.json()["data"]]
        assert run_id in ids

        class _FakePublic:
            def generate_presigned_url(self, *_a: Any, **_k: Any) -> str:
                return "http://minio.example/presigned"

        with patch.object(
            backup_runner.minio_adapter, "public_client", lambda: _FakePublic()
        ):
            rd = await ac.get(
                f"/api/v1/backups/runs/{run_id}/download",
                headers=h,
                follow_redirects=False,
            )
        assert rd.status_code == 302
        assert rd.headers["location"] == "http://minio.example/presigned"
