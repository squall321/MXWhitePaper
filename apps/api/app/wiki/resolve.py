# 위키 들이기의 결정적 엔티티 해석 · 후보 문서 — 외부 id → 별칭 → 정규화 이름 순으로 등록부에서 찾고, 범위마다 한 장인 문서를 고른다
"""request §5-6 ② · CONTRACTS §2-6 · §2-11 · SCHEMA-DRAFT §3. W4 는 결정적 부분만 — 후보 중 LLM 이 고르기 · 합치기는 W5.

- 유형이 승인되지 않은 힌트는 해석하지 않는다(새 엔티티를 만들 수 없다 — V7).
- 엔티티 문서는 범위마다 한 장 — `["org"]` 는 기본 slug, 그 밖은 `<기본>--<범위 꼬리>`(예 `ent-part-…--syn-cae1`). 원천의 사실은 원천과
  범위가 같은 문서에 쓴다 — 넓히지 않고, 좁은 문서가 있다는 것도 넓은 문서에 쓰지 않는다.
- slug 는 ASCII — `ent-<약어>-<외부 id>` 또는 `ent-<약어>-<이름 해시 6>`(한국어 이름에는 영문 이름이 없다). 기본 slug 는 엔티티를
  처음 만들 때 `attrs.slug` 에 적어 두고 다시 짓지 않는다.
- 사례 문서 — 해석 결과는 `case-sim-<원천 짧은 id>`, 시장불량 사례(case)는 `case-field-<원천 짧은 id>`.
- 찾은 엔티티는 그 범위의 문서가 이미 있으면 그 slug 를 쓴다(합치기로 옮겨 온 문서는 slug 가 다르다 — 낡음 표시 없는 것 · 오래된 것 먼저).
"""
from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

_SLUG_BAD = re.compile(r"[^a-z0-9]+")


@dataclass
class Target:
    """계획 단계가 고를 수 있는 문서 한 장."""

    slug: str
    kind: str  # entity · case
    type_key: str  # part · sim-case …
    title: str
    audience: list[str]
    exists: bool
    doc_id: str | None = None
    version: int = 0
    managed: str = "ai"
    review_lock: bool = False
    entity_id: str | None = None
    entity: dict[str, Any] | None = None  # 새 엔티티면 {type_key, canonical_name, aliases, ext_ids, attrs}
    content: dict[str, Any] | None = None  # 있으면 지금 DocumentJSON
    labels: dict[str, str] = field(default_factory=dict)


def normalize(name: str) -> str:
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", name)).casefold()


def _slugify(value: str) -> str:
    return _SLUG_BAD.sub("-", unicodedata.normalize("NFKC", value).lower()).strip("-")


def _hash6(value: str) -> str:
    return hashlib.sha256(normalize(value).encode("utf-8")).hexdigest()[:6]


def base_slug(abbr: str, name: str, ext: dict[str, str]) -> str:
    for key in sorted(ext):
        part = _slugify(str(ext[key]))
        if part:
            return f"ent-{abbr}-{part}"[:80]
    ascii_part = _slugify(name)
    return f"ent-{abbr}-{ascii_part}"[:80] if ascii_part and ascii_part.isascii() and len(ascii_part) >= 3 \
        else f"ent-{abbr}-{_hash6(name)}"


def scoped_slug(base: str, audience: list[str]) -> str:
    tail = "-".join(_slugify(t.split(":", 1)[1]) for t in sorted(audience) if t != "org")
    return f"{base}--{tail}"[:100].rstrip("-") if tail else base


def scoped_title(name: str, audience: list[str]) -> str:
    return name if audience == ["org"] else f"{name} ({', '.join(a for a in audience if a != 'org')})"


async def _find_entity(s: AsyncSession, type_key: str, name: str, ext: dict[str, str]) -> dict[str, Any] | None:
    """외부 id 같음 → 별칭 같음 → 정규화 이름 같음."""
    cols = "id, canonical_name, attrs"
    for key, value in sorted(ext.items()):
        row = (await s.execute(text(f"""
            SELECT {cols} FROM wiki_entities
             WHERE type_key = :t AND status = 'active' AND ext_ids @> CAST(:e AS jsonb) LIMIT 1
        """), {"t": type_key, "e": json.dumps({key: value})})).first()
        if row:
            return {"id": str(row[0]), "name": row[1], "attrs": row[2], "how": "ext"}
    norm = normalize(name)
    row = (await s.execute(text(f"""
        SELECT {cols} FROM wiki_entities
         WHERE type_key = :t AND status = 'active'
           AND EXISTS (SELECT 1 FROM unnest(aliases) a WHERE lower(regexp_replace(a, '\\s+', '', 'g')) = :n)
         LIMIT 1
    """), {"t": type_key, "n": norm})).first()
    if row:
        return {"id": str(row[0]), "name": row[1], "attrs": row[2], "how": "alias"}
    row = (await s.execute(text(f"""
        SELECT {cols} FROM wiki_entities
         WHERE type_key = :t AND status = 'active' AND lower(regexp_replace(canonical_name, '\\s+', '', 'g')) = :n
         LIMIT 1
    """), {"t": type_key, "n": norm})).first()
    if row:
        return {"id": str(row[0]), "name": row[1], "attrs": row[2], "how": "name"}
    return None


async def _entity_page(s: AsyncSession, entity_id: str, audience: list[str]) -> str | None:
    return (await s.execute(text("""
        SELECT d.slug FROM wiki_pages wp JOIN documents d ON d.id = wp.doc_id
         WHERE wp.entity_id = CAST(:e AS uuid) AND wp.audience = CAST(:a AS text[]) AND d.status <> 'archived'
         ORDER BY wp.stale_since NULLS FIRST, d.created_at LIMIT 1
    """), {"e": entity_id, "a": audience})).scalar()


async def _page(s: AsyncSession, slug: str) -> dict[str, Any] | None:
    """slug 의 문서(보이기 거르기 없이 — 시스템이 읽는다). 위키 문서면 그 줄도."""
    row = (await s.execute(text("""
        SELECT d.id, d.version, d.content_json, d.status, wp.kind, wp.managed, wp.review_lock, wp.audience, wp.entity_id
          FROM documents d LEFT JOIN wiki_pages wp ON wp.doc_id = d.id
         WHERE d.slug = :slug
    """), {"slug": slug})).first()
    if row is None:
        return None
    content = json.loads(row[2]) if isinstance(row[2], str) else row[2]
    return {"id": str(row[0]), "version": int(row[1]), "content": content, "status": row[3], "kind": row[4],
            "managed": row[5], "review_lock": bool(row[6]), "audience": list(row[7]) if row[7] is not None else None,
            "entity_id": str(row[8]) if row[8] else None}


async def _target(s: AsyncSession, slug: str, *, kind: str, type_key: str, title: str, audience: list[str],
                  entity_id: str | None, entity: dict[str, Any] | None, label: str) -> Target:
    page = await _page(s, slug)
    if page is not None and (page["kind"] is None or page["audience"] != audience):
        # 같은 slug 를 사람 문서나 다른 범위 문서가 쓰고 있다 — 범위 꼬리를 해시로 갈라 피한다.
        slug = f"{slug[:92]}-{_hash6(slug + json.dumps(audience))}"
        page = await _page(s, slug)
    t = Target(slug=slug, kind=kind, type_key=type_key, title=title[:200], audience=audience, exists=page is not None,
               entity_id=entity_id, entity=entity if page is None else None, labels={"type": label})
    if page is not None:
        t.doc_id, t.version, t.content = page["id"], page["version"], page["content"]
        t.managed, t.review_lock = page["managed"] or "ai", page["review_lock"]
        t.title = (page["content"] or {}).get("title") or t.title
    return t


async def targets(s: AsyncSession, src: dict[str, Any]) -> list[Target]:
    """원천 하나가 고칠 수 있는 문서들 — 사례 문서(해당하면) · 힌트마다 엔티티 문서. 같은 slug 는 한 번."""
    types = {r[0]: (r[1], r[2]) for r in (await s.execute(text(
        "SELECT key, abbr, label_ko FROM wiki_entity_types WHERE status = 'approved'"))).all()}
    audience = list(src["audience"])
    short = src["id"].replace("-", "")[:8]
    out: list[Target] = []
    body = src["payload"]
    if src["kind"] == "sim_result" and "sim-case" in types:
        out.append(await _target(s, f"case-sim-{short}", kind="case", type_key="sim-case", title=src["title"],
                                 audience=audience, entity_id=None, entity=None, label=types["sim-case"][1]))
    elif src["kind"] == "field_defect" and body.get("form") == "case" and "field-case" in types:
        out.append(await _target(s, f"case-field-{short}", kind="case", type_key="field-case", title=src["title"],
                                 audience=audience, entity_id=None, entity=None, label=types["field-case"][1]))
    for hint in src.get("subject_hints") or []:
        type_key, name = hint.get("type"), str(hint.get("name") or "").strip()
        if type_key not in types or not name:
            continue
        abbr, label = types[type_key]
        ext = {str(k): str(v) for k, v in (hint.get("ext") or {}).items()}
        found = await _find_entity(s, type_key, name, ext)
        if found:
            base = (found["attrs"] or {}).get("slug") or base_slug(abbr, found["name"], ext)
            canonical, entity = found["name"], None
        else:
            base, canonical = base_slug(abbr, name, ext), name
            entity = {"type_key": type_key, "canonical_name": name, "aliases": [], "ext_ids": ext,
                      "attrs": {"slug": base}}
        slug = (await _entity_page(s, found["id"], audience) if found else None) or scoped_slug(base, audience)
        t = await _target(s, slug, kind="entity", type_key=type_key,
                          title=scoped_title(canonical, audience), audience=audience,
                          entity_id=found["id"] if found else None, entity=entity, label=label)
        if all(t.slug != o.slug for o in out):
            out.append(t)
    return out
