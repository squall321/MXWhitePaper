# 위키 변경 묶음 반영 · 되돌리기 — document_service 길(ETag · 판 · 저장 훅 · 재색인)로 문서마다 저장하고 근거를 단다. 중간에 깨지면 되감는다
"""CONTRACTS §2-3 · §2-4 · request §5-5.

- 반영 — 계획의 문서마다 연산을 얹어(pages.apply_ops) 저장한다. 새 문서는 `create_document(wiki=…)`, 있는 문서는 `replace_document`
  (If-Match = 계획이 읽은 판 — 그 사이 바뀌었으면 `ApplyConflict`, 묶음은 사람이 본다). 자동 절 '원천' 은 같은 판에 다시 짓는다.
  저장은 문서마다 커밋되므로, 중간에 깨지면 이미 저장한 문서를 판 복원 · 보관으로 되감고 이 묶음의 근거를 지운다 — '함께 반영'.
- 원천 문서의 '이 원천을 인용한 문서' 에는 원천과 범위가 같은 문서만 싣는다 — 더 좁은 문서의 제목이 넓은 원천 문서에 새지 않게.
- 되돌리기 — 묶음이 저장한 판 위에 더 고친 것이 없을 때만(있으면 409). 새 문서는 보관, 있던 문서는 from 판으로 복원, 이 묶음이 만든
  엔티티는 retired.
- 지은이는 시스템(첫 admin) — 누가 불렀는지는 묶음의 created_by 가 남긴다.
"""
from __future__ import annotations

import json
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import APIError, Conflict, NotFound, PreconditionFailed
from app.services import document_service
from app.wiki import audience, pages
from app.wiki import schema as wiki_schema


class ApplyConflict(APIError):
    http_status = 409
    code = "wiki_apply_conflict"
    message = "문서가 그 사이 바뀌었다 — 사람이 본다"


def short_cs(cs_id: str) -> str:
    return "cs_" + cs_id.replace("-", "")[:8]


def _j(v: Any) -> Any:
    return json.loads(v) if isinstance(v, str) else v


async def wiki_author(s: AsyncSession) -> tuple[str, str]:
    row = (await s.execute(text("""
        SELECT id, email FROM users WHERE role = 'admin' AND is_active ORDER BY created_at LIMIT 1
    """))).first()
    if row is None:
        raise RuntimeError("위키 문서의 지은이로 쓸 admin 이 없다")
    return str(row[0]), str(row[1])


async def load_changeset(s: AsyncSession, cs_id: str, *, lock: bool = False) -> dict[str, Any]:
    row = (await s.execute(text(f"""
        SELECT id, op, status, plan, ops, validation, audience, applied, trigger, created_by, usage, schema_version,
               decided_by, decided_at, decision_note, created_at, finished_at, error, job_id, model
          FROM wiki_changesets WHERE id = CAST(:i AS uuid) {'FOR UPDATE' if lock else ''}
    """), {"i": cs_id})).first()
    if row is None:
        raise NotFound(f"변경 묶음이 없다: {cs_id}")
    keys = ["id", "op", "status", "plan", "ops", "validation", "audience", "applied", "trigger", "created_by", "usage",
            "schema_version", "decided_by", "decided_at", "decision_note", "created_at", "finished_at", "error", "job_id",
            "model"]
    cs = dict(zip(keys, row, strict=True))
    for k in ("plan", "ops", "validation", "applied", "trigger", "usage"):
        cs[k] = _j(cs[k])
    cs["id"] = str(cs["id"])
    cs["audience"] = list(cs["audience"])
    return cs


async def _doc(s: AsyncSession, *, slug: str | None = None, doc_id: str | None = None) -> dict[str, Any] | None:
    row = (await s.execute(text("""
        SELECT id, slug, version, content_json, status FROM documents
         WHERE (CAST(:slug AS text) IS NOT NULL AND slug = :slug) OR (CAST(:id AS text) IS NOT NULL AND id = CAST(:id AS uuid))
    """), {"slug": slug, "id": doc_id})).first()
    if row is None:
        return None
    return {"id": str(row[0]), "slug": row[1], "version": int(row[2]), "content": _j(row[3]), "status": row[4]}


async def _source_rows(s: AsyncSession, ids: list[str]) -> dict[str, dict[str, Any]]:
    rows = (await s.execute(text("""
        SELECT ws.id, ws.title, ws.kind, ws.audience, d.slug FROM wiki_sources ws LEFT JOIN documents d ON d.id = ws.doc_id
         WHERE ws.id = ANY(CAST(:ids AS uuid[]))
    """), {"ids": ids})).all()
    return {str(r[0]): {"title": r[1], "kind": r[2], "audience": list(r[3]), "slug": r[4]} for r in rows}


def _source_items(rows: dict[str, dict[str, Any]]) -> list[str]:
    return [f"[[{r['slug']}|{r['title']}]] · {r['kind']}" if r["slug"] else f"{r['title']} · {r['kind']}"
            for _, r in sorted(rows.items(), key=lambda kv: kv[1]["title"])]


async def _page_source_ids(s: AsyncSession, doc_id: str | None) -> set[str]:
    if doc_id is None:
        return set()
    return {str(r[0]) for r in (await s.execute(text(
        "SELECT DISTINCT source_id FROM wiki_citations WHERE doc_id = CAST(:d AS uuid)"), {"d": doc_id})).all()}


async def _set_citations(s: AsyncSession, doc_id: str, ops: list[dict[str, Any]], cs_id: str) -> None:
    for op in ops:
        block_id = op.get("block_id") or (op.get("block") or {}).get("id")
        if op["op"] in ("block.update", "block.delete"):
            await s.execute(text("DELETE FROM wiki_citations WHERE doc_id = CAST(:d AS uuid) AND block_id = :b"),
                            {"d": doc_id, "b": block_id})
        if op["op"] == "block.delete":
            continue
        for c in op.get("cites") or []:
            if not c.get("source_id"):
                continue
            await s.execute(text("""
                INSERT INTO wiki_citations (doc_id, block_id, source_id, locator, quote, changeset_id)
                VALUES (CAST(:d AS uuid), :b, CAST(:src AS uuid), CAST(:loc AS jsonb), :q, CAST(:cs AS uuid))
                ON CONFLICT DO NOTHING
            """), {"d": doc_id, "b": block_id, "src": c["source_id"], "loc": json.dumps(c.get("loc") or {}),
                   "q": (c.get("quote") or None), "cs": cs_id})


async def _ensure_entity(s: AsyncSession, entity: dict[str, Any], aud: list[str], cs_id: str) -> str:
    return str((await s.execute(text("""
        INSERT INTO wiki_entities (type_key, canonical_name, aliases, ext_ids, attrs, audience, created_by_changeset)
        VALUES (:t, :n, CAST(:a AS text[]), CAST(:e AS jsonb), CAST(:attrs AS jsonb), CAST(:aud AS text[]), CAST(:cs AS uuid))
        ON CONFLICT (type_key, lower(canonical_name)) WHERE status = 'active' DO UPDATE SET updated_at = NOW()
        RETURNING id
    """), {"t": entity["type_key"], "n": entity["canonical_name"], "a": entity.get("aliases") or [],
           "e": json.dumps(entity.get("ext_ids") or {}), "attrs": json.dumps(entity.get("attrs") or {}), "aud": aud,
           "cs": cs_id})).scalar_one())


async def refresh_source_doc(s: AsyncSession, source_id: str, author_id: str) -> None:
    """원천 문서의 '이 원천을 인용한 문서' — 원천과 범위가 같은 위키 문서만(보관된 것 빼고)."""
    src = (await s.execute(text("""
        SELECT ws.audience, d.slug FROM wiki_sources ws JOIN documents d ON d.id = ws.doc_id
         WHERE ws.id = CAST(:i AS uuid) AND d.status <> 'archived'
    """), {"i": source_id})).first()
    if src is None:
        return
    rows = (await s.execute(text("""
        SELECT DISTINCT d.slug, d.title FROM wiki_citations c
          JOIN documents d ON d.id = c.doc_id JOIN wiki_pages wp ON wp.doc_id = d.id
         WHERE c.source_id = CAST(:i AS uuid) AND d.status <> 'archived' AND wp.audience = CAST(:aud AS text[])
         ORDER BY d.title
    """), {"i": source_id, "aud": list(src[0])})).all()
    doc = await _doc(s, slug=src[1])
    if doc is None:
        return
    content = dict(doc["content"])
    before = json.dumps(content, sort_keys=True)
    pages.set_auto_list(content, "이 원천을 인용한 문서", [f"[[{r[0]}|{r[1]}]]" for r in rows],
                        empty="아직 이 원천을 인용한 문서가 없다.")
    if json.dumps(content, sort_keys=True) == before:
        return
    with audience.acting_as(audience.SYSTEM):
        await document_service.replace_document(
            s, slug=doc["slug"], payload=content, if_match=document_service.make_etag(doc["id"], doc["version"]),
            actor_id=author_id, change_log="wiki source cited-by")  # 판 메모는 ASCII 80자까지


async def apply(s: AsyncSession, cs_id: str, *, status: str) -> dict[str, list[int]]:
    """묶음을 반영하고 `status`(auto_applied · applied)로 적는다. 돌려주는 것은 {doc_id: [from, to]}."""
    cs = await load_changeset(s, cs_id)
    plan, ops = cs["plan"], cs["ops"]
    author_id, author_email = await wiki_author(s)
    book = await wiki_schema.load(s)
    division = get_settings().import_default_division
    short = short_cs(cs_id)
    applied: dict[str, list[int]] = {}
    slugs: dict[str, str] = {}
    try:
        for page in plan.get("pages") or []:
            slug = page["slug"]
            doc_ops = [op for op in ops if op["doc"] == slug]
            cited = await _source_rows(s, sorted({c["source_id"] for op in doc_ops for c in op.get("cites") or []
                                                  if c.get("source_id")}))
            if page.get("new"):
                if await _doc(s, slug=slug) is not None:
                    raise ApplyConflict(f"새로 만들 문서가 그 사이 생겼다: {slug}")
                content = pages.apply_ops(page.get("skeleton") or pages.skeleton(
                    book, slug=slug, type_key=page["type_key"], title=page["title"], summary="",
                    owners=[author_email], division=division), doc_ops)
                pages.set_auto_list(content, "원천", _source_items(cited), empty="아직 원천이 없다.")
                with audience.acting_as(audience.SYSTEM):
                    doc, _ = await document_service.create_document(
                        s, payload=content, owner_id=author_id,
                        wiki={"kind": page["kind"], "audience": page["audience"], "managed": "ai"})
                entity_id = page.get("entity_id")
                if page.get("entity"):
                    entity_id = await _ensure_entity(s, page["entity"], page["audience"], cs_id)
                await s.execute(text("""
                    UPDATE wiki_pages SET entity_id = CAST(:e AS uuid), last_changeset_id = CAST(:cs AS uuid),
                           schema_version = :sv WHERE doc_id = CAST(:d AS uuid)
                """), {"e": entity_id, "cs": cs_id, "sv": cs["schema_version"], "d": doc["id"]})
                applied[doc["id"]] = [0, int(doc["version"])]
            else:
                cur = await _doc(s, slug=slug)
                if cur is None or cur["version"] != page["version"] or cur["status"] == "archived":
                    raise ApplyConflict(f"{slug} 이 계획 뒤에 바뀌었다(판 {page['version']} → "
                                        f"{cur['version'] if cur else '없음'})")
                content = pages.apply_ops(cur["content"], doc_ops)
                cited.update(await _source_rows(s, sorted(await _page_source_ids(s, cur["id"]))))
                pages.set_auto_list(content, "원천", _source_items(cited), empty="아직 원천이 없다.")
                with audience.acting_as(audience.SYSTEM):
                    try:
                        doc, _ = await document_service.replace_document(
                            s, slug=slug, payload=content, if_match=document_service.make_etag(cur["id"], cur["version"]),
                            actor_id=author_id, change_log=f"wiki {short}")
                    except PreconditionFailed as e:
                        raise ApplyConflict(f"{slug} 저장이 판 충돌로 막혔다") from e
                await s.execute(text("""
                    UPDATE wiki_pages SET last_changeset_id = CAST(:cs AS uuid), updated_at = NOW()
                     WHERE doc_id = CAST(:d AS uuid)
                """), {"cs": cs_id, "d": cur["id"]})
                applied[cur["id"]] = [cur["version"], int(doc["version"])]
            slugs[doc["id"]] = slug
            await _set_citations(s, doc["id"], doc_ops, cs_id)
            await s.commit()
        for source_id in sorted({c["source_id"] for op in ops for c in op.get("cites") or [] if c.get("source_id")}):
            await refresh_source_doc(s, source_id, author_id)
        await s.execute(text("""
            UPDATE wiki_changesets SET status = :st, applied = CAST(:a AS jsonb), finished_at = NOW(), error = NULL
             WHERE id = CAST(:i AS uuid)
        """), {"st": status, "a": json.dumps(applied), "i": cs_id})
        await s.commit()
        return applied
    except Exception:
        await s.rollback()
        await _unwind(s, cs_id, applied, slugs, author_id)
        raise


async def _unwind(s: AsyncSession, cs_id: str, applied: dict[str, list[int]], slugs: dict[str, str],
                  author_id: str) -> None:
    with audience.acting_as(audience.SYSTEM):
        for doc_id, (frm, _to) in applied.items():
            if frm == 0:
                await document_service.archive_document(s, slug=slugs[doc_id], actor_id=author_id)
            else:
                await document_service.restore_version(s, slug=slugs[doc_id], version=frm, actor_id=author_id)
    await s.execute(text("DELETE FROM wiki_citations WHERE changeset_id = CAST(:i AS uuid)"), {"i": cs_id})
    # 이 묶음이 만든 엔티티 — 그 뒤 다른 묶음의 문서가 쓰고 있으면 두고, 살아 있는 문서가 없을 때만 retired.
    await s.execute(text("""
        UPDATE wiki_entities e SET status = 'retired', updated_at = NOW()
         WHERE e.created_by_changeset = CAST(:i AS uuid)
           AND NOT EXISTS (SELECT 1 FROM wiki_pages wp JOIN documents d ON d.id = wp.doc_id
                            WHERE wp.entity_id = e.id AND d.status <> 'archived')
    """), {"i": cs_id})
    await s.commit()


async def revert(s: AsyncSession, cs_id: str, *, actor_id: str) -> dict[str, Any]:
    cs = await load_changeset(s, cs_id, lock=True)
    if cs["status"] not in ("applied", "auto_applied"):
        raise Conflict(f"반영된 묶음만 되돌린다(지금 {cs['status']})")
    docs: dict[str, dict[str, Any]] = {}
    for doc_id, (_frm, to) in cs["applied"].items():
        cur = await _doc(s, doc_id=doc_id)
        if cur is None or cur["version"] != to:
            raise Conflict(f"{cur['slug'] if cur else doc_id} 이 이 묶음 뒤에 또 바뀌었다 — 사람이 되돌린다")
        docs[doc_id] = cur
    author_id, _ = await wiki_author(s)
    await _unwind(s, cs_id, dict(cs["applied"]), {d: docs[d]["slug"] for d in docs}, author_id)
    for source_id in sorted({c["source_id"] for op in cs["ops"] for c in op.get("cites") or [] if c.get("source_id")}):
        await refresh_source_doc(s, source_id, author_id)
    await s.execute(text("""
        UPDATE wiki_changesets SET status = 'reverted', decided_by = CAST(:u AS uuid), decided_at = NOW()
         WHERE id = CAST(:i AS uuid)
    """), {"u": actor_id, "i": cs_id})
    await s.execute(text("""
        INSERT INTO wiki_log (op, title, detail, actor, changeset_id, audience)
        VALUES ('revert', :t, CAST(:d AS jsonb), :a, CAST(:i AS uuid), CAST(:aud AS text[]))
    """), {"t": f"{short_cs(cs_id)} 되돌림", "d": json.dumps({"docs": len(docs)}), "a": f"user:{actor_id}", "i": cs_id,
           "aud": cs["audience"]})
    await s.commit()
    return {"id": cs_id, "status": "reverted", "docs": len(docs)}
