# 위키 작업 워커 — python -m app.wiki.worker. API 와 다른 프로세스(인스턴스 mxwp_wiki)에서 DB 큐를 돈다
"""CONTRACTS §8 · WK-D6.

API 안의 asyncio 티커를 쓰지 않는 까닭 — API 재기동(dev 는 저장할 때마다)이 긴 LLM 작업을 끊고, 상태를 볼 길이 없다. 워커는 작업을
`jobs.claim` 으로 집어 처리기에 넘기고, 도는 동안 심장박동으로 lease 를 늘린다. 워커가 죽으면 lease 가 지나 다른 워커(또는 다시 뜬 이
워커)가 그 작업을 다시 집는다. 처리기가 없는 op 는 집지 않는다 — 들이기(W4) 전에 받은 원천의 ingest 작업은 줄에서 기다린다.

`WIKI_ENABLED` 가 꺼져 있으면 아무것도 집지 않고 쉰다(심장박동 표에는 'disabled' 로 남긴다). 읽는 사람은 시스템이다.

집은 작업은 처리기에 넘기기 전에 문지기(`budget.gate`)를 지난다 — 조용한 시간에만 도는 작업(지속 질의 · LLM 을 쓰는 점검)이나 하루
예산이 다 찬 날의 배경 작업은 시도 수를 쓰지 않고 그때까지 미룬다(W7). 켜져 있으면 1분마다 일정(`schedule.tick` — 밤 점검 · 상시 질문 ·
지속 질의)을 본다.
"""
from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import signal
import socket
from collections.abc import Awaitable, Callable
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.db import session_scope
from app.wiki import audience, budget, ingest, inquire, jobs, lint, llm, schedule

log = logging.getLogger("mxwp.wiki.worker")

Handler = Callable[[AsyncSession, jobs.Job], Awaitable[dict[str, Any] | None]]
HANDLERS: dict[str, Handler] = {}
LEASE_S = 300
DEFER_S = 120  # LLM 이 닿지 않을 때 다시 볼 때까지
TICK_S = 60.0  # 일정을 보는 틈


def handler(op: str) -> Callable[[Handler], Handler]:
    def _reg(fn: Handler) -> Handler:
        HANDLERS[op] = fn
        return fn

    return _reg


@handler("noop")
async def _noop(s: AsyncSession, job: jobs.Job) -> dict[str, Any]:
    """줄 · lease · 재시도를 시험하고 점검하는 빈 작업 — args.sleep_s 만큼 자고, args.fail 이 있으면 그 글로 실패한다."""
    await asyncio.sleep(float(job.args.get("sleep_s", 0)))
    if job.args.get("fail"):
        raise RuntimeError(str(job.args["fail"]))
    return {"ok": True}


handler("ingest")(ingest.run)
handler("lint")(lint.run)
handler("inquire")(inquire.run)


async def _touch(worker_id: str, state: str, job_id: str | None = None) -> None:
    async with session_scope() as s:
        await s.execute(text("""
            INSERT INTO wiki_workers (worker, seen_at, state, job_id) VALUES (:w, NOW(), :st, CAST(:j AS uuid))
            ON CONFLICT (worker) DO UPDATE SET seen_at = NOW(), state = EXCLUDED.state, job_id = EXCLUDED.job_id
        """), {"w": worker_id, "st": state, "j": job_id})


async def _heartbeat(job: jobs.Job, worker_id: str, lease_s: int, done: asyncio.Event) -> None:
    while not done.is_set():
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(done.wait(), timeout=max(1.0, lease_s / 3))
        if done.is_set():
            return
        async with session_scope() as s:
            if not await jobs.extend(s, job.id, worker_id, lease_s=lease_s):
                log.warning("job %s: lease lost — another worker owns it now", job.id)
                return
        await _touch(worker_id, "running", job.id)


async def run_once(worker_id: str, *, lease_s: int = LEASE_S, ops: list[str] | None = None) -> bool:
    """작업 하나를 집어 끝까지 돈다. 집을 것이 없으면 False. `ops` 는 집을 op(기본 — 처리기가 있는 것 모두)."""
    async with session_scope() as s:
        job = await jobs.claim(s, worker_id, ops or list(HANDLERS), lease_s=lease_s)
    if job is None:
        return False
    async with session_scope() as s:
        blocked = await budget.gate(s, job.op, job.args)
        if blocked is not None:
            until, why = blocked
            delay = max(1, int((until - budget.now()).total_seconds()))
            await jobs.defer(s, job.id, worker_id, delay_s=delay, reason=why)
            if why.startswith("하루 예산"):
                await budget.note_daily_cap(s, job.op, why)
            log.info("job %s (%s) waits %ss: %s", job.id, job.op, delay, why)
            return True
    await _touch(worker_id, "running", job.id)
    current = budget.current_job.set(job.id)
    done = asyncio.Event()
    beat = asyncio.create_task(_heartbeat(job, worker_id, lease_s, done))
    try:
        async with session_scope() as s:
            result = await HANDLERS[job.op](s, job)
        async with session_scope() as s:
            await jobs.complete(s, job.id, worker_id, result=result,
                                usage=(result or {}).get("usage") if isinstance(result, dict) else None)
        log.info("job %s (%s) done", job.id, job.op)
    except llm.LLMUnavailable as e:
        async with session_scope() as s:
            await jobs.defer(s, job.id, worker_id, delay_s=DEFER_S, reason=f"{job.op} 미룸 — {e}")
        log.warning("job %s (%s) deferred: %s", job.id, job.op, e)
    except budget.BudgetExceeded as e:
        async with session_scope() as s:
            await jobs.hold(s, job.id, worker_id, str(e))
        log.warning("job %s (%s) held: %s", job.id, job.op, e)
    except Exception as e:  # 어떤 실패든 작업에 적고 다음으로 간다
        async with session_scope() as s:
            state = await jobs.fail(s, job.id, worker_id, f"{job.op} 실패 — {type(e).__name__}: {str(e)[:300]}")
        log.warning("job %s (%s) failed → %s: %s", job.id, job.op, state, e)
    finally:
        budget.current_job.reset(current)
        done.set()
        await beat
    return True


async def _tick() -> None:
    try:
        async with session_scope() as s:
            done = await schedule.tick(s)
        if done:
            log.info("wiki schedule: %s", done)
    except Exception:  # 일정이 깨져도 줄의 작업은 계속 돈다
        log.warning("wiki schedule tick failed", exc_info=True)


async def serve(stop: asyncio.Event, *, worker_id: str, idle_s: float = 2.0, lease_s: int = LEASE_S,
                ops: list[str] | None = None, tick: bool | None = None) -> None:
    """`tick` — 일정을 볼지(비면 op 를 좁히지 않은 워커만 — 시험이 op 를 좁혀 돌리는 워커는 일정을 건드리지 않는다)."""
    audience.set_viewer(audience.SYSTEM)
    tick = ops is None if tick is None else tick
    last_tick = 0.0
    loop = asyncio.get_running_loop()
    while not stop.is_set():
        if not get_settings().wiki_enabled:
            await _touch(worker_id, "disabled")
            delay = 30.0
        else:
            await _touch(worker_id, "idle")
            if tick and loop.time() - last_tick >= TICK_S:
                last_tick = loop.time()
                await _tick()
            delay = 0.0 if await run_once(worker_id, lease_s=lease_s, ops=ops) else idle_s
        if delay:
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(stop.wait(), timeout=delay)
    await _touch(worker_id, "stopped")


async def _main() -> None:
    worker_id = f"{socket.gethostname()}:{os.getpid()}"
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, stop.set)
    log.info("wiki worker %s up (enabled=%s, ops=%s)", worker_id, get_settings().wiki_enabled, sorted(HANDLERS))
    await serve(stop, worker_id=worker_id)
    log.info("wiki worker %s stopped", worker_id)


def main() -> None:
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO").upper(),
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    asyncio.run(_main())


if __name__ == "__main__":
    main()
