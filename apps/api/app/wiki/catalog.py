# 위키 목록(index) — 읽는 사람이 볼 수 있는 위키 문서를 규칙서의 종류 · 유형 순서로 묶는다. index.md 는 Karpathy 원문 꼴(CONTRACTS §10)
"""request §5-11 · CONTRACTS §10.

- 범위가 다른 사람은 다른 목록을 본다 — 문서 거르기(`audience.visible_sql`)를 지난 것만 센다.
- 갈래 = 엔티티 문서는 엔티티 유형, 사례는 `sim-case` · `field-case`, 그 밖은 문서 종류. 순서는 규칙서 `sections` 의 열쇠 순서.
  원천 · 규칙서 · 목록 · 점검 보고서 문서는 싣지 않는다(원천은 머리 줄의 수로만).
- 갈래마다 제목 순으로 `index.max_per_section` 장까지, 넘으면 '그 밖 N'.
- 저장해 두는 `wiki-index` 문서(org 범위만)는 아직 짓지 않는다 — 이 창구가 늘 그 사람의 목록을 새로 짓는다.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.wiki import audience
from app.wiki import schema as wiki_schema
from app.wiki.sources import visible_sql as source_visible_sql

KST = ZoneInfo("Asia/Seoul")
_KIND_LABELS = {"analysis": "분석", "qa": "문답", "overview": "개요", "concept": "공학 개념", "case": "사례", "entity": "엔티티"}


async def build(s: AsyncSession) -> dict[str, Any]:
    book = await wiki_schema.load(s)
    labels = {r[0]: r[1] for r in (await s.execute(text("SELECT key, label_ko FROM wiki_entity_types"))).all()}
    params = audience.sql_params()
    rows = (await s.execute(text(f"""
        SELECT d.slug, d.title, d.summary, wp.kind, e.type_key
          FROM documents d JOIN wiki_pages wp ON wp.doc_id = d.id LEFT JOIN wiki_entities e ON e.id = wp.entity_id
         WHERE wp.kind NOT IN ('source', 'schema', 'index', 'lint-report') AND d.status <> 'archived'
           AND {audience.visible_sql('d')}
         ORDER BY d.title
    """), params)).all()
    n_sources = (await s.execute(text(f"""
        SELECT COUNT(*) FROM wiki_sources ws WHERE ws.status = 'active' AND {source_visible_sql('ws')}
    """), params)).scalar_one()
    groups: dict[str, list[dict[str, Any]]] = {}
    for slug, title, summary, kind, type_key in rows:
        key = type_key or ("sim-case" if slug.startswith("case-sim-") else
                           "field-case" if slug.startswith("case-field-") else kind)
        groups.setdefault(key, []).append({"slug": slug, "title": title, "summary": summary or "", "kind": kind})
    order = [k for k in book.spec.sections if k != "source"]
    keys = [k for k in order if k in groups] + sorted(k for k in groups if k not in order)
    limit = book.spec.index.max_per_section
    return {
        "version": book.version, "at": datetime.now(KST).strftime("%Y-%m-%d %H:%M"), "docs": len(rows),
        "sources": int(n_sources),
        "sections": [{"key": k, "label": labels.get(k) or _KIND_LABELS.get(k, k), "count": len(groups[k]),
                      "items": groups[k][:limit], "more": max(0, len(groups[k]) - limit)} for k in keys],
    }


def markdown(idx: dict[str, Any]) -> str:
    out = [f"# 위키 목록 (규칙서 v{idx['version']} · {idx['at']} KST · 문서 {idx['docs']:,} · 원천 {idx['sources']:,})", ""]
    for sec in idx["sections"]:
        out.append(f"## {sec['label']}({sec['key']}) — {sec['count']:,}")
        out.extend(f"- [[{it['slug']}|{it['title']}]]" + (f" — {it['summary']}" if it["summary"] else "") for it in sec["items"])
        if sec["more"]:
            out.append(f"- … 그 밖 {sec['more']:,}")
        out.append("")
    return "\n".join(out).rstrip() + "\n"
