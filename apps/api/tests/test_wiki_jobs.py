# 위키 작업 큐 · 워커 · 불변 표 시험 — 집기 · 우선순위 · lease 만료 재집기(워커 재기동) · 재시도 · 원천 불변 · 기록 덧붙이기만
"""docs/llm-wiki W3 완료 기준 일부 — '작업이 워커 재기동을 넘김' · '불변(UPDATE 거부)'.

큐 시험은 op='noop' 만 쓰고 앞뒤로 비운다(다른 op 의 줄은 건드리지 않는다).
"""
from __future__ import annotations

import asyncio
import json
from typing import Any
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.core.db import session_scope
from app.wiki import jobs, worker


@pytest.fixture(autouse=True)
async def _clean_noop_jobs() -> Any:
    async with session_scope() as s:
        await s.execute(text("DELETE FROM wiki_jobs WHERE op = 'noop'"))
    yield
    async with session_scope() as s:
        await s.execute(text("DELETE FROM wiki_jobs WHERE op = 'noop'"))
        await s.execute(text("DELETE FROM wiki_workers WHERE worker LIKE 'test-%'"))


async def _state(job_id: str) -> tuple[str, int, str | None]:
    async with session_scope() as s:
        row = (await s.execute(text("SELECT state, attempts, error FROM wiki_jobs WHERE id = CAST(:i AS uuid)"),
                               {"i": job_id})).first()
    assert row is not None
    return row[0], int(row[1]), row[2]


async def _enqueue(**kw: Any) -> str:
    async with session_scope() as s:
        return await jobs.enqueue(s, "noop", kw.pop("args", {}), **kw)


async def test_claim_order_and_not_before() -> None:
    later = await _enqueue(delay_s=3600)
    background = await _enqueue()
    interactive = await _enqueue(priority=jobs.PRIORITY_INTERACTIVE)
    async with session_scope() as s:
        first = await jobs.claim(s, "test-a", ["noop"], lease_s=60)
        second = await jobs.claim(s, "test-a", ["noop"], lease_s=60)
        third = await jobs.claim(s, "test-a", ["noop"], lease_s=60)
    assert first is not None and first.id == interactive  # 사람이 기다리는 작업이 앞
    assert second is not None and second.id == background
    assert third is None  # not_before 가 아직인 작업은 안 집힌다
    assert (await _state(later))[0] == "queued"


async def test_expired_lease_is_reclaimed_by_another_worker() -> None:
    """워커가 작업 중에 죽으면(완료를 못 적음) lease 가 지난 뒤 다른 워커가 다시 집어 끝낸다."""
    job_id = await _enqueue()
    async with session_scope() as s:
        a = await jobs.claim(s, "test-a", ["noop"], lease_s=1)
    assert a is not None and a.attempts == 1
    async with session_scope() as s:
        assert await jobs.claim(s, "test-b", ["noop"], lease_s=60) is None  # 아직 a 의 lease 안
    await asyncio.sleep(1.3)
    async with session_scope() as s:
        b = await jobs.claim(s, "test-b", ["noop"], lease_s=60)
    assert b is not None and b.id == job_id and b.attempts == 2
    async with session_scope() as s:
        assert await jobs.complete(s, job_id, "test-a") is False  # lease 를 잃은 a 는 덮어쓰지 못한다
        assert await jobs.extend(s, job_id, "test-a", lease_s=60) is False
        assert await jobs.complete(s, job_id, "test-b", result={"ok": True}) is True
    assert (await _state(job_id))[0] == "done"


async def test_fail_retries_then_fails() -> None:
    job_id = await _enqueue(max_attempts=2)
    async with session_scope() as s:
        await jobs.claim(s, "test-a", ["noop"], lease_s=60)
        assert await jobs.fail(s, job_id, "test-a", "첫 실패") == "queued"
    state, attempts, error = await _state(job_id)
    assert (state, attempts, error) == ("queued", 1, "첫 실패")
    async with session_scope() as s:  # 뒤로 미룬 시각을 당겨 바로 다시 집는다
        await s.execute(text("UPDATE wiki_jobs SET not_before = NOW() WHERE id = CAST(:i AS uuid)"), {"i": job_id})
    async with session_scope() as s:
        again = await jobs.claim(s, "test-a", ["noop"], lease_s=60)
        assert again is not None and again.attempts == 2
        assert await jobs.fail(s, job_id, "test-a", "둘째 실패") == "failed"
    assert (await _state(job_id))[0] == "failed"


async def test_repeated_lease_expiry_ends_in_failed() -> None:
    job_id = await _enqueue(max_attempts=1)
    async with session_scope() as s:
        await jobs.claim(s, "test-a", ["noop"], lease_s=1)
    await asyncio.sleep(1.3)
    async with session_scope() as s:
        assert await jobs.claim(s, "test-b", ["noop"], lease_s=60) is None
    state, attempts, error = await _state(job_id)
    assert state == "failed" and attempts == 2 and error and "lease" in error


async def test_run_once_noop_done_and_failure_recorded() -> None:
    ok = await _enqueue()
    assert await worker.run_once("test-w", ops=["noop"]) is True
    assert (await _state(ok))[0] == "done"
    bad = await _enqueue(args={"fail": "일부러"})
    assert await worker.run_once("test-w", ops=["noop"]) is True
    state, _, error = await _state(bad)
    assert state == "queued" and error and "일부러" in error  # 재시도 차례로 돌아간다
    assert await worker.run_once("test-w", ops=["noop"]) is False  # 뒤로 미뤄져 지금은 집을 것이 없다


async def test_serve_loop_processes_and_stops(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "wiki_enabled", True)
    job_id = await _enqueue(args={"sleep_s": 0.2})
    stop = asyncio.Event()
    task = asyncio.create_task(worker.serve(stop, worker_id="test-serve", idle_s=0.1, lease_s=3, ops=["noop"]))
    for _ in range(50):
        if (await _state(job_id))[0] == "done":
            break
        await asyncio.sleep(0.1)
    stop.set()
    await asyncio.wait_for(task, timeout=10)
    assert (await _state(job_id))[0] == "done"
    async with session_scope() as s:
        st = (await s.execute(text("SELECT state FROM wiki_workers WHERE worker = 'test-serve'"))).scalar_one()
    assert st == "stopped"


async def test_disabled_worker_does_not_claim(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "wiki_enabled", False)
    job_id = await _enqueue()
    stop = asyncio.Event()
    task = asyncio.create_task(worker.serve(stop, worker_id="test-off", idle_s=0.1, ops=["noop"]))
    await asyncio.sleep(0.3)
    stop.set()
    await asyncio.wait_for(task, timeout=40)
    assert (await _state(job_id))[0] == "queued"


# ── 불변 · 덧붙이기만 ─────────────────────────────────────────────────────────────────────────

async def _insert_source(ref: str) -> str:
    async with session_scope() as s:
        return str((await s.execute(text("""
            INSERT INTO wiki_sources (kind, origin_system, origin_ref, title, payload, payload_sha256, audience,
                                      sensitivity, via, captured_at)
            VALUES ('note', 'human', :ref, '불변 시험', CAST(:p AS jsonb), repeat('a', 64), ARRAY['org'],
                    'internal', 'upload', NOW())
            RETURNING id
        """), {"ref": ref, "p": json.dumps({"text": "x"})})).scalar_one())


async def _purge_sources(ref: str) -> None:
    async with session_scope() as s:
        await s.execute(text("SET LOCAL mxwp.wiki_purge = 'on'"))
        await s.execute(text("DELETE FROM wiki_sources WHERE origin_ref = :r"), {"r": ref})


async def test_sources_are_immutable_but_status_moves() -> None:
    ref = f"test-immut-{uuid4().hex[:8]}"
    sid = await _insert_source(ref)
    try:
        for change in ("payload = '{\"text\": \"y\"}'::jsonb", "audience = ARRAY['aff:X']", "origin_ref = 'other'",
                       "title = '바뀐 제목'"):
            with pytest.raises(DBAPIError, match="immutable"):
                async with session_scope() as s:
                    await s.execute(text(f"UPDATE wiki_sources SET {change} WHERE id = CAST(:i AS uuid)"), {"i": sid})
        async with session_scope() as s:
            await s.execute(text("""
                UPDATE wiki_sources SET status = 'withdrawn', ingest_state = 'skipped' WHERE id = CAST(:i AS uuid)
            """), {"i": sid})
        with pytest.raises(DBAPIError, match="immutable"):
            async with session_scope() as s:
                await s.execute(text("DELETE FROM wiki_sources WHERE id = CAST(:i AS uuid)"), {"i": sid})
    finally:
        await _purge_sources(ref)
    async with session_scope() as s:
        assert (await s.execute(text("SELECT COUNT(*) FROM wiki_sources WHERE origin_ref = :r"),
                                {"r": ref})).scalar_one() == 0


async def test_log_is_append_only() -> None:
    title = f"test-log-{uuid4().hex[:8]}"
    async with session_scope() as s:
        lid = (await s.execute(text("""
            INSERT INTO wiki_log (op, title, audience) VALUES ('lint', :t, ARRAY['org']) RETURNING id
        """), {"t": title})).scalar_one()
    with pytest.raises(DBAPIError, match="append-only"):
        async with session_scope() as s:
            await s.execute(text("UPDATE wiki_log SET title = 'x' WHERE id = :i"), {"i": lid})
    with pytest.raises(DBAPIError, match="append-only"):
        async with session_scope() as s:
            await s.execute(text("DELETE FROM wiki_log WHERE id = :i"), {"i": lid})
    async with session_scope() as s:
        await s.execute(text("SET LOCAL mxwp.wiki_purge = 'on'"))
        await s.execute(text("DELETE FROM wiki_log WHERE id = :i"), {"i": lid})
