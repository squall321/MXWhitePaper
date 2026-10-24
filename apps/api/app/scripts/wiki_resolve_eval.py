# 엔티티 해석 정답표 평가 — 정답표의 등록부를 트랜잭션 안에 심고 사례마다 결정적 해석 + (LLM 이 있으면) 후보 고르기를 돌려 맞춘 비율을 낸다
"""docs/llm-wiki W5 완료 기준 — '합성 묶음에서 엔티티 해석 정확도(사람이 정답표를 만든다) 90% 이상'.

    python -m app.scripts.wiki_resolve_eval [--gold PATH] [--no-llm]

- 등록부(`registry`)는 한 트랜잭션 안에서 심고 끝에 되돌린다 — DB 에 남지 않는다. `existing: true` 줄은 심지 않고 그 유형 · 이름의 살아
  있는 엔티티를 쓴다(cae00 의 진짜 등록부로 잴 때).
- 사례마다 원천 하나(전사 범위 문답)로 보고 `resolve.resolve_hints` → 후보가 있으면 `wiki_resolve`(배경 LLM) → 고른 엔티티를 정답과
  맞춘다. LLM 이 없거나 `--no-llm` 이면 고르기 없이(그때 못 찾은 힌트는 new).
- 내는 것 — 전체 정확도 · 결정적으로 찾은 것의 정확도 · 후보 재현율(결정적으로 못 찾은 힌트의 정답이 후보에 있나) · 갈래별 · 틀린 사례.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import session_factory
from app.wiki import ingest, llm, resolve
from app.wiki import schema as wiki_schema

GOLD = Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "wiki" / "resolve-gold.json"
Ask = Callable[[dict[str, Any], list[resolve.Resolution]], Awaitable[None]]


async def seed(s: AsyncSession, gold: dict[str, Any]) -> dict[str, str]:
    """등록부를 심는다(커밋하지 않는다) — 정답 열쇠 → 엔티티 id."""
    ids: dict[str, str] = {}
    for e in gold["registry"]:
        if e.get("existing"):
            found = (await s.execute(text("""
                SELECT id FROM wiki_entities WHERE type_key = :t AND lower(canonical_name) = lower(:n) AND status = 'active'
            """), {"t": e["type"], "n": e["name"]})).scalar()
            if found is None:
                raise SystemExit(f"등록부에 없는 엔티티: {e['type']} {e['name']}")
            ids[e["key"]] = str(found)
            continue
        ids[e["key"]] = str((await s.execute(text("""
            INSERT INTO wiki_entities (type_key, canonical_name, aliases, ext_ids, audience)
            VALUES (:t, :n, CAST(:a AS text[]), CAST(:x AS jsonb), ARRAY['org']) RETURNING id
        """), {"t": e["type"], "n": e["name"], "a": e.get("aliases") or [], "x": json.dumps(e.get("ext") or {})})).scalar_one())
    return ids


async def evaluate(s: AsyncSession, gold: dict[str, Any], *, ask: Ask | None = None) -> dict[str, Any]:
    ids = await seed(s, gold)
    key_of = {v: k for k, v in ids.items()}
    rows = []
    for i, case in enumerate(gold["cases"]):
        src = {"id": str(uuid4()), "sid": f"src_eval{i:04d}", "kind": "qa", "title": case["hint"]["name"], "summary": "",
               "payload": {}, "audience": ["org"], "captured_at": datetime.now(UTC), "subject_hints": [case["hint"]]}
        res = (await resolve.resolve_hints(s, src) or [None])[0]
        expect_id = ids.get(case["expect"])
        deterministic = res is not None and res.entity is not None
        in_candidates = res is not None and expect_id in {c["id"] for c in res.candidates}
        if ask is not None and res is not None and res.entity is None and res.candidates:
            await ask(src, [res])
        got = "new" if res is None or res.entity is None else key_of.get(res.entity["id"], f"other:{res.entity['name']}")
        rows.append({"kind": case["kind"], "name": case["hint"]["name"], "expect": case["expect"], "got": got,
                     "deterministic": deterministic, "how": res.how if res else "skipped",
                     "candidates": [c["name"] for c in res.candidates] if res else [], "in_candidates": in_candidates,
                     "doubt": res.doubt if res else None})
    det = [r for r in rows if r["deterministic"]]
    need = [r for r in rows if not r["deterministic"] and r["expect"] != "new"]
    kinds: dict[str, list[int]] = {}
    for r in rows:
        kinds.setdefault(r["kind"], [0, 0])
        kinds[r["kind"]][0] += r["got"] == r["expect"]
        kinds[r["kind"]][1] += 1
    return {"rows": rows, "metrics": {
        "cases": len(rows), "accuracy": sum(r["got"] == r["expect"] for r in rows) / len(rows),
        "deterministic": len(det), "deterministic_accuracy": sum(r["got"] == r["expect"] for r in det) / len(det) if det else 1.0,
        "candidate_recall": sum(r["in_candidates"] for r in need) / len(need) if need else 1.0,
        "doubts": sum(1 for r in rows if r["doubt"]), "kinds": {k: f"{a}/{n}" for k, (a, n) in sorted(kinds.items())},
    }}


async def _main(gold_path: Path, use_llm: bool) -> int:
    gold = json.loads(gold_path.read_text(encoding="utf-8"))
    ep = llm.background() if use_llm else None
    usage = llm.Usage()
    async with session_factory()() as s:
        try:
            book = await wiki_schema.load(s)
            ask = None
            if ep is not None:
                async def ask(src: dict[str, Any], pending: list[resolve.Resolution]) -> None:
                    got = await llm.structured(ep, ingest.resolve_messages(book, src, pending), ingest.ResolveOut,
                                               name="wiki_resolve", usage=usage)
                    ingest.apply_choices(pending, got, book.spec.ingest.resolve_min_confidence)
            out = await evaluate(s, gold, ask=ask)
        finally:
            await s.rollback()  # 심은 등록부를 남기지 않는다
    m = out["metrics"]
    print(f"정답표 {gold_path.name} ({gold.get('status', '?')}) · LLM {'있음 ' + ep.model if ep else '없음'}")
    print(f"정확도 {m['accuracy']:.1%} ({m['cases']}) · 결정적 {m['deterministic']} 건 정확도 {m['deterministic_accuracy']:.1%} · "
          f"후보 재현율 {m['candidate_recall']:.1%} · 의심 {m['doubts']} · 토큰 {usage.tokens}")
    print("갈래 " + " · ".join(f"{k} {v}" for k, v in m["kinds"].items()))
    for r in out["rows"]:
        if r["got"] != r["expect"]:
            print(f"  틀림 [{r['kind']}] {r['name']} — 정답 {r['expect']} · 답 {r['got']} ({r['how']}) · 후보 {r['candidates']}")
    return 0


def main() -> None:
    p = argparse.ArgumentParser(description="엔티티 해석 정답표 평가(심은 등록부는 되돌린다)")
    p.add_argument("--gold", type=Path, default=GOLD)
    p.add_argument("--no-llm", action="store_true", help="후보 고르기 없이 결정적 해석 · 후보만")
    args = p.parse_args()
    sys.exit(asyncio.run(_main(args.gold, not args.no_llm)))


if __name__ == "__main__":
    main()
