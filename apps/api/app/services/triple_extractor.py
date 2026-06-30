"""LLM 추출기 — 본문에서 (subject, predicate, object) triple 을 뽑는다.

graph-edge-predicates 사이클 2차. provider 는 `TRIPLE_EXTRACTOR_PROVIDER`
환경변수로 고른다:

  - `mock`   (기본): 본문의 [[slug]] 위키 링크 후보 중 1~2 개를 placeholder
                     triple 로 반환. 외부 호출 없음.
  - `ollama` / `openai`: ollama 호환 HTTP API (`POST /api/chat`) 로 실 추출.
                     LLM 엔드포인트에 도달 못 하면 **mock 으로 자동 폴백** —
                     GPU LLM 없는 개발 환경에서도 `/extract` 가 깨지지 않게.

폴백 정책 (graceful degradation): provider 가 ollama/openai 라도 연결 실패 /
타임아웃 / 비-200 응답 / JSON 파싱 실패 시 예외를 던지지 않고 `_mock_extract`
결과를 돌려준다. 운영자가 LLM 미작동을 알 수 있게 폴백 시 logging.warning 한 줄.
"""
from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from typing import Any

import httpx
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.wiki_link_extractor import extract_wiki_links

logger = logging.getLogger(__name__)

# LLM 호출 타임아웃 — LLM 없는 환경에서 /extract 가 오래 멈추지 않게 짧게.
_LLM_TIMEOUT_SECONDS = 8.0


@dataclass
class ExtractedTriple:
    """LLM 이 뽑은 단일 triple. subject 는 호출 측이 이미 알고 있으므로 제외.

    inverse_predicate 는 object 쪽에서 읽는 역방향 자연어 설명 (없으면 None →
    표시 측 fallback).
    """
    predicate: str
    object_slug: str
    confidence: float
    inverse_predicate: str | None = None


class TripleExtractor:
    """LLM 으로 본문에서 (subject, predicate, object) triple 을 뽑는다.

    provider='ollama'/'openai' 면 실 LLM HTTP 호출, 도달 실패 시 mock 폴백.
    provider='mock' 또는 미설정이면 placeholder 추출.
    """

    def __init__(self, s: AsyncSession) -> None:
        self._s = s
        self._provider = os.getenv("TRIPLE_EXTRACTOR_PROVIDER", "mock").strip().lower()
        # endpoint / model 은 호출 시점에 다시 읽어도 되지만, 인스턴스 단위로 고정.
        self._endpoint = os.getenv("TRIPLE_EXTRACTOR_ENDPOINT", "http://localhost:11434").strip()
        self._model = os.getenv("TRIPLE_EXTRACTOR_MODEL", "").strip()
        try:
            self._min_confidence = float(os.getenv("TRIPLE_EXTRACTOR_MIN_CONFIDENCE", "0.5"))
        except ValueError:
            self._min_confidence = 0.5

    async def extract_for_doc(self, doc_slug: str) -> list[ExtractedTriple]:
        """문서 본문에서 triple 후보를 뽑아 반환한다.

        어떤 provider/환경에서도 예외를 던지지 않고 list 를 반환한다.
        LLM provider 라도 엔드포인트 도달 실패 시 mock 으로 폴백한다.
        """
        if self._provider in ("ollama", "openai"):
            return await self._llm_extract(doc_slug)
        return await self._mock_extract(doc_slug)

    async def _mock_extract(self, doc_slug: str) -> list[ExtractedTriple]:
        content = await self._fetch_content_json(doc_slug)
        if content is None:
            return []
        candidates = self._candidate_slugs(content, doc_slug)
        out: list[ExtractedTriple] = []
        for obj in candidates[:2]:
            out.append(ExtractedTriple(
                predicate=f"는_{obj}_와_관련있다",
                object_slug=obj,
                confidence=0.7,
                inverse_predicate="와_관련있다",
            ))
        return out

    async def _llm_extract(self, doc_slug: str) -> list[ExtractedTriple]:
        """실 LLM 으로 추출. 도달 실패 / 응답 이상 시 mock 으로 폴백한다."""
        content = await self._fetch_content_json(doc_slug)
        if content is None:
            return []
        candidates = self._candidate_slugs(content, doc_slug)
        if not candidates:
            # 후보 링크가 없으면 LLM 을 부를 이유가 없다 — object_slug 가 후보
            # 안에 있어야 하므로 어차피 빈 결과. 네트워크 호출 절약.
            return []

        body_text = self._content_to_text(content)
        try:
            raw = await self._call_llm(body_text, candidates)
            triples = self._parse_llm_response(raw, candidates)
            return triples
        except Exception as exc:  # noqa: BLE001 — 어떤 실패든 mock 폴백이 목적.
            # 연결 실패 / 타임아웃 / 비-200 / JSON 파싱 실패 등 — 운영자가
            # LLM 미작동을 알 수 있게 경고 한 줄 남기고 mock 결과로 폴백.
            logger.warning(
                "triple_extractor: LLM provider '%s' (endpoint=%s) 도달 실패 — "
                "mock 으로 폴백합니다: %s",
                self._provider, self._endpoint, exc,
            )
            return await self._mock_extract(doc_slug)

    async def _call_llm(self, body_text: str, candidates: list[str]) -> str:
        """ollama 호환 `/api/chat` 을 호출해 응답 텍스트를 돌려준다.

        실패 (연결/타임아웃/비-200) 시 예외를 던진다 — 호출 측이 폴백한다.
        """
        prompt = self._build_prompt(body_text, candidates)
        url = self._endpoint.rstrip("/") + "/api/chat"
        payload = {
            "model": self._model or "llama3",
            "messages": [{"role": "user", "content": prompt}],
            "stream": False,
            # 가능하면 JSON 으로 강제 — ollama 가 지원하면 파싱이 안정적.
            "format": "json",
        }
        async with httpx.AsyncClient(timeout=_LLM_TIMEOUT_SECONDS) as client:
            resp = await client.post(url, json=payload)
            resp.raise_for_status()
            data = resp.json()
        # ollama /api/chat 응답: {"message": {"content": "..."}}
        msg = data.get("message")
        if isinstance(msg, dict) and isinstance(msg.get("content"), str):
            return msg["content"]
        # /api/generate 호환 응답: {"response": "..."}
        if isinstance(data.get("response"), str):
            return data["response"]
        raise ValueError("LLM 응답에서 텍스트 필드를 찾지 못했습니다")

    def _build_prompt(self, body_text: str, candidates: list[str]) -> str:
        """본문 + 후보 slug 목록으로 triple 추출 프롬프트를 만든다."""
        cand_list = ", ".join(candidates)
        return (
            "다음 문서 본문에서 (술어, 대상) 관계를 추출하라.\n"
            "object_slug 는 반드시 아래 후보 목록 안의 값이어야 한다 "
            "(목록 밖 slug 는 무시된다).\n"
            f"후보 목록: {cand_list}\n\n"
            "결과는 JSON 배열로만 응답하라. 각 원소는 다음 형식:\n"
            '{"predicate": "관계 술어 (subject→object, 한국어)", '
            '"inverse_predicate": "역방향 술어 (object→subject, 한국어)", '
            '"object_slug": "후보 중 하나", '
            '"confidence": 0.0~1.0 의 신뢰도}\n\n'
            "예: subject 가 object 를 인용하면 predicate='인용한다', "
            "inverse_predicate='에 인용된다'.\n\n"
            f"본문:\n{body_text}\n"
        )

    def _parse_llm_response(
        self, raw: str, candidates: list[str]
    ) -> list[ExtractedTriple]:
        """LLM 응답 텍스트를 ExtractedTriple list 로 파싱.

        - 환각 방지: object_slug 가 후보 목록 밖이면 drop.
        - confidence < TRIPLE_EXTRACTOR_MIN_CONFIDENCE 면 drop.
        파싱 자체 실패 시 예외를 던진다 — 호출 측이 mock 으로 폴백한다.
        """
        parsed = self._extract_json_array(raw)
        cand_set = set(candidates)
        out: list[ExtractedTriple] = []
        for item in parsed:
            if not isinstance(item, dict):
                continue
            predicate = item.get("predicate")
            obj = item.get("object_slug")
            conf = item.get("confidence")
            if not isinstance(predicate, str) or not predicate.strip():
                continue
            if not isinstance(obj, str) or obj not in cand_set:
                # 후보 밖 slug — LLM 환각이므로 버린다.
                continue
            try:
                conf_f = float(conf)
            except (TypeError, ValueError):
                continue
            if conf_f < self._min_confidence:
                continue
            inv = item.get("inverse_predicate")
            inv = inv.strip()[:200] if isinstance(inv, str) and inv.strip() else None
            out.append(ExtractedTriple(
                predicate=predicate.strip()[:200],
                object_slug=obj,
                confidence=conf_f,
                inverse_predicate=inv,
            ))
        return out

    @staticmethod
    def _extract_json_array(raw: str) -> list[Any]:
        """LLM 응답에서 JSON 배열을 뽑는다.

        format=json 으로 받으면 배열이 그대로 오지만, 모델이 객체로 감싸거나
        앞뒤 텍스트를 붙일 수 있어 방어적으로 처리한다.
        """
        raw = raw.strip()
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            # 본문 중 첫 '[' ~ 마지막 ']' 구간만 잘라 재시도.
            start = raw.find("[")
            end = raw.rfind("]")
            if start == -1 or end == -1 or end <= start:
                raise
            data = json.loads(raw[start:end + 1])
        if isinstance(data, list):
            return data
        # {"triples": [...]} 같은 래핑 — 내부 list 를 찾는다.
        if isinstance(data, dict):
            for v in data.values():
                if isinstance(v, list):
                    return v
        raise ValueError("LLM 응답에서 JSON 배열을 찾지 못했습니다")

    @staticmethod
    def _candidate_slugs(content: dict[str, Any], doc_slug: str) -> list[str]:
        """본문의 [[slug]] 후보 — 자기 자신 제외, 등장 순서 유지, 중복 제거."""
        seen: list[str] = []
        for link in extract_wiki_links(content):
            tgt = link.get("target_slug")
            if tgt and tgt != doc_slug and tgt not in seen:
                seen.append(tgt)
        return seen

    @staticmethod
    def _content_to_text(content: dict[str, Any]) -> str:
        """DocumentJSON 본문에서 paragraph/quote/callout 텍스트를 모아 평문화.

        LLM 프롬프트용 — 위키 링크 추출 walk 와 같은 텍스트 필드를 살핀다.
        과도하게 길어지지 않게 상한을 둔다 (프롬프트 토큰 절약).
        """
        chunks: list[str] = []

        def walk_block(block: Any) -> None:
            if not isinstance(block, dict):
                return
            btype = block.get("type")
            if btype in ("paragraph", "quote", "callout"):
                t = block.get("text")
                if isinstance(t, str):
                    chunks.append(t)
            if btype == "list":
                for it in block.get("items") or []:
                    if isinstance(it, str):
                        chunks.append(it)
            if btype == "columns":
                for col in block.get("columns") or []:
                    for child in col or []:
                        walk_block(child)
            if btype == "tabs":
                for tab in block.get("tabs") or []:
                    if isinstance(tab, dict):
                        for child in tab.get("blocks") or []:
                            walk_block(child)
            if btype == "accordion":
                for it in block.get("items") or []:
                    if isinstance(it, dict):
                        for child in it.get("blocks") or []:
                            walk_block(child)

        def walk_section(section: Any) -> None:
            if not isinstance(section, dict):
                return
            title = section.get("title")
            if isinstance(title, str):
                chunks.append(title)
            for block in section.get("blocks") or []:
                walk_block(block)
            for sub in section.get("subsections") or []:
                walk_section(sub)

        summary = content.get("summary")
        if isinstance(summary, str):
            chunks.append(summary)
        for section in content.get("sections") or []:
            walk_section(section)

        joined = "\n".join(c for c in chunks if c)
        return joined[:8000]

    async def _fetch_content_json(self, doc_slug: str) -> dict[str, Any] | None:
        row = (await self._s.execute(
            text("SELECT content_json FROM documents WHERE slug = :slug"),
            {"slug": doc_slug},
        )).first()
        if not row:
            return None
        content = row[0]
        return content if isinstance(content, dict) else None
