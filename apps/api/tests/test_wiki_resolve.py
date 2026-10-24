# 엔티티 해석 시험 — 정답표(초안)로 결정적 해석 · 후보 재현율을 재고(LLM 없이), LLM 답을 해석에 적는 규칙(고름 · new · 없는 후보 · 낮은 확신 · 답 없음)
"""docs/llm-wiki W5 완료 기준 — 정답표 tests/fixtures/wiki/resolve-gold.json(사람이 확인할 초안). LLM 을 낀 정확도는 진짜 LLM 이 있는
박스에서 `python -m app.scripts.wiki_resolve_eval` 로 잰다(dev 에는 닿는 LLM 이 없다). 심은 등록부는 트랜잭션째 되돌린다."""
from __future__ import annotations

import json

from app.core.db import session_factory
from app.scripts.wiki_resolve_eval import GOLD, evaluate
from app.wiki import resolve
from app.wiki.ingest import ResolveChoice, ResolveOut, apply_choices

DETERMINISTIC = {"exact", "ext", "spacing", "punct", "alias"}


async def test_gold_without_llm() -> None:
    gold = json.loads(GOLD.read_text(encoding="utf-8"))
    async with session_factory()() as s:
        try:
            out = await evaluate(s, gold)
        finally:
            await s.rollback()
    rows, m = out["rows"], out["metrics"]
    det = [r for r in rows if r["kind"] in DETERMINISTIC]
    assert all(r["deterministic"] and r["got"] == r["expect"] for r in det), [r for r in det if r["got"] != r["expect"]]
    assert not [r for r in rows if r["kind"] not in DETERMINISTIC and r["deterministic"]]  # 비슷한 다른 개체를 결정적으로 잇지 않는다
    assert m["candidate_recall"] == 1.0, [r for r in rows if r["expect"] != "new" and not r["deterministic"] and not r["in_candidates"]]
    new = [r for r in rows if r["expect"] == "new"]
    assert all(r["got"] == "new" for r in new)
    assert m["accuracy"] == (len(det) + len(new)) / len(rows)  # LLM 없이는 여기까지 — 나머지는 후보 고르기가 맞춘다


def _res(n: int) -> list[resolve.Resolution]:
    return [resolve.Resolution(index=i, type_key="part", name=f"힌트 {i}", ext={},
                               candidates=[{"id": f"e{i}", "name": f"엔티티 {i}", "aliases": [], "ext_ids": {}, "attrs": {}, "score": 0.5}])
            for i in range(n)]


def test_apply_choices() -> None:
    rs = _res(5)
    apply_choices(rs, ResolveOut(choices=[
        ResolveChoice(hint="h1", choice="h1c1", confidence=0.9, why="오타"),
        ResolveChoice(hint="h2", choice="h2c9", confidence=0.9, why="엉뚱한 이름표"),
        ResolveChoice(hint="H3", choice="h3c1", confidence=0.3, why="자신 없음"),
        ResolveChoice(hint="h4", choice="new", confidence=0.8, why="다른 부품"),
    ]), 0.75)  # h5 는 답이 없다
    assert (rs[0].how, rs[0].entity["id"], rs[0].doubt) == ("llm", "e0", None)
    assert rs[1].how == "new" and rs[1].entity is None and "없는 후보" in (rs[1].doubt or "")
    assert rs[2].how == "llm" and rs[2].entity["id"] == "e2" and "확신 0.30" in (rs[2].doubt or "")
    assert (rs[3].how, rs[3].entity, rs[3].doubt) == ("new", None, None)
    assert (rs[4].how, rs[4].entity, rs[4].doubt) == ("new", None, None)  # 답 없음은 새 엔티티(잘못 잇느니 중복이 낫다)


def test_similarity() -> None:
    assert resolve.similarity("힌지 브래킷", "힌지-브래킷") == 1.0
    assert resolve.similarity("힌지 브라켓", "힌지 브래킷") >= resolve.CANDIDATE_MIN
    assert resolve.similarity("카메라 데코", "힌지 브래킷") < resolve.CANDIDATE_MIN
    assert resolve.strong_key("Cover-Glass") == resolve.strong_key("cover glass")
