# 위키 찾기 재현율 시험(Q11) — 합성 원천 20 으로 지은 위키에서 이름이 든 물음 · 바꿔 말한 물음을 엔티티 · 검색 길로 찾고, 별칭이 얼마나 메우나 잰다
"""docs/llm-wiki W7 '의미 검색 재현율 재기(Q11)'. 잰 값은 `-s` 로 찍히고 docs/llm-wiki/context-notes.md 에 적는다.

위키는 SQL 로 짓는다(원천마다 사례 · 문답 · 심의 문서, 힌트마다 엔티티 문서 — 진짜 들이기가 만드는 꼴과 같은 갈래) — 들이기의 가짜 LLM
답이 문서를 얼마나 쓰는지에 재현율이 흔들리지 않게. 색인은 시험 색인(test_documents)에 넣고 끝에 지운다.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from uuid import uuid4

import pytest
from sqlalchemy import text

from app.core.db import session_scope
from app.scripts import wiki_search_eval
from app.search import meili_indexer as mi
from app.wiki import audience, pages, sources
from app.wiki import schema as wiki_schema
from app.wiki.envelope import SourceEnvelope

RUN = uuid4().hex[:8]
FIX = Path(__file__).parent / "fixtures" / "wiki"
GOLD = json.loads((FIX / "search-gold.json").read_text(encoding="utf-8"))
BASE = json.loads(Path("/workspace/packages/shared/samples/05-minimal-doc.json").read_text(encoding="utf-8"))
_ABBR = {"product-model": "model", "part": "part", "failure-mode": "fm", "countermeasure": "cm", "sim-type": "simt"}


def _content(slug: str, title: str, sections: list[tuple[str, str]]) -> dict[str, Any]:
    return {**BASE, "slug": slug, "title": title, "summary": "",
            "sections": [{"id": pages.new_id(), "level": 1, "title": t, "subsections": [],
                          "blocks": [{"type": "paragraph", "id": pages.new_id(), "text": body}]} for t, body in sections]}


@pytest.fixture
async def wiki_world() -> Any:
    audience.set_viewer(audience.SYSTEM)
    keys: dict[str, str] = {}
    made_docs: list[str] = []
    made_ents: list[str] = []
    old_aliases: dict[str, list[str]] = {}
    mentions: dict[tuple[str, str], list[str]] = {}
    async with session_scope() as s:
        owner = (await s.execute(text("SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1"))).scalar_one()

        async def page(slug: str, title: str, kind: str, sections: list[tuple[str, str]], entity: str | None = None) -> None:
            doc = str((await s.execute(text("""
                INSERT INTO documents (slug, title, summary, status, content_json, owner_id)
                VALUES (:slug, :t, '', 'published', CAST(:c AS jsonb), :o) RETURNING id
            """), {"slug": slug, "t": title, "c": json.dumps(_content(slug, title, sections), ensure_ascii=False),
                   "o": owner})).scalar_one())
            await s.execute(text("""
                INSERT INTO wiki_pages (doc_id, kind, managed, audience, entity_id)
                VALUES (CAST(:d AS uuid), :k, 'ai', ARRAY['org'], CAST(:e AS uuid))
            """), {"d": doc, "k": kind, "e": entity})
            made_docs.append(doc)

        for f in sorted((FIX / "sources").glob("*.json")):
            nn = f.name[:2]
            env = SourceEnvelope.model_validate(json.loads(f.read_text(encoding="utf-8")))
            body = env.payload()
            summary = sources._summary(env, body)
            for h in env.subject_hints:
                mentions.setdefault((h.type, h.name), []).append(env.title)
            if env.kind == "sim_result":
                await page(f"case-sim-r{RUN}-{nn}", env.title, "case", [("요약", summary), ("판정", str(body.get("verdict") or ""))])
            elif env.kind == "field_defect":
                await page(f"case-field-r{RUN}-{nn}", env.title, "case", [("요약", summary)])
            elif env.kind == "qa":
                await page(f"qa-r{RUN}-{nn}", body["question"], "qa", [("대표 질문", body["question"]), ("답", body["answer"])])
            elif env.kind == "deliberation":
                await page(f"ana-r{RUN}-{nn}", env.title, "analysis", [("물음", body["question"]), ("결론", body["decision"])])
            else:
                continue
            keys[f"src:{nn}"] = f"{'case-sim' if env.kind == 'sim_result' else 'case-field' if env.kind == 'field_defect' else 'qa' if env.kind == 'qa' else 'ana'}-r{RUN}-{nn}"
        for i, ((type_key, name), titles) in enumerate(sorted(mentions.items())):
            row = (await s.execute(text("""
                INSERT INTO wiki_entities (type_key, canonical_name, audience, attrs)
                VALUES (:t, :n, ARRAY['org'], CAST(:a AS jsonb))
                ON CONFLICT (type_key, lower(canonical_name)) WHERE status = 'active' DO NOTHING RETURNING id
            """), {"t": type_key, "n": name, "a": json.dumps({"test_run": RUN})})).scalar()
            if row is None:
                row = (await s.execute(text("""
                    SELECT id FROM wiki_entities WHERE type_key = :t AND lower(canonical_name) = lower(:n) AND status = 'active'
                """), {"t": type_key, "n": name})).scalar_one()
            else:
                made_ents.append(str(row))
            slug = f"ent-{_ABBR.get(type_key, 'x')}-r{RUN}-{i}"
            await page(slug, name, "entity", [("요약", f"{name} — " + " · ".join(sorted(set(titles))))], entity=str(row))
            keys[f"ent:{type_key}:{name}"] = slug
        await s.execute(text("REFRESH MATERIALIZED VIEW documents_flat_v"))
        await s.commit()
        rows = [r for r in [await mi._fetch_flat_row(s, d) for d in made_docs] if r]
    idx = mi.get_client().index(mi.INDEX_UID)
    mi.get_client().wait_for_task(idx.add_documents(rows, primary_key=mi.PRIMARY_KEY).task_uid, timeout_in_ms=60_000)
    try:
        yield {"keys": keys, "aliases": old_aliases}
    finally:
        last = None
        for d in made_docs:
            last = idx.delete_document(d)
        if last is not None:
            mi.get_client().wait_for_task(last.task_uid, timeout_in_ms=60_000)
        async with session_scope() as s:
            for eid, aliases in old_aliases.items():
                await s.execute(text("UPDATE wiki_entities SET aliases = CAST(:a AS text[]) WHERE id = CAST(:i AS uuid)"),
                                {"a": aliases, "i": eid})
            await s.execute(text("DELETE FROM documents WHERE id = ANY(CAST(:d AS uuid[]))"), {"d": made_docs})
            await s.execute(text("DELETE FROM wiki_entities WHERE id = ANY(CAST(:e AS uuid[]))"), {"e": made_ents})
            await s.execute(text("REFRESH MATERIALIZED VIEW documents_flat_v"))


def _cases(keys: dict[str, str]) -> list[dict[str, Any]]:
    return [{**c, "expect": [keys[k] for k in c["expect"]]} for c in GOLD["cases"]]


def _line(tag: str, m: dict[str, Any]) -> str:
    def cell(sel: dict[str, Any]) -> str:
        return " · ".join(f"{p} hit {sel[p]['hit']:.2f} recall {sel[p]['recall']:.2f}" for p in wiki_search_eval.PATHS)

    return (f"[Q11 {tag}] k={m['k']} | 전체 {cell(m['all'])} | exact(n={m['by_kind']['exact']['n']}) "
            f"{cell(m['by_kind']['exact'])} | paraphrase(n={m['by_kind']['paraphrase']['n']}) {cell(m['by_kind']['paraphrase'])}")


async def test_find_step_recall_and_what_aliases_buy(wiki_world: dict[str, Any]) -> None:
    cases = _cases(wiki_world["keys"])
    async with session_scope() as s:
        before = await wiki_search_eval.measure(s, cases, k=5, role="admin")
        for key, aliases in GOLD["aliases"].items():  # 사람이 등록부에 다는 별칭(W5 — 별칭은 배우지 않는다)
            type_key, name = key.split(":", 1)
            eid, old = (await s.execute(text("""
                SELECT id, aliases FROM wiki_entities WHERE type_key = :t AND lower(canonical_name) = lower(:n) AND status = 'active'
            """), {"t": type_key, "n": name})).one()
            wiki_world["aliases"].setdefault(str(eid), list(old or []))
            await s.execute(text("UPDATE wiki_entities SET aliases = CAST(:a AS text[]) WHERE id = :i"),
                            {"a": sorted(set(old or []) | set(aliases)), "i": eid})
        await s.commit()
        after = await wiki_search_eval.measure(s, cases, k=5, role="admin")
    print("\n" + _line("별칭 전", before) + "\n" + _line("별칭 뒤", after))
    print("[Q11 놓침(별칭 뒤)] " + json.dumps([m["q"] for m in after["misses"]], ensure_ascii=False))
    exact, para = before["by_kind"]["exact"], before["by_kind"]["paraphrase"]
    assert exact["both"]["hit"] >= 0.85, before["misses"]  # 이름이 든 물음은 지금 길로 찾는다
    assert after["by_kind"]["paraphrase"]["both"]["hit"] > para["both"]["hit"]  # 별칭이 바꿔 말한 물음을 메운다
    assert after["by_kind"]["exact"]["both"]["hit"] >= exact["both"]["hit"]  # 별칭이 이름 물음을 해치지 않는다
