# 위키 예산 · 조용한 시간 · 묻기 우선 — 규칙서 budget 칸으로 배경 작업을 거르고, 배경 LLM 호출은 사람이 기다리는 묻기에 비켜 선다
"""request §5-9 · §5-13 · CONTRACTS §8 · SCHEMA-DRAFT §6 `budget`.

- 조용한 시간(`budget.quiet_hours`, KST) — LLM 을 쓰는 밤 점검과 지속 질의만 그때 돈다. 들이기는 언제나 돈다(W8 목표 '원천 → 반영
  1시간 이하' — 낮에 받은 원천을 밤까지 묵히지 않는다). LLM 없는 점검(반영 직후 작은 점검 · 손으로 부른 점검)도 언제나.
- 하루 예산(`budget.daily_tokens`) — 배경 LLM 호출이 쓴 토큰(장부 `wiki_llm_usage`)을 KST 하루로 더한다. 넘으면 배경 작업을 다음
  날로 미룬다(시도 수를 쓰지 않는다 · 기록 한 줄). 보류(held)가 아니다 — 하루 상한은 결함이 아니라 속도다. 작업 하나 · 질문 하나의
  상한(`ingest_tokens` · `inquiry_tokens`)을 넘으면 그 작업은 보류다(`BudgetExceeded`).
- 묻기 우선 — 묻기(사람이 기다린다)는 LLM 을 쓰는 동안 `wiki_llm_turns` 에 한 줄을 둔다(API 프로세스). 배경 호출(워커 프로세스)은
  그 줄이 있는 동안 기다렸다가, LLM 동시 수(`budget.llm_concurrency`)만큼의 자리(PostgreSQL 권고 잠금) 중 하나를 잡고 부른다. 묻기는
  자리를 잡지 않는다 — 예산 밖 · 맨 앞(CONTRACTS §8).
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import time
from collections.abc import AsyncIterator
from contextvars import ContextVar
from datetime import datetime, timedelta
from datetime import time as dtime
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import engine, session_scope
from app.wiki import schema as wiki_schema

log = logging.getLogger("mxwp.wiki.budget")

KST = ZoneInfo("Asia/Seoul")
TURN_TTL_S = 330  # 묻기 전체 시간 제한(300초) + 여유 — API 가 죽어도 이만큼 뒤엔 배경이 다시 돈다
POLL_S = 0.5
_LOCK_NS = 0x57494B49  # 'WIKI' — 권고 잠금 이름 공간(두 번째 열쇠가 자리 번호)
_BOOK_TTL_S = 60.0

current_job: ContextVar[str | None] = ContextVar("mxwp_wiki_job", default=None)


class BudgetExceeded(RuntimeError):
    """작업 하나(들이기 · 점검 · 질문)의 토큰 예산을 넘었다 — 작업을 held 로 둔다."""


def now() -> datetime:
    """지금(KST) — 시험이 바꿔 끼운다."""
    return datetime.now(KST)


def _quiet(book: wiki_schema.RuleBook) -> tuple[dtime, dtime]:
    start, end = book.spec.budget.quiet_hours.split("-")
    return dtime.fromisoformat(start), dtime.fromisoformat(end)


def in_quiet(book: wiki_schema.RuleBook, at: datetime | None = None) -> bool:
    start, end = _quiet(book)
    t = (at or now()).astimezone(KST).time()
    if start == end:
        return True  # 하루 내내
    return start <= t < end if start < end else (t >= start or t < end)


def next_quiet_start(book: wiki_schema.RuleBook, at: datetime | None = None) -> datetime:
    """`at` 이 조용한 시간이면 `at`, 아니면 다음 조용한 시간의 시작."""
    at = (at or now()).astimezone(KST)
    if in_quiet(book, at):
        return at
    start, _ = _quiet(book)
    cand = at.replace(hour=start.hour, minute=start.minute, second=0, microsecond=0)
    return cand if cand > at else cand + timedelta(days=1)


def day_start(at: datetime | None = None) -> datetime:
    at = (at or now()).astimezone(KST)
    return at.replace(hour=0, minute=0, second=0, microsecond=0)


def needs_quiet(op: str, args: dict[str, Any]) -> bool:
    return op == "inquire" or (op == "lint" and bool(args.get("llm")))


def spends_llm(op: str, args: dict[str, Any]) -> bool:
    return op in ("ingest", "inquire") or (op == "lint" and bool(args.get("llm")))


async def used_today(s: AsyncSession, at: datetime | None = None) -> int:
    return int((await s.execute(text("""
        SELECT COALESCE(SUM(tokens), 0) FROM wiki_llm_usage WHERE role = 'background' AND at >= :since
    """), {"since": day_start(at)})).scalar_one())


async def gate(s: AsyncSession, op: str, args: dict[str, Any]) -> tuple[datetime, str] | None:
    """이 작업을 지금 돌려도 되나 — 안 되면 (다시 볼 때, 까닭). 조용한 시간 · 하루 예산."""
    if not spends_llm(op, args) and not needs_quiet(op, args):
        return None
    book = await wiki_schema.load(s)
    at = now()
    if spends_llm(op, args):
        used, cap = await used_today(s, at), book.spec.budget.daily_tokens
        if used >= cap:
            until = day_start(at) + timedelta(days=1)
            if needs_quiet(op, args):
                until = next_quiet_start(book, until)
            return until, f"하루 예산을 다 썼다 — 토큰 {used:,} ≥ {cap:,}(KST 하루). {until:%m-%d %H:%M} 에 다시"
    if needs_quiet(op, args) and not in_quiet(book, at):
        until = next_quiet_start(book, at)
        return until, f"조용한 시간({book.spec.budget.quiet_hours})에만 돈다 — {until:%m-%d %H:%M} 에 다시"
    return None


async def note_daily_cap(s: AsyncSession, op: str, reason: str) -> None:
    """하루 예산이 닿았다는 기록 — 하루에 한 줄(작업마다 쌓지 않는다)."""
    title = "하루 예산 다 씀 — 배경 작업을 다음 날로 미룬다"
    seen = (await s.execute(text("SELECT 1 FROM wiki_log WHERE title = :t AND at >= :since LIMIT 1"),
                            {"t": title, "since": day_start()})).first()
    if seen is None:
        await s.execute(text("""
            INSERT INTO wiki_log (op, title, detail, actor, audience)
            VALUES (:op, :t, CAST(:d AS jsonb), 'wiki', ARRAY['org'])
        """), {"op": op if op in ("ingest", "lint", "inquire") else "ingest", "t": title,
               "d": json.dumps({"why": reason}, ensure_ascii=False)})


# ── LLM 쓴 양 장부 ─────────────────────────────────────────────────────────────────────────────

async def record(role: str, tokens: int, *, name: str | None = None) -> None:
    """LLM 호출 하나가 쓴 토큰 — 하루 예산의 장부. 장부가 깨져도 호출은 막지 않는다."""
    if tokens <= 0:
        return
    try:
        async with session_scope() as s:
            await s.execute(text("""
                INSERT INTO wiki_llm_usage (role, tokens, job_id, name) VALUES (:r, :t, CAST(:j AS uuid), :n)
            """), {"r": role, "t": int(tokens), "j": current_job.get(), "n": name})
    except Exception:  # 장부 실패로 들이기 · 묻기를 깨뜨리지 않는다
        log.warning("wiki llm usage ledger write failed", exc_info=True)


# ── 묻기 우선 · 동시 수 ────────────────────────────────────────────────────────────────────────

_book_cache: tuple[float, int] | None = None


async def _concurrency() -> int:
    global _book_cache
    t = time.monotonic()
    if _book_cache is not None and t - _book_cache[0] < _BOOK_TTL_S:
        return _book_cache[1]
    try:
        async with session_scope() as s:
            n = (await wiki_schema.load(s)).spec.budget.llm_concurrency
    except Exception:
        n = 1
    _book_cache = (t, n)
    return n


@contextlib.asynccontextmanager
async def interactive_turn() -> AsyncIterator[None]:
    """묻기가 LLM 을 쓰는 동안 — 배경 호출이 이 줄을 보고 기다린다."""
    turn_id = None
    try:
        async with session_scope() as s:
            turn_id = (await s.execute(text("""
                INSERT INTO wiki_llm_turns (role, expires_at)
                VALUES ('interactive', NOW() + CAST(:ttl AS integer) * INTERVAL '1 second') RETURNING id
            """), {"ttl": TURN_TTL_S})).scalar_one()
    except Exception:  # 표지가 없어도 묻기는 돈다(배경이 덜 비켜 설 뿐)
        log.warning("wiki interactive turn mark failed", exc_info=True)
    try:
        yield
    finally:
        if turn_id is not None:
            with contextlib.suppress(Exception):
                async with session_scope() as s:
                    await s.execute(text("DELETE FROM wiki_llm_turns WHERE id = :i OR expires_at < NOW()"), {"i": turn_id})


@contextlib.asynccontextmanager
async def background_turn() -> AsyncIterator[None]:
    """배경 LLM 호출 하나 — 묻기가 도는 동안 기다리고, 동시 수만큼의 자리 중 하나를 잡는다(다른 워커 프로세스와도)."""
    slots = await _concurrency()
    waited = 0.0
    async with engine().connect() as conn:  # 세션 단위 권고 잠금 — 이 연결을 호출 내내 쥔다
        held: int | None = None
        while held is None:
            busy = (await conn.execute(text("""
                SELECT EXISTS (SELECT 1 FROM wiki_llm_turns WHERE role = 'interactive' AND expires_at > NOW())
            """))).scalar_one()
            if not busy:
                for slot in range(slots):
                    if (await conn.execute(text("SELECT pg_try_advisory_lock(:ns, :slot)"),
                                           {"ns": _LOCK_NS, "slot": slot})).scalar_one():
                        held = slot
                        break
            await conn.commit()
            if held is None:
                if waited == 0.0:
                    log.info("wiki background LLM call waits (%s)", "interactive query" if busy else "concurrency")
                await asyncio.sleep(POLL_S)
                waited += POLL_S
        try:
            yield
        finally:
            with contextlib.suppress(Exception):
                await conn.execute(text("SELECT pg_advisory_unlock(:ns, :slot)"), {"ns": _LOCK_NS, "slot": held})
                await conn.commit()
