# 위키 되쌓기 — 묻기의 답(물음 · 답 · 쓴 각주 · 결과)을 그 사람 명의의 qa 원천으로 받아 들인다. 범위는 근거보다 넓을 수 없다
"""request §5-7 · CONTRACTS §6 `POST /fileback` · §7 `wiki_fileback`.

- 근거 — 각주로 받은 (위키 문서 slug · 블록 id). 부른 사람이 볼 수 있는 위키 문서여야 한다(아니면 422). 봉투의 `evidence` 에 블록 글
  발췌와 그 블록이 기댄 원천(볼 수 있는 것)을 싣는다 — 원문 전부가 아니라 발췌. 문서 근거가 앞, 원천이 뒤다. 각주에 묻기의 번호 `n` 을
  주면 답의 `[n]` 을 남긴 근거의 차례 `[k]`(k 째 문서 근거)로 바꾼다 — 묻기의 번호는 그 묻기 밖에서 가리키는 곳이 없다.
- 범위 — 비면 근거 문서들의 좁은 토큰을 합친 것(모두 전사면 `["org"]`, 합칠 수 없으면 나만). 근거가 하나도 없으면 나만이다. 고르면 가진
  토큰 안에서, 근거의 좁은 토큰을 다 담거나 나만(`user:<id>`)이어야 한다 — 좁은 문서에서 온 답이 넓은 문답 문서로 새지 않게. 근거가 있고
  모두 전사면 `["org"]` 도 된다(위키가 이미 전사에 보인 것 — 원천 받기의 'org 는 admin 만' 의 예외. 근거 없는 답에는 예외가 없다).
- 주인 = 부른 사람 · 동의 `button` · origin `mxwp` / `wiki-fileback/<해시>`(같은 사람 · 물음 · 답이면 멱등). 질문자 이름은 본문에
  싣지 않는다(Q9). 엔티티 문서를 근거로 썼으면 그 엔티티를 주제 힌트로.
"""
from __future__ import annotations

import hashlib
import re
from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import Forbidden, ValidationFailed
from app.wiki import audience, pages, sources
from app.wiki.envelope import SourceEnvelope, normalize_audience
from app.wiki.resolve import question_key

_SKIP_KINDS = ("source", "schema", "index", "lint-report")
_EXCERPT = 300
_CITE = re.compile(r"\[(\d{1,3})\]")


class FilebackCite(BaseModel):
    slug: str = Field(min_length=1, max_length=200)
    block_id: str | None = Field(default=None, max_length=80)
    n: int | None = Field(default=None, ge=1, le=999, description="답의 [n](묻기의 근거 번호) — 주면 남길 때 근거 차례로 바꾼다")


class FilebackBody(BaseModel):
    question: str = Field(min_length=2, max_length=2000)
    answer: str = Field(min_length=1, max_length=20_000)
    citations: list[FilebackCite] = Field(default_factory=list, max_length=30)
    outcome: Literal["solved", "partial", "unknown"] = "solved"
    audience: list[str] | None = Field(default=None, description="비면 근거의 좁은 토큰을 합친 것")
    model: str | None = Field(default=None, max_length=120)


def _scope(required: set[str], chosen: list[str] | None, viewer: audience.Viewer, me: str, *, cited: bool) -> list[str]:
    if chosen is None:
        if not cited:
            return [me]  # 근거 없는 답은 위키가 누구에게도 보인 적 없는 글이다
        try:
            return normalize_audience(sorted(required)) if required else ["org"]
        except ValueError:
            return [me]  # 소속 둘처럼 합칠 수 없으면 나만
    try:
        tokens = normalize_audience(chosen)
    except ValueError as e:
        raise ValidationFailed(f"범위가 틀렸다 — {e}") from e
    if not viewer.sees_all and not set(tokens) <= set(viewer.tokens):
        raise Forbidden("가진 토큰 밖의 범위로 남기지 못한다", details={"audience": tokens})
    if not required <= set(tokens) and me not in tokens:
        raise ValidationFailed("근거 문서보다 넓은 범위다 — 좁은 문서에서 온 답이 새지 않게 그 토큰을 담거나 나만으로",
                               details={"required": sorted(required), "audience": tokens})
    return tokens


def _renumber(answer: str, place: dict[int, int]) -> str:
    """알려 준 번호만 바꾼다 — 각주가 아닌 대괄호 숫자(배열 첨자 같은 것)는 그대로 둔다."""
    return _CITE.sub(lambda m: f"[{place[int(m[1])]}]" if int(m[1]) in place else m[0], answer)


async def fileback(s: AsyncSession, body: FilebackBody, *, user: dict[str, Any]) -> dict[str, Any]:
    viewer = audience.current_viewer()
    me = f"user:{user['id']}"
    slugs = list(dict.fromkeys(c.slug for c in body.citations))
    rows = {r[0]: r for r in (await s.execute(text(f"""
        SELECT d.slug, d.id, d.title, d.content_json, wp.audience, wp.entity_id
          FROM documents d JOIN wiki_pages wp ON wp.doc_id = d.id
         WHERE d.slug = ANY(:s) AND wp.kind NOT IN {_SKIP_KINDS} AND d.status <> 'archived' AND {audience.visible_sql('d')}
    """), {"s": slugs, **audience.sql_params()})).all()}
    unseen = [x for x in slugs if x not in rows]
    if unseen:
        raise ValidationFailed("볼 수 없거나 위키 문서가 아닌 근거다", details={"slugs": unseen})
    required = {t for r in rows.values() for t in r[4] if t != "org"}
    scope = _scope(required, body.audience, viewer, me, cited=bool(body.citations))

    docs: list[dict[str, str]] = []
    srcs: list[dict[str, str]] = []
    place: dict[int, int] = {}  # 답의 [n] → 몇째 문서 근거
    for c in body.citations:
        slug, doc_id, title, content = rows[c.slug][0], str(rows[c.slug][1]), rows[c.slug][2], rows[c.slug][3]
        found = pages.find_block(content or {}, c.block_id) if c.block_id else None
        excerpt = pages.block_text(found[0]["blocks"][found[1]]) if found else title
        entry = {"kind": "doc", "ref": f"{slug}#{c.block_id}" if found else slug, "excerpt": excerpt[:_EXCERPT]}
        if entry not in docs:
            docs.append(entry)
        if c.n is not None:
            place[c.n] = docs.index(entry) + 1
        if found:
            for cite in (await sources.citations_for_doc(s, doc_id)).get(c.block_id or "", []):
                src = {"kind": "source", "ref": cite["short"], "excerpt": cite["title"][:_EXCERPT]}
                if src not in srcs:
                    srcs.append(src)
    evidence = docs + srcs
    ents = [str(r[5]) for r in rows.values() if r[5]]
    hints = [{"type": r[0], "name": r[1]} for r in (await s.execute(text("""
        SELECT type_key, canonical_name FROM wiki_entities WHERE id = ANY(CAST(:ids AS uuid[])) AND status = 'active'
         ORDER BY canonical_name
    """), {"ids": ents})).all()][:10] if ents else []

    now = datetime.now(UTC)
    digest = hashlib.sha256(f"{user['id']}|{question_key(body.question)}|{body.answer}".encode()).hexdigest()[:16]
    env = SourceEnvelope.model_validate({
        "schema": "mxwp-source/1", "kind": "qa",
        "origin": {"system": "mxwp", "ref": f"wiki-fileback/{digest}"},
        "title": " ".join(body.question.split())[:200], "captured_at": now.isoformat(),
        "owner": {"email": user["email"]}, "audience": scope, "sensitivity": "internal", "subject_hints": hints,
        "body": {"question": body.question, "answer": _renumber(body.answer, place), "evidence": evidence,
                 "model": body.model or "mxwp-wiki-query", "outcome": body.outcome},
        "consent": {"by": user["email"], "at": now.isoformat(), "mode": "button"},
    })
    got = await sources.receive(s, env, caller=user, ingest=True,
                                org_ok=scope == ["org"] and not required and bool(body.citations))
    return {"id": got.id, "short": sources.short_id(got.id), "dedup": got.dedup, "doc_slug": got.doc_slug,
            "ingest_state": got.ingest_state, "audience": scope}
