# 위키 들이기의 결정적 엔티티 해석 · 후보 문서 — 외부 id → 별칭 → 정규화 이름 순으로 등록부에서 찾고, 범위마다 한 장인 문서를 고른다
"""request §5-6 ② · CONTRACTS §2-6 · §2-11 · SCHEMA-DRAFT §3. W4 는 결정적 부분, W5 는 후보 — `resolve_hints` 가 힌트마다
외부 id → 별칭 → 이름 → 열쇠(`strong_key` — 공백 · 흔한 구두점 무시)로 찾고, 못 찾으면 비슷한 후보(글자쌍 유사도 — `CANDIDATE_MIN`)를
모은다. 후보 중 고르기는 들이기가 LLM 에게 묻고(ingest `wiki_resolve`) 그 답을 `Resolution` 에 적어 `targets` 에 넘긴다. 후보는 원천의
범위가 볼 수 있는 엔티티만(범위 토큰 ⊆ 원천 범위 — 프롬프트 · 계획에 이름 · 별칭 · 외부 id 가 실린다).

- 유형이 승인되지 않은 힌트는 해석하지 않는다(새 엔티티를 만들 수 없다 — V7).
- 엔티티 문서는 범위마다 한 장 — `["org"]` 는 기본 slug, 그 밖은 `<기본>--<범위 꼬리>`(예 `ent-part-…--syn-cae1`). 원천의 사실은 원천과
  범위가 같은 문서에 쓴다 — 넓히지 않고, 좁은 문서가 있다는 것도 넓은 문서에 쓰지 않는다.
- slug 는 ASCII — `ent-<약어>-<외부 id>` 또는 `ent-<약어>-<이름 해시 6>`(한국어 이름에는 영문 이름이 없다). 기본 slug 는 엔티티를
  처음 만들 때 `attrs.slug` 에 적어 두고 다시 짓지 않는다.
- 사례 문서 — 해석 결과는 `case-sim-<원천 짧은 id>`, 시장불량 사례(case)는 `case-field-<원천 짧은 id>`.
- 찾은 엔티티는 그 범위의 문서가 이미 있으면 그 slug 를 쓴다(합치기로 옮겨 온 문서는 slug 가 다르다 — 낡음 표시 없는 것 · 오래된 것 먼저).
- 문답 원천(qa — W6)은 문답 문서가 먼저 — 같은 범위에 물음 열쇠(`question_key`)가 같은 문서가 있으면 그것 하나, 아니면 비슷한 문답
  문서(제목 Dice ≥ `QA_SIMILAR` · 둘까지) + 새 문서 `qa-<열쇠 해시 8>`. 계획이 고른다(같은 물음의 묶음 — SCHEMA-DRAFT §2 `qa`).
"""
from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from dataclasses import asdict, dataclass, field
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

_SLUG_BAD = re.compile(r"[^a-z0-9]+")
_PUNCT = re.compile(r"[\s\-_.·/()\[\]]+")
CANDIDATE_MIN = 0.4  # 글자쌍 Dice — 이보다 낮으면 후보가 아니다
CANDIDATE_MAX = 5
SMALL_REGISTRY = 12  # 비슷한 후보가 없을 때 이만큼 이하인 유형은 전부를 후보로(한글 · 영문처럼 글자쌍이 안 겹치는 이름)
QA_SIMILAR = 0.5
_MARKS = re.compile(r"[?？!！.。,，~…]+")


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


@dataclass
class Resolution:
    """힌트 하나의 해석 — 찾은 엔티티(how) · 못 찾았으면 후보 · LLM 이 고른 뒤의 확신 · 까닭 · 의심."""

    index: int
    type_key: str
    name: str
    ext: dict[str, str]
    entity: dict[str, Any] | None = None  # {id, name, attrs}
    how: str = "new"  # ext · alias · name · key · llm · new
    candidates: list[dict[str, Any]] = field(default_factory=list)  # {id, name, aliases, ext_ids, score}
    confidence: float | None = None
    why: str = ""
    doubt: str | None = None  # 있으면 V7 검토

    def as_plan(self) -> dict[str, Any]:
        out = asdict(self)
        out["entity"] = {"id": self.entity["id"], "name": self.entity["name"]} if self.entity else None
        out["candidates"] = [{"id": c["id"], "name": c["name"], "score": c["score"]} for c in self.candidates]
        return out


def normalize(name: str) -> str:
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", name)).casefold()


def strong_key(name: str) -> str:
    """중복 · 해석의 열쇠 — NFKC · casefold · 공백과 흔한 구두점(-_.·/()[]) 없앰."""
    return _PUNCT.sub("", unicodedata.normalize("NFKC", name)).casefold()


def question_key(question: str) -> str:
    """물음의 열쇠 — `strong_key` 에 문장 부호(?!.,~…)까지 뺀다. 질문 대기열 · 문답 문서가 같이 쓴다."""
    return _MARKS.sub("", strong_key(question))


def similarity(a: str, b: str) -> float:
    """열쇠의 글자쌍 Dice(0~1). 한 글자 열쇠는 그 글자 하나를 쌍으로 본다."""
    def grams(x: str) -> set[str]:
        k = strong_key(x)
        return {k[i:i + 2] for i in range(len(k) - 1)} or {k}

    ga, gb = grams(a), grams(b)
    return 2 * len(ga & gb) / (len(ga) + len(gb)) if ga and gb else 0.0


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


async def _by_key(s: AsyncSession, type_key: str, name: str,
                  src_audience: list[str]) -> tuple[dict[str, Any] | None, list[dict[str, Any]]]:
    """열쇠가 같은 엔티티(여럿이면 오래된 것) 또는 비슷한 후보 — 후보는 원천 범위가 볼 수 있는 것만, 유사도 순 CANDIDATE_MAX 까지.
    비슷한 것이 없고 볼 수 있는 엔티티가 SMALL_REGISTRY 이하면 전부(점수 낮은 것까지)."""
    rows = (await s.execute(text("""
        SELECT id, canonical_name, aliases, ext_ids, attrs, audience FROM wiki_entities
         WHERE type_key = :t AND status = 'active' ORDER BY created_at
    """), {"t": type_key})).all()
    key = strong_key(name)
    for r in rows:
        if key in {strong_key(n) for n in [r[1], *r[2]]}:
            return {"id": str(r[0]), "name": r[1], "attrs": r[4], "how": "key"}, []
    allowed = [{"id": str(r[0]), "name": r[1], "aliases": list(r[2]),
                "ext_ids": json.loads(r[3]) if isinstance(r[3], str) else r[3], "attrs": r[4],
                "score": round(max(similarity(name, n) for n in [r[1], *r[2]]), 3)}
               for r in rows if set(r[5]) - {"org"} <= set(src_audience)]
    scored = sorted((c for c in allowed if c["score"] >= CANDIDATE_MIN), key=lambda c: -c["score"])
    if scored:
        return None, scored[:CANDIDATE_MAX]
    return None, allowed if len(allowed) <= SMALL_REGISTRY else []


async def resolve_hints(s: AsyncSession, src: dict[str, Any]) -> list[Resolution]:
    """원천의 힌트마다 결정적으로 찾고, 못 찾으면 후보를 모은다(LLM 은 부르지 않는다). 승인되지 않은 유형 · 빈 이름은 뺀다."""
    approved = {r[0] for r in (await s.execute(text("SELECT key FROM wiki_entity_types WHERE status = 'approved'"))).all()}
    out: list[Resolution] = []
    for i, hint in enumerate(src.get("subject_hints") or []):
        type_key, name = hint.get("type"), str(hint.get("name") or "").strip()
        if type_key not in approved or not name:
            continue
        ext = {str(k): str(v) for k, v in (hint.get("ext") or {}).items()}
        res = Resolution(index=i, type_key=type_key, name=name, ext=ext)
        found = await _find_entity(s, type_key, name, ext)
        cands: list[dict[str, Any]] = []
        if found is None:
            found, cands = await _by_key(s, type_key, name, list(src["audience"]))
        if found is not None:
            res.entity, res.how = {k: found[k] for k in ("id", "name", "attrs")}, found["how"]
        res.candidates = cands
        out.append(res)
    return out


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


async def _qa_targets(s: AsyncSession, src: dict[str, Any], audience: list[str]) -> list[Target]:
    question = str((src.get("payload") or {}).get("question") or src.get("title") or "").strip()
    if not question:
        return []
    key = question_key(question)
    rows = (await s.execute(text("""
        SELECT d.slug, d.title FROM wiki_pages wp JOIN documents d ON d.id = wp.doc_id
         WHERE wp.kind = 'qa' AND wp.audience = CAST(:a AS text[]) AND d.status <> 'archived'
    """), {"a": audience})).all()
    same = [slug for slug, title in rows if question_key(title) == key]
    near = [slug for score, slug in sorted(((similarity(question, title), slug) for slug, title in rows if slug not in same),
                                           reverse=True) if score >= QA_SIMILAR][:2]
    picks = same[:1] or near
    out = [await _target(s, slug, kind="qa", type_key="qa", title=question, audience=audience, entity_id=None, entity=None,
                         label="문답") for slug in picks]
    if not same:
        new = f"qa-{hashlib.sha256(key.encode('utf-8')).hexdigest()[:8]}"
        out.append(await _target(s, new, kind="qa", type_key="qa", title=question, audience=audience, entity_id=None,
                                 entity=None, label="문답"))
    return out


async def targets(s: AsyncSession, src: dict[str, Any], resolutions: list[Resolution] | None = None) -> list[Target]:
    """원천 하나가 고칠 수 있는 문서들 — 사례 문서(해당하면) · 힌트마다 엔티티 문서. 같은 slug 는 한 번.

    `resolutions` 가 없으면 결정적 해석만(후보가 있어도 새 엔티티 — LLM 을 묻지 않은 것과 같다).
    """
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
    elif src["kind"] == "qa":
        out.extend(await _qa_targets(s, src, audience))
    for res in resolutions if resolutions is not None else await resolve_hints(s, src):
        type_key, name, ext, found = res.type_key, res.name, res.ext, res.entity
        if type_key not in types:
            continue
        abbr, label = types[type_key]
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
