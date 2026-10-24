# 위키 후보('내 후보') — 포털 챗이 보낸 주인만 보는 held 원천을 주인이 범위를 골라 승인(→ 그 범위의 새 원천 · 들이기)하거나 버린다
"""request §6-3(사람 결정 Q1 — B 후보 + 한 번 승인) · §5-14 '내 후보'.

- 후보 = 동의 `candidate` 로 받은 원천 — 받기(`sources.receive`)가 범위를 주인만(`user:<주인 id>`)으로, 들이기 상태를 `held` 로 두고,
  보낸 범위를 동의 칸 `suggested_audience` 에 남긴다. 주인 밖(admin 포함)은 목록 · 한 건 어디에도 안 보인다.
- 승인 — 주인이 범위를 고른다(비면 보낸 범위). 같은 봉투를 그 범위로 다시 받아(새 줄 — 멱등 열쇠에 범위가 있다 · 0058) 들이고, 후보 줄은
  '새 판' 길로 superseded. 나만으로 승인하면 그 줄을 그대로 들인다. 범위 규칙은 원천 받기 그대로(가진 토큰 · `["org"]` 는 admin).
  첨부는 다시 싣지 않는다(후보는 문답 · 심의 — 글).
- 버리기 · 기한 — 버리면 철회(withdrawn). 규칙서 `qa.candidate_ttl_days`(기본 7) 가 지나면 목록 · 승인 때 저절로 철회한다. 자동 승인은
  없다.
- 기록 — 승인 `fileback` · 버림 · 기한 `withdraw`(그 원천의 범위 — 주인만).
"""
from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import Conflict, NotFound
from app.wiki import jobs, sources
from app.wiki import schema as wiki_schema
from app.wiki.envelope import SourceEnvelope, normalize_audience

_HELD = "ws.ingest_state = 'held' AND ws.consent ->> 'mode' = 'candidate' AND ws.status = 'active'"


def _j(v: Any) -> Any:
    return json.loads(v) if isinstance(v, str) else v


async def expire(s: AsyncSession, *, ttl_days: int, now: datetime | None = None) -> int:
    """기한이 지난 후보를 철회한다(커밋은 부르는 쪽)."""
    rows = (await s.execute(text(f"""
        UPDATE wiki_sources ws SET status = 'withdrawn', ingest_state = 'skipped'
         WHERE {_HELD} AND ws.received_at < CAST(:cut AS timestamptz)
        RETURNING ws.id, ws.title, ws.audience
    """), {"cut": (now or datetime.now(UTC)) - timedelta(days=ttl_days)})).all()
    for r in rows:
        await s.execute(text("""
            INSERT INTO wiki_log (op, title, detail, actor, audience) VALUES ('withdraw', :t, CAST(:d AS jsonb), 'wiki', CAST(:aud AS text[]))
        """), {"t": f"{r[1]} ({sources.short_id(str(r[0]))})", "aud": list(r[2]),
               "d": json.dumps({"source_id": str(r[0]), "reason": f"후보 기한 {ttl_days}일이 지났다"}, ensure_ascii=False)})
    return len(rows)


async def mine(s: AsyncSession, *, user: dict[str, Any]) -> list[dict[str, Any]]:
    book = await wiki_schema.load(s)
    ttl = book.spec.qa.candidate_ttl_days
    await expire(s, ttl_days=ttl)
    await s.commit()
    rows = (await s.execute(text(f"""
        SELECT ws.id, ws.kind, ws.title, ws.summary, ws.received_at, ws.consent, ws.origin_system, d.slug
          FROM wiki_sources ws LEFT JOIN documents d ON d.id = ws.doc_id
         WHERE {_HELD} AND ws.owner_user_id = CAST(:u AS uuid) ORDER BY ws.received_at DESC
    """), {"u": user["id"]})).all()
    return [{"id": str(r[0]), "short": sources.short_id(str(r[0])), "kind": r[1], "title": r[2], "summary": r[3] or "",
             "received_at": r[4].isoformat(), "expires_at": (r[4] + timedelta(days=ttl)).isoformat(),
             "suggested_audience": (_j(r[5]) or {}).get("suggested_audience") or [f"user:{user['id']}"],
             "system": r[6], "doc_slug": r[7]} for r in rows]


async def _held(s: AsyncSession, source_id: str, user: dict[str, Any]) -> Any:
    row = (await s.execute(text(f"""
        SELECT ws.id, ws.kind, ws.origin_system, ws.origin_ref, ws.origin_rev, ws.origin_url, ws.title, ws.payload,
               ws.subject_hints, ws.audience, ws.sensitivity, ws.owner_email, ws.consent, ws.captured_at, ws.received_at
          FROM wiki_sources ws WHERE ws.id = CAST(:i AS uuid) AND {_HELD} AND ws.owner_user_id = CAST(:u AS uuid)
           FOR UPDATE
    """), {"i": source_id, "u": user["id"]})).first()
    if row is None:
        raise NotFound(f"내 후보가 없다: {source_id}")
    return row


async def approve(s: AsyncSession, source_id: str, *, user: dict[str, Any], aud: list[str] | None) -> dict[str, Any]:
    book = await wiki_schema.load(s)
    ttl = book.spec.qa.candidate_ttl_days
    row = await _held(s, source_id, user)
    if row[14] < datetime.now(UTC) - timedelta(days=ttl):
        await expire(s, ttl_days=ttl)
        await s.commit()
        raise Conflict(f"후보 기한 {ttl}일이 지났다 — 철회했다")
    consent = _j(row[12]) or {}
    chosen = normalize_audience(aud or consent.get("suggested_audience") or list(row[9]))
    if chosen == list(row[9]):  # 나만으로 — 그 줄을 그대로 들인다
        await s.execute(text("UPDATE wiki_sources SET ingest_state = 'queued' WHERE id = CAST(:i AS uuid)"), {"i": source_id})
        await jobs.enqueue(s, "ingest", {"source_id": source_id}, created_by=str(user["id"]))
        new_id, dedup = source_id, False
    else:
        env = SourceEnvelope.model_validate({
            "schema": "mxwp-source/1", "kind": row[1],
            "origin": {"system": row[2], "ref": row[3], "rev": row[4], "url": row[5]},
            "title": row[6], "captured_at": row[13].isoformat(), "owner": {"email": row[11]}, "audience": chosen,
            "sensitivity": row[10], "subject_hints": _j(row[8]) or [], "body": _j(row[7]),
            "consent": {"by": consent.get("by") or row[11], "at": consent.get("at") or row[13].isoformat(),
                        "mode": "candidate", "note": consent.get("note")},
        })
        got = await sources.receive(s, env, caller=user, ingest=True, held=False)
        new_id, dedup = got.id, got.dedup
    await s.execute(text("""
        INSERT INTO wiki_log (op, title, detail, actor, audience) VALUES ('fileback', :t, CAST(:d AS jsonb), :a, CAST(:aud AS text[]))
    """), {"t": f"후보 승인 · {row[6]} ({sources.short_id(new_id)})", "a": f"user:{user['id']}", "aud": chosen,
           "d": json.dumps({"candidate": source_id, "source_id": new_id, "audience": chosen}, ensure_ascii=False)})
    await s.commit()
    return {"id": new_id, "short": sources.short_id(new_id), "candidate": source_id, "audience": chosen, "dedup": dedup}


async def discard(s: AsyncSession, source_id: str, *, user: dict[str, Any]) -> dict[str, Any]:
    await _held(s, source_id, user)
    return await sources.withdraw(s, source_id, caller=user)
