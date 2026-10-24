# 위키 검토 큐 — 변경 묶음 목록 · 한 건(문서별 앞 · 뒤 · 검증 · 근거) · 승인 · 거절 · 되돌리기. 검토자 = wiki_reviewer 표지 또는 admin
"""request §5-5 · CONTRACTS §2-4 · 사용자 결정 Q7(새 표지 `wiki_reviewer` + 대상 문서 owners).

- 묶음을 보려면 그 범위 토큰을 모두 가져야 한다(admin 은 다). 표지가 있어도 범위 밖 묶음은 없는 묶음(404)이다.
- 대상 문서 owners — W4 의 묶음은 AI 문서만 건드리고 AI 문서의 owners 는 시스템(admin)이라 표지 · admin 으로 충분하다. 사람 문서에
  제안이 닿는 길(W6 `wiki_propose`)이 생기면 그 문서의 owners 를 여기에 더한다.
- 근거 미리보기는 읽는 사람이 볼 수 있는 원천만 제목을 보인다(V4 에 걸린 묶음은 더 좁은 원천을 인용했을 수 있다).
- 관계(W5)는 문서 연산과 따로 `relations` 에 — 주어 · 술어 이름 · 목적어 · 까닭 · 코드/AI · 근거. 합치기는 `merges` 에 — 두 엔티티의
  제안 때 모습과(반영했으면) 다시 이은 문서 · 낡음 표시 · 다시 들일 원천.
"""
from __future__ import annotations

import json
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import Conflict, Forbidden, NotFound, ValidationFailed
from app.repos import document_repo
from app.wiki import apply as wiki_apply
from app.wiki import audience, pages
from app.wiki import schema as wiki_schema
from app.wiki.sources import short_id, visible_sql

_VISIBLE = "(CAST(:_aud_all AS boolean) OR c.audience <@ CAST(:_aud_tokens AS text[]))"


async def is_reviewer(s: AsyncSession, user: dict[str, Any]) -> bool:
    if audience.viewer_from_user(user).is_admin:
        return True
    return bool((await s.execute(text("SELECT wiki_reviewer FROM users WHERE id = CAST(:u AS uuid)"),
                                 {"u": str(user["id"])})).scalar())


async def require_reviewer(s: AsyncSession, user: dict[str, Any]) -> None:
    if not await is_reviewer(s, user):
        raise Forbidden("위키 검토자(wiki_reviewer) · admin 만 본다")


def _row(r: Any) -> dict[str, Any]:
    plan = wiki_apply._j(r[4]) or {}
    validation = wiki_apply._j(r[5]) or []
    return {
        "id": str(r[0]), "short": wiki_apply.short_cs(str(r[0])), "op": r[1], "status": r[2],
        "created_at": r[3].isoformat(), "source": {"id": plan.get("source_id"), "short": plan.get("sid")},
        "docs": [{"slug": p["slug"], "title": p["title"], "new": p.get("new", False)} for p in plan.get("pages") or []]
        or ([{"slug": "", "title": plan["summary"], "new": False}] if plan.get("merge") else []),
        "rules": [c["rule"] for c in validation if c["verdict"] in ("fail", "review")],
        "audience": list(r[6]), "error": r[7],
    }


async def list_changes(s: AsyncSession, *, status: str | None, limit: int, offset: int) -> tuple[list[dict], int]:
    params: dict[str, Any] = {**audience.sql_params(), "limit": limit, "offset": offset}
    cond = _VISIBLE
    if status:
        cond += " AND c.status = :st"
        params["st"] = status
    total = (await s.execute(text(f"SELECT COUNT(*) FROM wiki_changesets c WHERE {cond}"), params)).scalar_one()
    rows = (await s.execute(text(f"""
        SELECT c.id, c.op, c.status, c.created_at, c.plan, c.validation, c.audience, c.error
          FROM wiki_changesets c WHERE {cond} ORDER BY c.created_at DESC LIMIT :limit OFFSET :offset
    """), params)).all()
    return [_row(r) for r in rows], int(total)


async def _visible_change(s: AsyncSession, cs_id: str) -> dict[str, Any]:
    ok = (await s.execute(text(f"SELECT 1 FROM wiki_changesets c WHERE c.id = CAST(:i AS uuid) AND {_VISIBLE}"),
                          {"i": cs_id, **audience.sql_params()})).first()
    if ok is None:
        raise NotFound(f"변경 묶음이 없다: {cs_id}")
    return await wiki_apply.load_changeset(s, cs_id)


async def get_change(s: AsyncSession, cs_id: str) -> dict[str, Any]:
    """한 건 — 문서마다 연산의 앞 · 뒤 글 · 까닭 · 근거(볼 수 있는 원천만 제목). 앞은 계획이 읽은 판(새 문서는 빈 꼴)."""
    cs = await _visible_change(s, cs_id)
    plan = cs["plan"]
    source_ids = sorted({c["source_id"] for op in cs["ops"] for c in op.get("cites") or [] if c.get("source_id")})
    seen = {str(r[0]): {"title": r[1], "kind": r[2]} for r in (await s.execute(text(f"""
        SELECT ws.id, ws.title, ws.kind FROM wiki_sources ws WHERE ws.id = ANY(CAST(:ids AS uuid[])) AND {visible_sql('ws')}
    """), {"ids": source_ids, **audience.sql_params()})).all()}
    book = await wiki_schema.load(s)
    docs = []
    for page in plan.get("pages") or []:
        doc_ops = wiki_apply.block_ops(cs["ops"], page["slug"])
        before = page.get("skeleton") or {}
        if not page.get("new") and page.get("doc_id"):
            ver = await document_repo.find_version(s, doc_id=page["doc_id"], version=page["version"])
            if ver:
                before = wiki_apply._j(ver["content_json"])
            else:  # 판 기록이 없는 문서(옛 · 가져온) — 지금 판이 계획의 판이면 지금 내용이 '앞' 이다
                cur = await wiki_apply._doc(s, doc_id=page["doc_id"])
                before = cur["content"] if cur and cur["version"] == page["version"] else {}
        try:
            after = pages.apply_ops(before, doc_ops)
        except pages.PageOpError:
            after = before
        owners = {spec.title: spec.owner for spec in book.sections(page["type_key"])}
        items = []
        for op in doc_ops:
            block_id = op.get("block_id") or (op.get("block") or {}).get("id")
            old = pages.find_block(before, block_id) if op["op"] != "block.insert" else None
            new = pages.find_block(after, block_id) if op["op"] != "block.delete" else None
            items.append({
                "op": op["op"], "block_id": block_id, "why": op.get("why", ""),
                "section": op.get("section") or (old[0].get("title") if old else None),
                "before": pages.block_text(old[0]["blocks"][old[1]]) if old else None,
                "after": pages.block_text(new[0]["blocks"][new[1]]) if new else None,
                "cites": [{"sid": c.get("sid"), "short": short_id(c["source_id"]) if c.get("source_id") else c.get("sid"),
                           "title": (seen.get(c.get("source_id") or "") or {}).get("title") or "(볼 수 없는 원천)",
                           "loc": c.get("loc") or {}, "quote": c.get("quote")} for c in op.get("cites") or []],
            })
        docs.append({"slug": page["slug"], "title": page["title"], "new": page.get("new", False),
                     "kind": page["kind"], "type_key": page["type_key"], "audience": page["audience"],
                     "why": page.get("why", ""), "ops": items,
                     "sections": [{"title": sec.get("title"), "owner": owners.get(sec.get("title"), "ai")}
                                  for sec in pages.walk_sections(after)]})
    titles = {p["slug"]: p["title"] for p in [*(plan.get("endpoints") or []), *(plan.get("pages") or [])]}
    labels = {r[0]: r[1] for r in (await s.execute(text("SELECT key, label_ko FROM wiki_predicates"))).all()}
    relations = [{
        "subject": op["subject"], "subject_title": titles.get(op["subject"], op["subject"]), "predicate": op["predicate"],
        "label": labels.get(op["predicate"], op["predicate"]), "object": op["object"],
        "object_title": titles.get(op["object"], op["object"]), "why": op.get("why", ""), "origin": op.get("origin", "llm"),
        "confidence": op.get("confidence"),
        "cites": [{"short": short_id(c["source_id"]) if c.get("source_id") else c.get("sid"),
                   "title": (seen.get(c.get("source_id") or "") or {}).get("title") or "(볼 수 없는 원천)"}
                  for c in op.get("cites") or []],
    } for op in cs["ops"] if op["op"] == "relation.add"]
    done = {(m["from"], m["into"]): m for m in (cs["applied"].get("merges") or [])}
    merges = [{"from": plan["merge"]["from"], "into": plan["merge"]["into"], "why": op.get("why", ""),
               "applied": done.get((op["from"], op["into"]))} for op in cs["ops"] if op["op"] == "entity.merge"
              and plan.get("merge")]
    return {"id": cs["id"], "short": wiki_apply.short_cs(cs["id"]), "op": cs["op"], "status": cs["status"],
            "created_at": cs["created_at"].isoformat(), "schema_version": cs["schema_version"], "model": cs["model"],
            "summary": plan.get("summary", ""), "questions": plan.get("questions", []),
            "contradictions": plan.get("contradictions", []), "source": {"id": plan.get("source_id"), "short": plan.get("sid")},
            "validation": cs["validation"], "audience": cs["audience"], "usage": cs["usage"], "error": cs["error"],
            "decision": {"by": str(cs["decided_by"]) if cs["decided_by"] else None,
                         "at": cs["decided_at"].isoformat() if cs["decided_at"] else None, "note": cs["decision_note"]},
            "docs": docs, "relations": relations, "relations_dropped": plan.get("relations_dropped", []), "merges": merges}


async def _decide_log(s: AsyncSession, cs: dict[str, Any], user_id: str, decision: str, note: str | None) -> None:
    await s.execute(text("""
        INSERT INTO wiki_log (op, title, detail, actor, changeset_id, audience)
        VALUES ('review', :t, CAST(:d AS jsonb), :a, CAST(:i AS uuid), CAST(:aud AS text[]))
    """), {"t": f"{wiki_apply.short_cs(cs['id'])} {decision}", "a": f"user:{user_id}", "i": cs["id"], "aud": cs["audience"],
           "d": json.dumps({"decision": decision, "note": note or "", "docs": len(cs["plan"].get("pages") or [])},
                           ensure_ascii=False)})


async def approve(s: AsyncSession, cs_id: str, *, user: dict[str, Any], note: str | None) -> dict[str, Any]:
    await require_reviewer(s, user)
    cs = await _visible_change(s, cs_id)
    if cs["status"] != "pending_review":
        raise Conflict(f"검토 대기 묶음만 승인한다(지금 {cs['status']})")
    if any(c["verdict"] == "fail" for c in cs["validation"]):
        raise Conflict("검증에 실패한 규칙이 있는 묶음은 승인하지 않는다 — 거절하고 다시 들인다")
    await s.execute(text("""
        UPDATE wiki_changesets SET status = 'approved', decided_by = CAST(:u AS uuid), decided_at = NOW(),
               decision_note = :n WHERE id = CAST(:i AS uuid)
    """), {"u": str(user["id"]), "n": note, "i": cs_id})
    await s.commit()
    try:
        applied = await wiki_apply.apply(s, cs_id, status="applied")
    except wiki_apply.ApplyConflict as e:
        await s.execute(text("UPDATE wiki_changesets SET status = 'pending_review', error = :e WHERE id = CAST(:i AS uuid)"),
                        {"e": e.message, "i": cs_id})
        await s.commit()
        raise
    await _decide_log(s, cs, str(user["id"]), "승인", note)
    await s.commit()
    return {"id": cs_id, "status": "applied", "docs": len(applied)}


async def reject(s: AsyncSession, cs_id: str, *, user: dict[str, Any], note: str | None) -> dict[str, Any]:
    await require_reviewer(s, user)
    if not (note or "").strip():
        raise ValidationFailed("거절에는 까닭 한 줄이 있어야 한다")
    cs = await _visible_change(s, cs_id)
    if cs["status"] not in ("pending_review", "failed"):
        raise Conflict(f"검토 대기 · 실패 묶음만 거절한다(지금 {cs['status']})")
    await s.execute(text("""
        UPDATE wiki_changesets SET status = 'rejected', decided_by = CAST(:u AS uuid), decided_at = NOW(),
               decision_note = :n, finished_at = NOW() WHERE id = CAST(:i AS uuid)
    """), {"u": str(user["id"]), "n": note, "i": cs_id})
    await _decide_log(s, cs, str(user["id"]), "거절", note)
    await s.commit()
    return {"id": cs_id, "status": "rejected"}


async def revert(s: AsyncSession, cs_id: str, *, user: dict[str, Any]) -> dict[str, Any]:
    await require_reviewer(s, user)
    await _visible_change(s, cs_id)
    return await wiki_apply.revert(s, cs_id, actor_id=str(user["id"]))
