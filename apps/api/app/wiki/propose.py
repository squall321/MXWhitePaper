# 위키 제안 — 바깥 에이전트(게이트웨이 · MCP · Claude Code 등)와 사람이 위키 문서에 블록 · 관계 연산을 내면 늘 검토하는 변경 묶음으로 짓는다
"""CONTRACTS §4 · §7 `wiki_propose`(바깥 에이전트의 쓰기는 늘 검토 큐로).

- 고칠 문서는 이미 있는 위키 문서(원천 · 규칙서 · 목록 빼고)이고 부른 사람이 볼 수 있어야 한다(아니면 422) — 새 문서 · 엔티티는 원천을
  보내 들이기로(`POST /sources` · `wiki_submit_source`).
- 연산 꼴은 들이기의 쓰기 · 관계와 같다(`block.insert` · `block.update` · `block.delete` · 관계). 근거의 원천은 부른 사람이 볼 수
  있는 것만 — 못 보는 원천은 근거로 치지 않는다(V2).
- 검증 V1~V11 을 같은 코드로 돌리고 V6 은 늘 검토('바깥 제안은 늘 검토'). 실패가 있으면 `failed`, 아니면 `pending_review` — 자동 반영은
  없다. 묶음의 `created_by` 는 부른 사람, 계획에 부른 길(`via`).
- 승인 · 거절 · 되돌리기는 검토 큐 그대로(`review`), 반영은 `apply`(계획이 읽은 판과 같아야 — 아니면 판 충돌로 검토에 남는다).
"""
from __future__ import annotations

import hashlib
import json
from typing import Any

from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ValidationFailed
from app.wiki import audience, ingest, ontology, resolve, validate
from app.wiki import schema as wiki_schema
from app.wiki.apply import short_cs
from app.wiki.sources import visible_sql as source_visible_sql

_SKIP_KINDS = ("source", "schema", "index", "lint-report")


class ProposeBody(BaseModel):
    summary: str = Field(min_length=1, max_length=1000, description="이 제안이 무엇을 왜 고치나 한 문단")
    ops: list[ingest.InsertOp | ingest.UpdateOp | ingest.DeleteOp] = Field(default_factory=list, max_length=80)
    relations: list[ingest.PlanRelation] = Field(default_factory=list, max_length=40)


async def _targets(s: AsyncSession, slugs: list[str]) -> dict[str, resolve.Target]:
    rows = (await s.execute(text(f"""
        SELECT d.slug, d.id, d.version, d.title, d.content_json, wp.kind, wp.managed, wp.review_lock, wp.audience,
               wp.entity_id, e.type_key
          FROM documents d JOIN wiki_pages wp ON wp.doc_id = d.id LEFT JOIN wiki_entities e ON e.id = wp.entity_id
         WHERE d.slug = ANY(:s) AND wp.kind NOT IN {_SKIP_KINDS} AND d.status <> 'archived' AND {audience.visible_sql('d')}
    """), {"s": slugs, **audience.sql_params()})).all()
    out: dict[str, resolve.Target] = {}
    for slug, doc_id, version, title, content, kind, managed, lock, aud, entity_id, type_key in rows:
        key = type_key or ("sim-case" if slug.startswith("case-sim-") else "field-case" if slug.startswith("case-field-")
                           else kind)
        out[slug] = resolve.Target(
            slug=slug, kind=kind, type_key=key, title=title, audience=list(aud), exists=True, doc_id=str(doc_id),
            version=int(version), managed=managed, review_lock=bool(lock), entity_id=str(entity_id) if entity_id else None,
            content=json.loads(content) if isinstance(content, str) else content)
    return out


async def propose(s: AsyncSession, body: ProposeBody, *, user: dict[str, Any]) -> dict[str, Any]:
    if not body.ops and not body.relations:
        raise ValidationFailed("연산이 하나도 없다")
    slugs = sorted({op.doc for op in body.ops} | {r.subject for r in body.relations} | {r.object for r in body.relations})
    targets = await _targets(s, slugs)
    unseen = [x for x in slugs if x not in targets]
    if unseen:
        raise ValidationFailed("볼 수 없거나 고칠 수 있는 위키 문서가 아니다 — 새 문서는 원천을 보내 들인다", details={"slugs": unseen})
    preds = await ontology.predicates(s)
    ops = await ingest.normalize_ops(s, list(body.ops))
    ops += [{**ingest._relation_op(r.subject, r.predicate, r.object, [], r.confidence, r.why, "agent", preds),
             "cites": [{"sid": c.sid, "source_id": await ingest._resolve_sid(s, c.sid), "loc": c.loc, "quote": c.quote}
                       for c in r.cites]} for r in body.relations]
    cited = sorted({c["source_id"] for op in ops for c in op.get("cites") or [] if c.get("source_id")})
    seen = {str(r[0]) for r in (await s.execute(text(f"""
        SELECT ws.id FROM wiki_sources ws WHERE ws.id = ANY(CAST(:i AS uuid[])) AND {source_visible_sql('ws')}
    """), {"i": cited, **audience.sql_params()})).all()} if cited else set()
    for op in ops:
        for c in op.get("cites") or []:
            if c.get("source_id") not in seen:
                c["source_id"] = None  # 부른 사람이 못 보는 원천은 근거가 아니다 — V2 가 잡는다
    book = await wiki_schema.load(s)
    chosen = list(targets.values())
    base = {t.slug: t.content or {} for t in chosen}
    ctx = await ingest.build_context(s, book, chosen, base, ops, endpoints=targets, preds=preds)
    checks = [c.as_dict() for c in validate.run(ops, ctx)]
    for c in checks:
        if c["rule"] == "V6" and c["verdict"] != "fail":
            c["verdict"], c["detail"] = "review", "; ".join(x for x in (c["detail"], "바깥 제안은 늘 검토") if x)
    status = "failed" if any(c["verdict"] == "fail" for c in checks) else "pending_review"
    tokens = sorted({t for tg in chosen for t in tg.audience if t != "org"}) or ["org"]
    plan = {"summary": body.summary, "questions": [], "contradictions": [], "source_id": None, "sid": None,
            "via": str(user.get("auth_via") or "web"),
            "pages": [{"slug": t.slug, "kind": t.kind, "type_key": t.type_key, "title": t.title, "audience": t.audience,
                       "new": False, "version": t.version, "doc_id": t.doc_id, "entity_id": t.entity_id, "entity": None,
                       "why": ""} for t in chosen if any(op["doc"] == t.slug and op["op"].startswith("block.") for op in ops)],
            "endpoints": [{"slug": t.slug, "type_key": t.type_key, "title": t.title} for t in chosen]}
    digest = hashlib.sha256(json.dumps(ops, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()
    cs_id = str((await s.execute(text("""
        INSERT INTO wiki_changesets (op, trigger, schema_version, prompt_hash, plan, ops, validation, status, audience,
                                     created_by, finished_at)
        VALUES ('human_request', CAST(:trig AS jsonb), :sv, :ph, CAST(:plan AS jsonb), CAST(:ops AS jsonb),
                CAST(:val AS jsonb), :st, CAST(:aud AS text[]), CAST(:by AS uuid), CASE WHEN :st = 'failed' THEN NOW() END)
        RETURNING id
    """), {"trig": json.dumps({"kind": "propose", "via": plan["via"]}), "sv": book.version, "ph": digest,
           "plan": json.dumps(plan, ensure_ascii=False), "ops": json.dumps(ops, ensure_ascii=False),
           "val": json.dumps(checks, ensure_ascii=False), "st": status, "aud": tokens, "by": user["id"]})).scalar_one())
    await s.execute(text("""
        INSERT INTO wiki_log (op, title, detail, actor, changeset_id, audience)
        VALUES ('review', :t, CAST(:d AS jsonb), :a, CAST(:i AS uuid), CAST(:aud AS text[]))
    """), {"t": f"{short_cs(cs_id)} 제안 받음", "a": f"user:{user['id']}", "i": cs_id, "aud": tokens,
           "d": json.dumps({"decision": "제안", "via": plan["via"], "status": status, "docs": len(plan["pages"])},
                           ensure_ascii=False)})
    await s.commit()
    return {"id": cs_id, "short": short_cs(cs_id), "status": status, "validation": checks}
