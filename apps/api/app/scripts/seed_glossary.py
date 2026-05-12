"""Seed the `terms` table with canonical glossary entries.

These were previously inline in seed sample JSONs as
`glossary-ref` blocks with `term` + `definition`. The block schema
only stores `term` (FK by string); the definition lookup is the
glossary router. Populating `terms` makes the FE renderer find
real definitions instead of "정의 없음".

Idempotent — upserts on `term` (UNIQUE column).
"""
from __future__ import annotations

import asyncio

from sqlalchemy import text

from app.core.db import session_scope


TERMS = [
    ("ASP",      "Average Selling Price — 평균 판매가."),
    ("MoM",      "Month-over-Month — 전월 대비 증감."),
    ("CTR",      "Click-Through Rate — 클릭률."),
    ("GTM",      "Go-To-Market — 시장 진입 전략 및 출시 계획."),
    ("DPS",      "Days Payable Sales — 매출 대비 평균 미지급일."),
    ("ETag",     "Entity Tag — HTTP 캐시 및 동시성 제어용 식별자."),
    ("CRDT",     "Conflict-free Replicated Data Type — 분산 협업 데이터 구조."),
    ("Unpacked", "삼성 신제품 글로벌 공개 행사."),
    ("RAG",      "Retrieval-Augmented Generation — 검색 결합 LLM 응답 기법."),
    ("SSOT",     "Single Source Of Truth — 단일 진실 공급원."),
    ("QoQ",      "Quarter-over-Quarter — 전분기 대비 증감."),
    ("YoY",      "Year-over-Year — 전년 대비 증감."),
    ("DAU",      "Daily Active Users — 일 활성 사용자 수."),
    ("MAU",      "Monthly Active Users — 월 활성 사용자 수."),
    ("LCP",      "Largest Contentful Paint — 핵심 콘텐츠 렌더 완료 시각."),
    ("NPS",      "Net Promoter Score — 추천 의향 점수."),
]


async def _amain() -> int:
    async with session_scope() as s:
        for term, definition in TERMS:
            await s.execute(
                text(
                    """
                    INSERT INTO terms (term, definition)
                    VALUES (:term, :definition)
                    ON CONFLICT (term) DO UPDATE
                      SET definition = EXCLUDED.definition
                    """
                ),
                {"term": term, "definition": definition},
            )
        await s.commit()
    print(f"✓ terms seeded: {len(TERMS)} entries")
    return 0


def main() -> int:
    return asyncio.run(_amain())


if __name__ == "__main__":
    import sys
    sys.exit(main())
