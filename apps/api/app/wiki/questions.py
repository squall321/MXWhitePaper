# 위키 질문 대기열 — 묻기가 답하지 못한 물음 · 사람이 남긴 물음을 범위째 한 줄로(같은 물음이 다시 오면 asked_count 만 올린다)
"""CONTRACTS §2-7 · request §5-7(답이 없으면 질문으로) · §5-9(지속 질의 — W7 이 이 줄을 집어 묻는다).

- 범위 — 그 물음을 볼 수 있는 사람. 남기는 사람이 고르되 그 사람이 가진 토큰 안에서만. 기본은 물은 사람만(`user:<id>`) — 물음 글에
  좁은 범위의 말이 섞일 수 있고, 질문자는 비공개가 기본이다(Q9).
- 같은 물음 — 정규화 문장(`strong_key` 에 문장 부호 `?!.,~…` 까지 뺌)의 해시 + 범위로 한 줄. 닫히거나 버린 물음이 다시 오면 다시 연다.
- 기록 `query`(그 물음의 범위로) — 남김 · 다시 물음.
- 지속 질의(W7) — 워커가 열린 물음을 집어 푼다(`inquire.py`). 사람이 답할 수도 있다(`answer` — 그 사람 명의의 inquiry_answer 원천 →
  들이기). 닫기 · 버리기 · 다시 열기 · 우선순위는 남긴 사람 · 검토자(`update`).
"""
from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import Forbidden, NotFound, ValidationFailed
from app.wiki import audience
from app.wiki.envelope import normalize_audience
from app.wiki.resolve import question_key

ORIGINS = ("lint", "ingest", "user", "query_miss", "standing")


def norm_hash(question: str) -> str:
    return hashlib.sha256(question_key(question).encode("utf-8")).hexdigest()[:32]


def visible_sql(alias: str = "q") -> str:
    return f"(CAST(:_aud_all AS boolean) OR {alias}.audience <@ CAST(:_aud_tokens AS text[]))"


_COLS = """q.id, q.text, q.origin, q.audience, q.priority, q.status, q.asked_count, q.last_asked_at, q.created_at,
               q.created_by = CAST(:me AS uuid), q.attempts, q.detail, q.answer_source_id, q.answered_at"""


def _row(r: Any) -> dict[str, Any]:
    from app.wiki.sources import short_id

    detail = r[11] if isinstance(r[11], dict) else json.loads(r[11] or "{}")
    return {"id": str(r[0]), "text": r[1], "origin": r[2], "audience": list(r[3]), "priority": r[4], "status": r[5],
            "asked_count": r[6], "last_asked_at": r[7].isoformat(), "created_at": r[8].isoformat(),
            "mine": bool(r[9]), "attempts": int(r[10]), "detail": detail,
            "answer_source": {"id": str(r[12]), "short": short_id(str(r[12]))} if r[12] else None,
            "answered_at": r[13].isoformat() if r[13] else None}


async def add(s: AsyncSession, question: str, *, origin: str, user: dict[str, Any], aud: list[str] | None = None,
              origin_ref: str | None = None, priority: int = 3, about: list[str] | None = None,
              actor: str | None = None) -> dict[str, Any]:
    """물음 하나를 남긴다(같은 물음이면 그 줄의 asked_count 를 올린다). 커밋은 부르는 쪽이. `actor` — 기록의 행위자(비면 그 사람,
    점검 · 지속 질의가 남기면 'wiki')."""
    question = " ".join(question.split())
    if not 2 <= len(question) <= 2000:
        raise ValidationFailed("물음은 2~2000자")
    if origin not in ORIGINS:
        raise ValidationFailed(f"모르는 origin — {origin}")
    viewer = audience.current_viewer()
    try:
        tokens = normalize_audience(aud or [f"user:{user['id']}"])
    except ValueError as e:
        raise ValidationFailed(f"범위가 틀렸다 — {e}") from e
    if not viewer.sees_all and not set(tokens) <= set(viewer.tokens):
        raise Forbidden("가진 토큰 밖의 범위로 남기지 못한다", details={"audience": tokens})
    row = (await s.execute(text("""
        INSERT INTO wiki_questions (text, norm_hash, origin, origin_ref, about_entities, audience, priority, created_by)
        VALUES (:t, :h, :o, :ref, CAST(:about AS uuid[]), CAST(:aud AS text[]), :p, CAST(:u AS uuid))
        ON CONFLICT (norm_hash, audience) DO UPDATE
            SET asked_count = wiki_questions.asked_count + 1, last_asked_at = NOW(),
                status = CASE WHEN wiki_questions.status IN ('closed', 'dropped') THEN 'open' ELSE wiki_questions.status END
        RETURNING id, asked_count, (xmax = 0) AS created
    """), {"t": question, "h": norm_hash(question), "o": origin, "ref": origin_ref, "about": about or [], "aud": tokens,
           "p": max(1, min(5, priority)), "u": user["id"]})).one()
    await s.execute(text("""
        INSERT INTO wiki_log (op, title, detail, actor, audience)
        VALUES ('query', :t, CAST(:d AS jsonb), :a, CAST(:aud AS text[]))
    """), {"t": f"질문 {'남김' if row[2] else '다시 물음'} · {question[:80]}", "a": actor or f"user:{user['id']}", "aud": tokens,
           "d": json.dumps({"question": str(row[0]), "origin": origin, "asked_count": row[1]}, ensure_ascii=False)})
    return {"id": str(row[0]), "asked_count": int(row[1]), "created": bool(row[2]), "audience": tokens}


async def listing(s: AsyncSession, *, status: str | None, limit: int, offset: int) -> tuple[list[dict[str, Any]], int]:
    params: dict[str, Any] = {**audience.sql_params(), "limit": limit, "offset": offset,
                              "me": audience.current_viewer().user_id}
    cond = visible_sql("q")
    if status:
        cond += " AND q.status = :st"
        params["st"] = status
    total = (await s.execute(text(f"SELECT COUNT(*) FROM wiki_questions q WHERE {cond}"), params)).scalar_one()
    rows = (await s.execute(text(f"""
        SELECT {_COLS}
          FROM wiki_questions q WHERE {cond} ORDER BY q.priority, q.last_asked_at DESC LIMIT :limit OFFSET :offset
    """), params)).all()
    return [_row(r) for r in rows], int(total)


async def get(s: AsyncSession, question_id: str) -> dict[str, Any]:
    row = (await s.execute(text(f"""
        SELECT {_COLS} FROM wiki_questions q WHERE q.id = CAST(:i AS uuid) AND {visible_sql('q')}
    """), {**audience.sql_params(), "me": audience.current_viewer().user_id, "i": question_id})).first()
    if row is None:
        raise NotFound("그 물음이 없다")
    return _row(row)


async def update(s: AsyncSession, question_id: str, *, user: dict[str, Any], is_reviewer: bool, status: str | None,
                 priority: int | None) -> dict[str, Any]:
    """닫기(closed) · 버리기(dropped) · 다시 열기(open) · 우선순위 — 남긴 사람이나 검토자. 답한 물음을 다시 열면 시도 수를 비운다."""
    q = await get(s, question_id)
    if not (q["mine"] or is_reviewer):
        raise Forbidden("물음을 남긴 사람이나 검토자만 바꾼다")
    if status not in (None, "open", "closed", "dropped"):
        raise ValidationFailed("status 는 open · closed · dropped 만")
    await s.execute(text("""
        UPDATE wiki_questions SET status = COALESCE(:st, status), priority = COALESCE(:p, priority),
               attempts = CASE WHEN :st = 'open' THEN 0 ELSE attempts END,
               detail = detail || CAST(:d AS jsonb)
         WHERE id = CAST(:i AS uuid)
    """), {"st": status, "p": priority, "i": question_id,
           "d": json.dumps({"changed_by": f"user:{user['id']}", "changed_at": datetime.now(UTC).isoformat()})})
    await s.commit()
    return await get(s, question_id)


async def answer(s: AsyncSession, question_id: str, *, user: dict[str, Any], is_reviewer: bool, body: str,
                 confidence: float) -> dict[str, Any]:
    """사람이 답한다 — 그 사람 명의의 inquiry_answer 원천(물음의 범위) → 들이기. 전사 물음의 답은 검토자 · admin 만(전사 원천은
    아무나 보내지 못한다 — 원천 받기 규칙)."""
    from app.wiki import sources
    from app.wiki.envelope import SourceEnvelope

    q = await get(s, question_id)
    if q["status"] in ("closed", "dropped"):
        raise ValidationFailed("닫히거나 버린 물음이다 — 다시 연 뒤 답한다")
    if q["audience"] == ["org"] and not is_reviewer and user.get("role") != "admin":
        raise Forbidden("전사 물음의 답은 검토자 · admin 이 남긴다")
    env = SourceEnvelope.model_validate({
        "schema": "mxwp-source/1", "kind": "inquiry_answer",
        "origin": {"system": "human", "ref": f"wiki-question/{question_id}",
                   "rev": hashlib.sha256(f"{user['id']}|{body}".encode()).hexdigest()[:12]},
        "title": q["text"][:300], "captured_at": datetime.now(UTC).isoformat(), "owner": {"email": user["email"]},
        "audience": q["audience"], "sensitivity": "internal",
        "body": {"question_id": question_id, "answer": body, "confidence": confidence}})
    got = await sources.receive(s, env, caller=user, ingest=True, org_ok=q["audience"] == ["org"])
    await s.execute(text("""
        UPDATE wiki_questions SET status = 'answered', answer_source_id = CAST(:src AS uuid), answered_at = NOW(),
               detail = detail || CAST(:d AS jsonb)
         WHERE id = CAST(:i AS uuid)
    """), {"src": got.id, "i": question_id,
           "d": json.dumps({"answered_by": f"user:{user['id']}", "answer": body[:500]}, ensure_ascii=False)})
    await s.commit()
    return {**await get(s, question_id), "source": {"id": got.id, "short": sources.short_id(got.id), "dedup": got.dedup}}
