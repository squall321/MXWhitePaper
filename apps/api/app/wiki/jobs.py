# 위키 작업 큐(DB) — SKIP LOCKED 로 집고 lease 를 늘려 가며 돌고, lease 가 지나면 다른 워커가 다시 집는다
"""CONTRACTS §2-5 · §8.

- 우선순위는 작을수록 먼저 — 사람이 기다리는 묻기는 `PRIORITY_INTERACTIVE`, 배경 작업은 `PRIORITY_BACKGROUND`.
- 상태를 바꾸는 쿼리는 모두 `worker` 와 `state='running'` 을 함께 본다 — lease 를 잃은 워커가 남이 다시 집은 작업을 덮어쓰지 않게.
- 실패는 `max_attempts` 까지 지수로 뒤로 미뤄 다시 줄에 넣고, 넘으면 `failed`. lease 가 지나 다시 집힌 것도 시도 수에 든다
  (그 작업에서 워커가 거듭 죽으면 끝없이 돌지 않게).
- 커밋은 부르는 쪽이 한다 — 원천 받기처럼 다른 줄과 한 트랜잭션에 넣어야 할 때가 있다. 단 `claim` 은 바로 커밋한다(집은 순간
  다른 워커에게 보여야 한다).
"""
from __future__ import annotations

import json
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

PRIORITY_INTERACTIVE = 10
PRIORITY_BACKGROUND = 100
RETRY_BASE_S = 30
_ERROR_MAX = 600  # 사람이 읽는 한 줄 + 예외 꼬리


@dataclass
class Job:
    id: str
    op: str
    args: dict[str, Any] = field(default_factory=dict)
    attempts: int = 0
    max_attempts: int = 3
    budget: dict[str, Any] = field(default_factory=dict)


def _json(v: Any) -> Any:
    if isinstance(v, str):
        try:
            return json.loads(v)
        except ValueError:
            return {}
    return v or {}


async def enqueue(
    s: AsyncSession, op: str, args: dict[str, Any] | None = None, *, priority: int = PRIORITY_BACKGROUND,
    delay_s: int = 0, budget: dict[str, Any] | None = None, created_by: str | None = None, max_attempts: int = 3,
) -> str:
    return str((await s.execute(text("""
        INSERT INTO wiki_jobs (op, args, priority, not_before, budget, created_by, max_attempts)
        VALUES (:op, CAST(:args AS jsonb), :prio, NOW() + CAST(:delay AS integer) * INTERVAL '1 second',
                CAST(:budget AS jsonb), CAST(:by AS uuid), :max)
        RETURNING id
    """), {"op": op, "args": json.dumps(args or {}, ensure_ascii=False), "prio": priority, "delay": delay_s,
           "budget": json.dumps(budget or {}), "by": created_by, "max": max_attempts})).scalar_one())


async def claim(s: AsyncSession, worker: str, ops: Sequence[str], *, lease_s: int) -> Job | None:
    """집을 수 있는 작업 하나 — 줄에 선 것(not_before 지남) 또는 lease 가 지난 running. 없으면 None."""
    while True:
        row = (await s.execute(text("""
            UPDATE wiki_jobs j
               SET state = 'running', attempts = j.attempts + 1, worker = :w,
                   lease_until = NOW() + CAST(:lease AS integer) * INTERVAL '1 second',
                   started_at = COALESCE(j.started_at, NOW())
             WHERE j.id = (
                   SELECT id FROM wiki_jobs
                    WHERE op = ANY(:ops)
                      AND ((state = 'queued' AND not_before <= NOW())
                           OR (state = 'running' AND lease_until < NOW()))
                    ORDER BY priority, not_before, created_at
                    FOR UPDATE SKIP LOCKED
                    LIMIT 1)
            RETURNING j.id, j.op, j.args, j.attempts, j.max_attempts, j.budget
        """), {"w": worker, "lease": lease_s, "ops": list(ops)})).first()
        await s.commit()
        if row is None:
            return None
        job = Job(id=str(row[0]), op=row[1], args=_json(row[2]), attempts=int(row[3]), max_attempts=int(row[4]),
                  budget=_json(row[5]))
        if job.attempts <= job.max_attempts:
            return job
        await _finish(s, job.id, worker, "failed", error="lease 만료가 거듭됐다 — 워커가 이 작업 중에 거듭 죽었다")
        await s.commit()


async def extend(s: AsyncSession, job_id: str, worker: str, *, lease_s: int) -> bool:
    """심장박동 — 아직 내 작업이면 lease 를 늘린다. 남이 다시 집었으면 False(그 일을 그만둔다)."""
    row = (await s.execute(text("""
        UPDATE wiki_jobs SET lease_until = NOW() + CAST(:lease AS integer) * INTERVAL '1 second'
         WHERE id = CAST(:id AS uuid) AND worker = :w AND state = 'running'
        RETURNING id
    """), {"id": job_id, "w": worker, "lease": lease_s})).first()
    return row is not None


async def _finish(
    s: AsyncSession, job_id: str, worker: str, state: str, *, result: dict[str, Any] | None = None,
    usage: dict[str, Any] | None = None, error: str | None = None,
) -> bool:
    row = (await s.execute(text("""
        UPDATE wiki_jobs
           SET state = :state, finished_at = NOW(), lease_until = NULL,
               result = CAST(:result AS jsonb), usage = COALESCE(CAST(:usage AS jsonb), usage), error = :error
         WHERE id = CAST(:id AS uuid) AND worker = :w AND state = 'running'
        RETURNING id
    """), {"state": state, "result": json.dumps(result) if result is not None else None,
           "usage": json.dumps(usage) if usage is not None else None,
           "error": (error or None) and error[:_ERROR_MAX], "id": job_id, "w": worker})).first()
    return row is not None


async def complete(
    s: AsyncSession, job_id: str, worker: str, *, result: dict[str, Any] | None = None,
    usage: dict[str, Any] | None = None,
) -> bool:
    return await _finish(s, job_id, worker, "done", result=result, usage=usage)


async def hold(s: AsyncSession, job_id: str, worker: str, reason: str) -> bool:
    """사람 확인을 기다린다(예산 넘침 등) — 조용히 버리지 않는다."""
    return await _finish(s, job_id, worker, "held", error=reason)


async def fail(s: AsyncSession, job_id: str, worker: str, error: str) -> str | None:
    """시도가 남았으면 뒤로 미뤄 다시 줄에(→ 'queued'), 아니면 'failed'. 내 작업이 아니면 None."""
    row = (await s.execute(text("""
        UPDATE wiki_jobs
           SET state = CASE WHEN attempts < max_attempts THEN 'queued' ELSE 'failed' END,
               not_before = CASE WHEN attempts < max_attempts
                                 THEN NOW() + (CAST(:base AS integer) * power(2, attempts - 1)) * INTERVAL '1 second'
                                 ELSE not_before END,
               finished_at = CASE WHEN attempts < max_attempts THEN NULL ELSE NOW() END,
               lease_until = NULL, worker = CASE WHEN attempts < max_attempts THEN NULL ELSE worker END,
               error = :error
         WHERE id = CAST(:id AS uuid) AND worker = :w AND state = 'running'
        RETURNING state
    """), {"base": RETRY_BASE_S, "error": error[:_ERROR_MAX], "id": job_id, "w": worker})).first()
    return row[0] if row else None


async def stats(s: AsyncSession) -> dict[str, Any]:
    """/api/v1/wiki/health 용 — 줄 길이 · 가장 오래 기다린 작업 · 최근 실패."""
    row = (await s.execute(text("""
        SELECT COUNT(*) FILTER (WHERE state = 'queued'),
               COUNT(*) FILTER (WHERE state = 'running'),
               COUNT(*) FILTER (WHERE state = 'held'),
               EXTRACT(EPOCH FROM NOW() - MIN(created_at) FILTER (WHERE state = 'queued')),
               COUNT(*) FILTER (WHERE state = 'failed' AND finished_at > NOW() - INTERVAL '24 hours')
          FROM wiki_jobs
    """))).first()
    last = (await s.execute(text("""
        SELECT op, error, finished_at FROM wiki_jobs WHERE state = 'failed' ORDER BY finished_at DESC NULLS LAST LIMIT 1
    """))).first()
    return {
        "queued": int(row[0]), "running": int(row[1]), "held": int(row[2]),
        "oldest_queued_s": int(row[3]) if row[3] is not None else None,
        "failed_24h": int(row[4]),
        "last_failure": ({"op": last[0], "error": last[1], "at": last[2].isoformat() if last[2] else None}
                         if last else None),
    }
