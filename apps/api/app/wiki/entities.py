# 위키 엔티티 등록부 — 목록 · 한 건 · 별칭 · 외부 id 고치기 · 중복 후보 · 합치기(늘 검토하는 변경 묶음)의 반영 · 되돌리기
"""request §5-10 · CONTRACTS §2-6 · §4(`entity.merge` — 늘 검토).

- 보이기 — 엔티티는 읽는 사람이 볼 수 있는 문서가 하나라도 있을 때 보인다(admin 은 다). 별칭 · 외부 id · 속성은 엔티티를 처음 만든
  범위(`audience`)의 토큰을 다 가진 사람만 본다(`full`) — 좁은 원천이 단 외부 id(BOM 코드 등)가 넓은 문서의 사람에게 새지 않게.
- 고치기(별칭 · 외부 id)는 `full` 인 editor. 같은 유형의 다른 살아 있는 엔티티 이름 · 별칭 · 외부 id 와 겹치면 409.
- 합치기 — `from` 을 `into` 로. 늘 검토(V6). 유형이 다르거나 살아 있지 않거나 같은 외부 id 칸의 값이 다르면 V7 실패, `from` 범위의
  토큰이 `into` 범위에 없으면 V4 실패(좁은 이름 · 외부 id 가 넓은 엔티티로 샌다). 반영하면 `from` 은 merged(merged_into), 이름 · 별칭은
  `into` 의 별칭으로, 없던 외부 id 는 `into` 로, 문서는 `into` 로 다시 잇는다. 같은 범위에 `into` 문서가 이미 있으면 옮겨 온 문서에 낡음
  표시(`stale_since`)만 — 보관 · 다시 들이기는 사람이 고른다(`reingest` 원천). 되돌리기는 이 모두를 돌린다.
"""
from __future__ import annotations

import json
import re
import unicodedata
from typing import Any

from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import Conflict, NotFound, ValidationFailed
from app.repos import document_repo
from app.wiki import audience
from app.wiki.apply import ApplyConflict, short_cs

_PUNCT = re.compile(r"[\s\-_.·/()\[\]]+")
_EXT_KEY = re.compile(r"^[a-z][a-z0-9_]{1,40}$")
_VISIBLE = f"""(CAST(:_aud_all AS boolean) OR EXISTS (
    SELECT 1 FROM wiki_pages _ep JOIN documents d ON d.id = _ep.doc_id
     WHERE _ep.entity_id = e.id AND d.status <> 'archived' AND {audience.visible_sql('d')}))"""
_COLS = """e.id, e.type_key, t.label_ko, e.canonical_name, e.aliases, e.ext_ids, e.attrs, e.audience, e.status, e.merged_into,
           e.created_at, e.updated_at"""


def strong_key(name: str) -> str:
    """중복 찾기 열쇠 — NFKC · casefold · 공백과 흔한 구두점(-_.·/()[]) 없앰."""
    return _PUNCT.sub("", unicodedata.normalize("NFKC", name)).casefold()


def _full(aud: list[str], viewer: audience.Viewer) -> bool:
    return viewer.sees_all or set(aud) <= set(viewer.tokens)


def _j(v: Any) -> Any:
    return json.loads(v) if isinstance(v, str) else v


def _row(r: Any) -> dict[str, Any]:
    return {"id": str(r[0]), "type_key": r[1], "type_label": r[2], "name": r[3], "aliases": list(r[4]), "ext_ids": _j(r[5]),
            "attrs": _j(r[6]), "audience": list(r[7]), "status": r[8], "merged_into": str(r[9]) if r[9] else None,
            "created_at": r[10].isoformat(), "updated_at": r[11].isoformat()}


def _out(e: dict[str, Any], pages: list[dict[str, Any]], viewer: audience.Viewer) -> dict[str, Any]:
    full = _full(e["audience"], viewer)
    out = {k: e[k] for k in ("id", "type_key", "type_label", "name", "status", "merged_into", "created_at", "updated_at")}
    out.update(full=full, pages=pages, aliases=e["aliases"] if full else [], ext_ids=e["ext_ids"] if full else {},
               attrs=e["attrs"] if full else {})
    return out


async def _pages(s: AsyncSession, ids: list[str]) -> dict[str, list[dict[str, Any]]]:
    rows = (await s.execute(text(f"""
        SELECT wp.entity_id, d.slug, d.title, wp.audience, wp.stale_since FROM wiki_pages wp JOIN documents d ON d.id = wp.doc_id
         WHERE wp.entity_id = ANY(CAST(:ids AS uuid[])) AND d.status <> 'archived' AND {audience.visible_sql('d')}
         ORDER BY d.title
    """), {"ids": ids, **audience.sql_params()})).all()
    out: dict[str, list[dict[str, Any]]] = {}
    for r in rows:
        out.setdefault(str(r[0]), []).append({"slug": r[1], "title": r[2], "audience": list(r[3]),
                                              "stale_since": r[4].isoformat() if r[4] else None})
    return out


async def list_entities(s: AsyncSession, *, type_key: str | None, q: str | None, status: str, limit: int,
                        offset: int) -> tuple[list[dict[str, Any]], int]:
    viewer = audience.current_viewer()
    where, params = ["e.status = :st", _VISIBLE], {"st": status, **audience.sql_params(), "limit": limit, "offset": offset}
    if type_key:
        where.append("e.type_key = :t")
        params["t"] = type_key
    if q:
        # 별칭은 admin 만 찾는다 — 좁은 범위가 단 별칭이 있는지 없는지를 넓은 사람이 떠보지 않게.
        where.append("(e.canonical_name ILIKE :q" + (" OR EXISTS (SELECT 1 FROM unnest(e.aliases) _a WHERE _a ILIKE :q))"
                                                     if viewer.sees_all else ")"))
        params["q"] = f"%{q}%"
    cond = " AND ".join(where)
    total = (await s.execute(text(f"SELECT COUNT(*) FROM wiki_entities e WHERE {cond}"), params)).scalar_one()
    rows = [_row(r) for r in (await s.execute(text(f"""
        SELECT {_COLS} FROM wiki_entities e JOIN wiki_entity_types t ON t.key = e.type_key
         WHERE {cond} ORDER BY e.type_key, lower(e.canonical_name) LIMIT :limit OFFSET :offset
    """), params)).all()]
    pages = await _pages(s, [e["id"] for e in rows])
    return [_out(e, pages.get(e["id"], []), viewer) for e in rows], int(total)


async def _load(s: AsyncSession, entity_id: str, *, lock: bool = False) -> dict[str, Any] | None:
    row = (await s.execute(text(f"""
        SELECT {_COLS} FROM wiki_entities e JOIN wiki_entity_types t ON t.key = e.type_key
         WHERE e.id = CAST(:i AS uuid) {'FOR UPDATE OF e' if lock else ''}
    """), {"i": entity_id})).first()
    return _row(row) if row else None


async def _visible(s: AsyncSession, entity_id: str, *, lock: bool = False) -> dict[str, Any]:
    ok = (await s.execute(text(f"SELECT 1 FROM wiki_entities e WHERE e.id = CAST(:i AS uuid) AND {_VISIBLE}"),
                          {"i": entity_id, **audience.sql_params()})).first()
    e = await _load(s, entity_id, lock=lock) if ok else None
    if e is None:
        raise NotFound(f"엔티티가 없다: {entity_id}")
    return e


async def get_entity(s: AsyncSession, entity_id: str) -> dict[str, Any]:
    viewer = audience.current_viewer()
    e = await _visible(s, entity_id)
    out = _out(e, (await _pages(s, [e["id"]])).get(e["id"], []), viewer)
    out["merged_from"] = [{"id": str(r[0]), "name": r[1]} for r in (await s.execute(text("""
        SELECT id, canonical_name FROM wiki_entities WHERE merged_into = CAST(:i AS uuid) ORDER BY canonical_name
    """), {"i": e["id"]})).all()] if out["full"] else []
    return out


class EntityPatch(BaseModel):
    aliases: list[str] | None = Field(default=None, max_length=50, description="별칭 전부(바꿔 넣는다)")
    ext_ids: dict[str, str] | None = Field(default=None, description="외부 id 전부(바꿔 넣는다) — 칸 이름은 유형의 ext_axes.ext_ids")


async def _clash(s: AsyncSession, e: dict[str, Any], aliases: list[str], ext_ids: dict[str, str]) -> None:
    others = (await s.execute(text("""
        SELECT id, canonical_name, aliases, ext_ids FROM wiki_entities
         WHERE type_key = :t AND status = 'active' AND id <> CAST(:i AS uuid)
    """), {"t": e["type_key"], "i": e["id"]})).all()
    mine = {strong_key(a): a for a in aliases}
    for r in others:
        for name in [r[1], *r[2]]:
            if strong_key(name) in mine:
                raise Conflict(f"별칭 {mine[strong_key(name)]} 이 다른 엔티티와 겹친다", details={"entity_id": str(r[0])})
        theirs = _j(r[3]) or {}
        for key, value in ext_ids.items():
            if theirs.get(key) == value:
                raise Conflict(f"외부 id {key}={value} 를 다른 엔티티가 쓴다", details={"entity_id": str(r[0])})


async def update_entity(s: AsyncSession, entity_id: str, body: EntityPatch, *, user: dict[str, Any]) -> dict[str, Any]:
    viewer = audience.current_viewer()
    e = await _visible(s, entity_id, lock=True)
    if e["status"] != "active" or not _full(e["audience"], viewer):
        raise NotFound(f"고칠 수 있는 엔티티가 없다: {entity_id}")
    aliases = e["aliases"]
    if body.aliases is not None:
        seen: dict[str, str] = {}
        for a in (x.strip() for x in body.aliases):
            if not a or len(a) > 200:
                raise ValidationFailed("별칭은 1~200자")
            if strong_key(a) != strong_key(e["name"]):
                seen.setdefault(strong_key(a), a)
        aliases = list(seen.values())
    ext_ids = e["ext_ids"]
    if body.ext_ids is not None:
        bad = [k for k, v in body.ext_ids.items() if not _EXT_KEY.match(k) or not v.strip() or len(v) > 200]
        if bad:
            raise ValidationFailed(f"외부 id 칸이 틀렸다 — {', '.join(bad)}", details={"keys": bad})
        ext_ids = {k: v.strip() for k, v in body.ext_ids.items()}
    await _clash(s, e, aliases, ext_ids)
    await s.execute(text("""
        UPDATE wiki_entities SET aliases = CAST(:a AS text[]), ext_ids = CAST(:x AS jsonb), updated_at = NOW()
         WHERE id = CAST(:i AS uuid)
    """), {"a": aliases, "x": json.dumps(ext_ids, ensure_ascii=False), "i": e["id"]})
    detail = {"action": "entity.edit", "entity": e["id"], "name": e["name"],
              "aliases_added": sorted(set(aliases) - set(e["aliases"])), "aliases_removed": sorted(set(e["aliases"]) - set(aliases)),
              "ext_ids": ext_ids}
    await _log(s, f"엔티티 고침 · {e['name']}", detail, e["audience"], user)
    await document_repo.insert_audit(s, user_id=user["id"], action="wiki.entity.edit", target=f"wiki_entity:{e['id']}",
                                     payload=detail)
    await s.commit()
    return await get_entity(s, e["id"])


async def _log(s: AsyncSession, title: str, detail: dict[str, Any], aud: list[str], user: dict[str, Any],
               cs_id: str | None = None) -> None:
    await s.execute(text("""
        INSERT INTO wiki_log (op, title, detail, actor, changeset_id, audience)
        VALUES ('ontology', :t, CAST(:d AS jsonb), :a, CAST(:cs AS uuid), CAST(:aud AS text[]))
    """), {"t": title, "d": json.dumps(detail, ensure_ascii=False), "a": f"user:{user['id']}", "cs": cs_id, "aud": aud})


async def duplicates(s: AsyncSession) -> list[dict[str, Any]]:
    """같은 개체로 보이는 짝 — 같은 유형에서 이름 · 별칭의 열쇠(strong_key)가 같거나 같은 외부 id. 둘 다 `full` 인 것만."""
    viewer = audience.current_viewer()
    rows = [_row(r) for r in (await s.execute(text(f"""
        SELECT {_COLS} FROM wiki_entities e JOIN wiki_entity_types t ON t.key = e.type_key
         WHERE e.status = 'active' AND {_VISIBLE} ORDER BY e.created_at
    """), audience.sql_params())).all()]
    rows = [e for e in rows if _full(e["audience"], viewer)]
    seen: dict[tuple[str, str, str], dict[str, Any]] = {}
    pairs: dict[tuple[str, str], dict[str, Any]] = {}
    for e in rows:
        keys = [("name", strong_key(n)) for n in [e["name"], *e["aliases"]]]
        keys += [(f"ext:{k}", str(v)) for k, v in (e["ext_ids"] or {}).items()]
        for why, key in keys:
            first = seen.setdefault((e["type_key"], why, key), e)
            if first["id"] != e["id"]:
                pair = (first["id"], e["id"])
                pairs.setdefault(pair, {"type_key": e["type_key"], "why": why,
                                        "a": {"id": first["id"], "name": first["name"], "audience": first["audience"]},
                                        "b": {"id": e["id"], "name": e["name"], "audience": e["audience"]}})
    return list(pairs.values())


def merge_checks(fr: dict[str, Any], into: dict[str, Any]) -> list[dict[str, str]]:
    """합치기 검증 — V4 범위 · V6 늘 검토 · V7 유형 · 상태 · 외부 id. 나머지 규칙은 pass(블록 · 근거가 없다)."""
    found: dict[str, list[str]] = {"V4": [], "V7": []}
    if fr["id"] == into["id"]:
        found["V7"].append("같은 엔티티다")
    if fr["type_key"] != into["type_key"]:
        found["V7"].append(f"유형이 다르다({fr['type_key']} · {into['type_key']})")
    for e in (fr, into):
        if e["status"] != "active":
            found["V7"].append(f"{e['name']} 이 살아 있지 않다({e['status']})")
    for key, value in (fr["ext_ids"] or {}).items():
        other = (into["ext_ids"] or {}).get(key)
        if other is not None and other != value:
            found["V7"].append(f"외부 id {key} 가 다르다({value} · {other})")
    narrow = set(fr["audience"]) - {"org"}
    if not narrow <= set(into["audience"]):
        found["V4"].append(f"{fr['name']} 범위 {fr['audience']} 가 {into['name']} 범위 {into['audience']} 에 없다 — 좁은 이름 · 외부 id 가 샌다")
    checks = []
    for i in range(1, 12):
        rule = f"V{i}"
        if found.get(rule):
            checks.append({"rule": rule, "verdict": "fail", "detail": "; ".join(found[rule])})
        elif rule == "V6":
            checks.append({"rule": rule, "verdict": "review", "detail": "합치기는 늘 검토"})
        else:
            checks.append({"rule": rule, "verdict": "pass", "detail": ""})
    return checks


async def propose_merge(s: AsyncSession, from_id: str, into_id: str, *, user: dict[str, Any], note: str | None) -> dict[str, Any]:
    viewer = audience.current_viewer()
    fr, into = await _visible(s, from_id), await _visible(s, into_id)
    for e in (fr, into):
        if not _full(e["audience"], viewer):
            raise NotFound(f"합칠 수 있는 엔티티가 없다: {e['id']}")
    checks = merge_checks(fr, into)
    status = "failed" if any(c["verdict"] == "fail" for c in checks) else "pending_review"
    aud = sorted((set(fr["audience"]) | set(into["audience"])) - {"org"}) or ["org"]
    snap = {k: {f: e[f] for f in ("id", "type_key", "name", "aliases", "ext_ids", "audience", "status")}
            for k, e in (("from", fr), ("into", into))}
    why = (note or "").strip() or "같은 개체다"
    cs_id = str((await s.execute(text("""
        INSERT INTO wiki_changesets (op, trigger, plan, ops, validation, status, audience, created_by, finished_at)
        VALUES ('human_request', CAST(:trig AS jsonb), CAST(:plan AS jsonb), CAST(:ops AS jsonb), CAST(:val AS jsonb), :st,
                CAST(:aud AS text[]), CAST(:by AS uuid), CASE WHEN :st = 'failed' THEN NOW() END)
        RETURNING id
    """), {"trig": json.dumps({"kind": "merge"}),
           "plan": json.dumps({"summary": f"엔티티 합치기 — {fr['name']} → {into['name']}", "merge": snap, "pages": []},
                              ensure_ascii=False),
           "ops": json.dumps([{"op": "entity.merge", "doc": "", "from": fr["id"], "into": into["id"], "why": why}],
                             ensure_ascii=False),
           "val": json.dumps(checks, ensure_ascii=False), "st": status, "aud": aud, "by": user["id"]})).scalar_one())
    await _log(s, f"합치기 제안 · {fr['name']} → {into['name']}",
               {"action": "merge.propose", "from": fr["id"], "into": into["id"], "changeset": short_cs(cs_id), "status": status},
               aud, user, cs_id)
    await s.commit()
    return {"id": cs_id, "short": short_cs(cs_id), "status": status, "validation": checks}


async def apply_merge(s: AsyncSession, op: dict[str, Any]) -> dict[str, Any]:
    """`entity.merge` 반영 — 되돌리기 기록을 돌려준다. 커밋은 부르는 쪽(apply)이."""
    fr, into = await _load(s, op["from"], lock=True), await _load(s, op["into"], lock=True)
    if fr is None or into is None or fr["status"] != "active" or into["status"] != "active":
        raise ApplyConflict("합칠 엔티티가 그 사이 바뀌었다(살아 있지 않다)")
    seen = {strong_key(into["name"])}
    aliases: list[str] = []
    for a in [*into["aliases"], fr["name"], *fr["aliases"]]:
        if strong_key(a) not in seen:
            seen.add(strong_key(a))
            aliases.append(a)
    await s.execute(text("""
        UPDATE wiki_entities SET aliases = CAST(:a AS text[]), ext_ids = CAST(:x AS jsonb), updated_at = NOW()
         WHERE id = CAST(:i AS uuid)
    """), {"a": aliases, "x": json.dumps({**fr["ext_ids"], **into["ext_ids"]}, ensure_ascii=False), "i": into["id"]})
    await s.execute(text("""
        UPDATE wiki_entities SET status = 'merged', merged_into = CAST(:into AS uuid), updated_at = NOW()
         WHERE id = CAST(:i AS uuid)
    """), {"into": into["id"], "i": fr["id"]})
    have = {tuple(sorted(r[0])) for r in (await s.execute(text("""
        SELECT wp.audience FROM wiki_pages wp JOIN documents d ON d.id = wp.doc_id
         WHERE wp.entity_id = CAST(:i AS uuid) AND d.status <> 'archived'
    """), {"i": into["id"]})).all()}
    moved = []
    for doc_id, slug, aud, stale in (await s.execute(text("""
        SELECT wp.doc_id, d.slug, wp.audience, wp.stale_since FROM wiki_pages wp JOIN documents d ON d.id = wp.doc_id
         WHERE wp.entity_id = CAST(:i AS uuid)
    """), {"i": fr["id"]})).all():
        dup = tuple(sorted(aud)) in have
        await s.execute(text("""
            UPDATE wiki_pages SET entity_id = CAST(:into AS uuid),
                   stale_since = CASE WHEN :dup THEN COALESCE(stale_since, NOW()) ELSE stale_since END
             WHERE doc_id = CAST(:d AS uuid)
        """), {"into": into["id"], "dup": dup, "d": str(doc_id)})
        moved.append({"doc_id": str(doc_id), "slug": slug, "stale": dup, "prev_stale": stale.isoformat() if stale else None})
    stale_docs = [m["doc_id"] for m in moved if m["stale"]]
    reingest = [str(r[0]) for r in (await s.execute(text("""
        SELECT DISTINCT source_id FROM wiki_citations WHERE doc_id = ANY(CAST(:d AS uuid[]))
    """), {"d": stale_docs})).all()] if stale_docs else []
    return {"from": fr["id"], "into": into["id"], "pages": moved, "reingest": reingest,
            "prev_into": {"aliases": into["aliases"], "ext_ids": into["ext_ids"]}}


async def undo_merge(s: AsyncSession, rec: dict[str, Any]) -> None:
    for m in rec["pages"]:
        await s.execute(text("""
            UPDATE wiki_pages SET entity_id = CAST(:fr AS uuid), stale_since = CAST(:st AS timestamptz)
             WHERE doc_id = CAST(:d AS uuid) AND entity_id = CAST(:into AS uuid)
        """), {"fr": rec["from"], "st": m["prev_stale"], "d": m["doc_id"], "into": rec["into"]})
    await s.execute(text("""
        UPDATE wiki_entities SET status = 'active', merged_into = NULL, updated_at = NOW()
         WHERE id = CAST(:i AS uuid) AND status = 'merged' AND merged_into = CAST(:into AS uuid)
    """), {"i": rec["from"], "into": rec["into"]})
    await s.execute(text("""
        UPDATE wiki_entities SET aliases = CAST(:a AS text[]), ext_ids = CAST(:x AS jsonb), updated_at = NOW()
         WHERE id = CAST(:i AS uuid)
    """), {"a": rec["prev_into"]["aliases"], "x": json.dumps(rec["prev_into"]["ext_ids"], ensure_ascii=False),
           "i": rec["into"]})
