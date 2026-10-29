# 위키 일정 — 밤 점검 · 상시 질문 · 지속 질의를 정해진 때 한 번씩 줄 세운다(워커가 여럿이어도 한 번 — 권고 잠금 · 표지 표)
"""request §5-8(밤 전체 점검) · §5-9(상시 질문 · 지속 질의) · SCHEMA-DRAFT §6 `lint.nightly_at` · `standing_questions`.

워커가 1분마다 `tick` 을 부른다. 셋 다 `wiki_schedule` 의 마지막 때로 '이미 했나' 를 보고, 트랜잭션 권고 잠금으로 워커 둘이 같이 줄
세우지 않게 한다. 실제로 언제 도는지는 문지기(`budget.gate`)가 정한다 — 줄은 낮에 서도 LLM 을 쓰는 작업은 조용한 시간에 돈다.

- 밤 점검 — KST 그날 `lint.nightly_at` 이 지났는데 그 뒤로 줄 세운 적이 없으면. 배경 LLM 이 있으면 `llm: true`(글 모순 짝).
- 상시 질문 — 하루 한 번. 규칙서 `standing_questions` 의 유형마다 살아 있는 엔티티의 문서(범위마다 한 장)에 '<문서 제목>: <물음>' 을
  그 문서의 범위로 남긴다. 같은 물음이 `every_days` 안에 물은 적이 있으면 건너뛰고, 지났으면(답했어도) 다시 연다.
- 지속 질의 — 조용한 시간에 한 시간마다. 열린 질문을 우선순위 순으로, 남은 하루 예산(질문 하나 = `inquiry_tokens`)만큼 줄 세운다
  (줄에 이미 선 것을 빼고 한 번에 `INQUIRE_BATCH` 까지). 배경 LLM 이 없으면 줄 세우지 않는다(미뤄지기만 되풀이한다).
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta
from datetime import time as dtime
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.wiki import apply as wiki_apply
from app.wiki import budget, jobs, llm, questions
from app.wiki import schema as wiki_schema

_LOCK = (0x57494B49, 99)  # 'WIKI' · 일정
INQUIRE_BATCH = 10
INQUIRE_EVERY = timedelta(hours=1)


async def _last(s: AsyncSession, key: str) -> datetime | None:
    return (await s.execute(text("SELECT last_at FROM wiki_schedule WHERE key = :k"), {"k": key})).scalar()


async def _mark(s: AsyncSession, key: str, at: datetime, detail: dict[str, Any]) -> None:
    await s.execute(text("""
        INSERT INTO wiki_schedule (key, last_at, detail) VALUES (:k, :at, CAST(:d AS jsonb))
        ON CONFLICT (key) DO UPDATE SET last_at = EXCLUDED.last_at, detail = EXCLUDED.detail
    """), {"k": key, "at": at, "d": json.dumps(detail, ensure_ascii=False)})


def nightly_due(book: wiki_schema.RuleBook, now: datetime, last: datetime | None) -> bool:
    at = dtime.fromisoformat(book.spec.lint.nightly_at)
    today = budget.day_start(now).replace(hour=at.hour, minute=at.minute)
    return now >= today and (last is None or last < today)


async def standing(s: AsyncSession, book: wiki_schema.RuleBook, now: datetime) -> dict[str, int]:
    author_id, _ = await wiki_apply.wiki_author(s)
    room = book.spec.inquiry.max_open - int((await s.execute(text(
        "SELECT COUNT(*) FROM wiki_questions WHERE status IN ('open', 'asking')"))).scalar_one())
    added = reopened = 0
    for i, sq in enumerate(book.spec.standing_questions):
        rows = (await s.execute(text("""
            SELECT e.id, wp.audience, d.title FROM wiki_entities e JOIN wiki_pages wp ON wp.entity_id = e.id
              JOIN documents d ON d.id = wp.doc_id
             WHERE e.status = 'active' AND e.type_key = :t AND d.status <> 'archived' ORDER BY d.title
        """), {"t": sq.about})).all()
        for eid, aud, title in rows:
            q_text = f"{title}: {sq.text}"
            prev = (await s.execute(text("""
                SELECT id, status, last_asked_at FROM wiki_questions WHERE norm_hash = :h AND audience = CAST(:a AS text[])
            """), {"h": questions.norm_hash(q_text), "a": list(aud)})).first()
            if prev is not None:
                if prev[2] > now - timedelta(days=sq.every_days) or prev[1] in ("open", "asking"):
                    continue
                if room <= 0:
                    return {"added": added, "reopened": reopened}
                await s.execute(text("""
                    UPDATE wiki_questions SET status = 'open', last_asked_at = NOW(), asked_count = asked_count + 1, attempts = 0
                     WHERE id = :i
                """), {"i": prev[0]})
                reopened += 1
                room -= 1
                continue
            if room <= 0:
                return {"added": added, "reopened": reopened}
            await questions.add(s, q_text, origin="standing", user={"id": author_id}, aud=list(aud),
                                origin_ref=f"standing:{i}:{eid}", priority=4, about=[str(eid)], actor="wiki")
            added += 1
            room -= 1
    return {"added": added, "reopened": reopened}


async def enqueue_inquiries(s: AsyncSession, book: wiki_schema.RuleBook, now: datetime) -> int:
    left = book.spec.budget.daily_tokens - await budget.used_today(s, now)
    room = min(INQUIRE_BATCH, max(0, left) // max(1, book.spec.budget.inquiry_tokens))
    waiting = int((await s.execute(text(
        "SELECT COUNT(*) FROM wiki_jobs WHERE op = 'inquire' AND state IN ('queued', 'running')"))).scalar_one())
    n = room - waiting
    if n <= 0:
        return 0
    rows = (await s.execute(text("""
        SELECT q.id, q.priority FROM wiki_questions q
         WHERE q.status = 'open' AND q.attempts < :max
           AND NOT EXISTS (SELECT 1 FROM wiki_jobs j WHERE j.op = 'inquire' AND j.state IN ('queued', 'running', 'held')
                            AND j.args ->> 'question_id' = CAST(q.id AS text))
         ORDER BY q.priority, q.last_asked_at LIMIT :n
    """), {"max": book.spec.inquiry.max_asks_per_question, "n": n})).all()
    for qid, prio in rows:
        await jobs.enqueue(s, "inquire", {"question_id": str(qid)}, priority=jobs.PRIORITY_BACKGROUND + int(prio))
    return len(rows)


async def tick(s: AsyncSession) -> dict[str, Any]:
    """정해진 일 셋 중 때가 된 것을 줄 세운다 — 무엇을 했는지 돌려준다(시험 · 기록)."""
    got = (await s.execute(text("SELECT pg_try_advisory_xact_lock(:a, :b)"), {"a": _LOCK[0], "b": _LOCK[1]})).scalar_one()
    if not got:
        return {}
    book = await wiki_schema.load(s)
    now = budget.now()
    done: dict[str, Any] = {}
    if nightly_due(book, now, await _last(s, "lint_full")):
        use_llm = llm.background() is not None
        done["lint"] = await jobs.enqueue(s, "lint", {"scope": "full", "llm": use_llm})
        await _mark(s, "lint_full", now, {"llm": use_llm})
    last = await _last(s, "standing")
    if last is None or last < budget.day_start(now):
        done["standing"] = await standing(s, book, now)
        await _mark(s, "standing", now, done["standing"])
    last = await _last(s, "inquire")
    if llm.background() is not None and budget.in_quiet(book, now) and (last is None or last < now - INQUIRE_EVERY):
        done["inquire"] = await enqueue_inquiries(s, book, now)
        await _mark(s, "inquire", now, {"queued": done["inquire"]})
    await s.commit()
    return done
