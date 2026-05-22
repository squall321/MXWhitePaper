"""LLM 추출기 — 본문에서 (subject, predicate, object) triple 을 뽑는다.

graph-edge-predicates 사이클 1차. 이번 사이클은 **mock 구현**만 한다 —
외부 API 호출 인터페이스 (`extract_for_doc`) 만 잡고 실제 LLM 호출은 다음
사이클로 미룬다. provider 는 `TRIPLE_EXTRACTOR_PROVIDER` 환경변수로 고른다:

  - `mock`   (기본): 본문의 [[slug]] 위키 링크 후보 중 1~2 개를 placeholder
                     triple 로 반환. 호출 부수효과 없음.
  - `openai` : 다음 사이클에서 실 구현. 지금은 빈 list.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.wiki_link_extractor import extract_wiki_links


@dataclass
class ExtractedTriple:
    """LLM 이 뽑은 단일 triple. subject 는 호출 측이 이미 알고 있으므로 제외."""
    predicate: str
    object_slug: str
    confidence: float


class TripleExtractor:
    """LLM 으로 본문에서 (subject, predicate, object) triple 을 뽑는다.

    이번 사이클 구현: 외부 API 호출 인터페이스만 잡고, 실제 호출은 mock.
    실 호출 (provider='openai') 은 별 사이클에서 본격 구현.
    """

    def __init__(self, s: AsyncSession) -> None:
        self._s = s
        self._provider = os.getenv("TRIPLE_EXTRACTOR_PROVIDER", "mock").strip().lower()

    async def extract_for_doc(self, doc_slug: str) -> list[ExtractedTriple]:
        """문서 본문에서 triple 후보를 뽑아 반환한다.

        mock provider 는 본문의 [[slug]] 위키 링크 중 앞쪽 1~2 개를 골라
        고정 패턴 술어를 붙여 placeholder triple 로 돌려준다. 위키 링크가
        없으면 빈 list.
        """
        if self._provider != "mock":
            # provider='openai' 등 — 실 호출은 다음 사이클. 지금은 no-op.
            return []
        return await self._mock_extract(doc_slug)

    async def _mock_extract(self, doc_slug: str) -> list[ExtractedTriple]:
        content = await self._fetch_content_json(doc_slug)
        if content is None:
            return []
        # 본문의 [[slug]] 후보 수집 — wiki_link_extractor 재사용.
        seen: list[str] = []
        for link in extract_wiki_links(content):
            tgt = link.get("target_slug")
            if tgt and tgt != doc_slug and tgt not in seen:
                seen.append(tgt)
        out: list[ExtractedTriple] = []
        for obj in seen[:2]:
            out.append(ExtractedTriple(
                predicate=f"는_{obj}_와_관련있다",
                object_slug=obj,
                confidence=0.7,
            ))
        return out

    async def _fetch_content_json(self, doc_slug: str) -> dict[str, Any] | None:
        row = (await self._s.execute(
            text("SELECT content_json FROM documents WHERE slug = :slug"),
            {"slug": doc_slug},
        )).first()
        if not row:
            return None
        content = row[0]
        return content if isinstance(content, dict) else None
