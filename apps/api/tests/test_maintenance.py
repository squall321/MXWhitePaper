"""maintenance.py 단위 테스트 — pending TTL / version compaction / audit retention."""
from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import text

from app.core.db import session_scope
from app.services.maintenance import (
    _select_versions_to_keep,
    compact_versions,
    purge_expired_pending_uploads,
    purge_old_audit_logs,
)


# ── 1) pending TTL ─────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_purge_expired_pending_uploads_deletes_only_expired() -> None:
    async with session_scope() as s:
        # admin user id 가져오기 (pending uploader_id NOT NULL FK)
        admin_id = (await s.execute(
            text("SELECT id FROM users WHERE role='admin' LIMIT 1")
        )).scalar_one()
        # 만료된 행 1, 살아있는 행 1
        await s.execute(text("""
            INSERT INTO images_pending
              (upload_id, uploader_id, filename, mime_type, sha256, size_bytes, expires_at)
            VALUES
              ('test-expired-001', :u, 'a.png', 'image/png', repeat('a', 64), 100, NOW() - INTERVAL '1 hour'),
              ('test-fresh-002',   :u, 'b.png', 'image/png', repeat('b', 64), 100, NOW() + INTERVAL '1 hour')
        """), {"u": admin_id})

    async with session_scope() as s:
        deleted = await purge_expired_pending_uploads(s)
    assert deleted >= 1

    async with session_scope() as s:
        remaining = (await s.execute(
            text("SELECT upload_id FROM images_pending WHERE upload_id LIKE 'test-%'")
        )).all()
        # cleanup test rows
        await s.execute(text(
            "DELETE FROM images_pending WHERE upload_id LIKE 'test-%'"
        ))
    upload_ids = {r[0] for r in remaining}
    assert "test-expired-001" not in upload_ids


# ── 2) version retention pure-function ─────────────────────────────────
def _mk_version(vid: str, version: int, hours_ago: float = 0) -> dict:
    return {
        "id": vid,
        "version": version,
        "edited_at": datetime.now(UTC) - timedelta(hours=hours_ago),
    }


def test_select_versions_keeps_head_and_v1() -> None:
    versions = [
        _mk_version("v1", 1, hours_ago=1000),
        _mk_version("v2", 2, hours_ago=500),
        _mk_version("v3", 3, hours_ago=0),  # head, recent
    ]
    keep = _select_versions_to_keep(versions, now=datetime.now(UTC))
    assert "v1" in keep  # baseline
    assert "v3" in keep  # head


def test_select_versions_compacts_old_per_day() -> None:
    # 25시간 ~ 7일 전 같은 calendar day 안에 두 개 → 그 날의 최신 1개만 keep.
    # Anchor on the *date* boundary (midday of `now - 2days`) so adding 2h
    # stays inside the same date — the prior test used `now - 2days` which
    # could cross midnight depending on the wall-clock hour at test time.
    now = datetime.now(UTC)
    two_days_ago = (now - timedelta(days=2)).date()
    base = datetime(
        two_days_ago.year, two_days_ago.month, two_days_ago.day,
        12, 0, 0, tzinfo=UTC,
    )
    versions = [
        _mk_version("v1", 1, hours_ago=10000),  # always-keep
        {"id": "older", "version": 5,  "edited_at": base},
        {"id": "newer", "version": 6,  "edited_at": base + timedelta(hours=2)},
        {"id": "head",  "version": 7,  "edited_at": now},
    ]
    keep = _select_versions_to_keep(versions, now=now)
    assert "head" in keep
    assert "newer" in keep
    assert "older" not in keep


def test_select_versions_compacts_ancient_per_month() -> None:
    # 60일 전 동일 월에 두 개 → 한 개만 keep
    # base 를 월 중반(15일)으로 고정 → +2 day 가 항상 같은 월 안에 머무름
    base = (datetime.now(UTC) - timedelta(days=60)).replace(day=15)
    versions = [
        _mk_version("v1", 1, hours_ago=99999),  # baseline forced
        {"id": "old1", "version": 2, "edited_at": base},
        {"id": "old2", "version": 3, "edited_at": base + timedelta(days=2)},
        {"id": "head", "version": 4, "edited_at": datetime.now(UTC)},
    ]
    keep = _select_versions_to_keep(versions, now=datetime.now(UTC))
    assert "head" in keep
    # 동일 월 두 개 중 하나만
    assert ("old1" in keep) ^ ("old2" in keep)


# ── 3) compact_versions integration (idempotent) ───────────────────────
@pytest.mark.asyncio
async def test_compact_versions_is_idempotent() -> None:
    async with session_scope() as s:
        # 단순 호출 — 실제 시드 데이터에 대해 한 번 실행, 두 번째는 0 추가 삭제
        await compact_versions(s)
    async with session_scope() as s:
        second = await compact_versions(s)
    assert second == 0, f"second pass should be no-op, got {second}"


# ── 4) audit retention ────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_purge_old_audit_logs_respects_days() -> None:
    async with session_scope() as s:
        # 매우 큰 days → 아무것도 삭제 안 됨
        n = await purge_old_audit_logs(s, days=99999)
    assert n == 0
