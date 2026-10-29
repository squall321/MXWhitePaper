# 위키 찾기 재현율 — 묻기의 찾기 단계(엔티티 이름 · 별칭 + Meilisearch)가 정답 문서를 위 k 개 안에 내는지 잰다(Q11 — 의미 검색을 들일지)
"""docs/llm-wiki W7 '의미 검색 재현율 재기(Q11)' · request §11 Q11(목록 + 엔티티 + Meilisearch 로 시작해 W7 에 재고 정한다).

    python -m app.scripts.wiki_search_eval --gold PATH [--k 5] [--as EMAIL]

- 정답표 — `{"cases": [{"q": 물음, "expect": [slug …], "kind": "exact" · "paraphrase"}]}`. exact 는 문서 · 엔티티 이름이 물음에 든
  것, paraphrase 는 다른 말(동의어 · 풀어 쓴 말)로 물은 것. 진짜 박스(cae00)의 정답표는 사람이 실제 물음으로 만든다(리포에 넣지 않는다).
- 길 셋을 따로 잰다 — 엔티티 길(`query.entity_pages`) · 검색 길(`query.search_pages`) · 묻기가 쓰는 둘의 합(엔티티 먼저). 물음마다
  위 k 개에 정답이 하나라도 있으면 hit, 정답 중 몇이 들었나가 recall. 갈래(kind)별로도 낸다.
- 읽는 사람 — `--as` 의 사람(그 사람의 범위로 거른다), 비면 시스템(다 본다).
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import session_factory
from app.wiki import audience, query

PATHS = ("entity", "search", "both")


async def _found(s: AsyncSession, q: str, role: str | None) -> dict[str, list[str]]:
    by_entity = await query.entity_pages(s, q)
    by_search = await query.search_pages(s, q, role)
    return {"entity": by_entity, "search": by_search, "both": list(dict.fromkeys([*by_entity, *by_search]))}


async def measure(s: AsyncSession, cases: list[dict[str, Any]], *, k: int = 5, role: str | None = "admin") -> dict[str, Any]:
    """물음마다 길 셋의 위 k 개 — 전체 · 갈래별 hit@k · recall@k 와 놓친 물음."""
    rows: list[dict[str, Any]] = []
    for case in cases:
        found = await _found(s, case["q"], role)
        want = set(case["expect"])
        rows.append({"q": case["q"], "kind": case.get("kind", "exact"), "expect": sorted(want),
                     **{p: {"hit": bool(want & set(found[p][:k])), "recall": len(want & set(found[p][:k])) / len(want),
                            "top": found[p][:k]} for p in PATHS}})

    def agg(sel: list[dict[str, Any]]) -> dict[str, Any]:
        n = len(sel)
        return {"n": n, **{p: {"hit": round(sum(r[p]["hit"] for r in sel) / n, 3) if n else None,
                              "recall": round(sum(r[p]["recall"] for r in sel) / n, 3) if n else None} for p in PATHS}}

    kinds = sorted({r["kind"] for r in rows})
    return {"k": k, "all": agg(rows), "by_kind": {kd: agg([r for r in rows if r["kind"] == kd]) for kd in kinds},
            "misses": [{"q": r["q"], "kind": r["kind"], "expect": r["expect"], "top": r["both"]["top"]}
                       for r in rows if not r["both"]["hit"]]}


async def _main(gold: Path, k: int, email: str | None) -> dict[str, Any]:
    cases = json.loads(gold.read_text(encoding="utf-8"))["cases"]
    async with session_factory()() as s:
        viewer, role = audience.SYSTEM, "admin"
        if email:
            row = (await s.execute(text("SELECT id FROM users WHERE lower(email) = lower(:e)"), {"e": email})).first()
            if row is None:
                raise SystemExit(f"그런 사람이 없다: {email}")
            found = await audience.viewer_for_user(s, str(row[0]))
            if found is None:
                raise SystemExit(f"비활성 사람이다: {email}")
            viewer = found
            role = (await s.execute(text("SELECT role FROM users WHERE id = :i"), {"i": row[0]})).scalar_one()
        with audience.acting_as(viewer):
            return await measure(s, cases, k=k, role=role)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="위키 찾기 재현율(엔티티 · 검색 · 합)")
    ap.add_argument("--gold", type=Path, required=True)
    ap.add_argument("--k", type=int, default=5)
    ap.add_argument("--as", dest="email", default=None, help="이 사람의 범위로 잰다(비면 시스템)")
    args = ap.parse_args(argv)
    out = asyncio.run(_main(args.gold, args.k, args.email))
    json.dump(out, sys.stdout, ensure_ascii=False, indent=1)
    print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
