"""graph-triple-fe — TripleExtractor LLM provider graceful fallback 테스트.

provider='ollama' 인데 LLM 엔드포인트에 도달 못 하는 환경에서:
  - extract_for_doc 이 예외를 던지지 않고
  - mock 으로 폴백해 본문 [[slug]] placeholder triple 을 돌려준다.

실 LLM 서버 없이 unreachable endpoint (http://127.0.0.1:1) 로 폴백 경로만 검증.
생성한 테스트 문서/triple row 는 try/finally 로 정리 — prod DB 오염 금지.
"""
from __future__ import annotations

import json
import os
import uuid

import pytest
from sqlalchemy import text

from app.core.db import session_scope
from app.services.triple_extractor import ExtractedTriple, TripleExtractor


async def _admin_id(s) -> str:
    row = (await s.execute(
        text("SELECT id FROM users WHERE email = 'admin@mx.local'")
    )).first()
    assert row is not None, "admin@mx.local 시드 유저가 없습니다"
    return str(row[0])


async def _make_doc(slug: str, content: dict) -> None:
    async with session_scope() as s:
        owner = await _admin_id(s)
        await s.execute(
            text("""
                INSERT INTO documents (slug, title, status, content_json, owner_id)
                VALUES (:slug, :title, 'published', CAST(:cj AS jsonb), :owner)
            """),
            {"slug": slug, "title": slug, "cj": json.dumps(content), "owner": owner},
        )
        await s.commit()


async def _cleanup(slug: str) -> None:
    async with session_scope() as s:
        await s.execute(text("DELETE FROM doc_triples WHERE subject_slug = :s"),
                        {"s": slug})
        await s.execute(text("DELETE FROM documents WHERE slug = :s"), {"s": slug})
        await s.commit()


def _content_with_links(*targets: str) -> dict:
    body = " ".join(f"[[{t}]]" for t in targets)
    return {
        "version": "1.0",
        "sections": [{
            "id": "s1", "number": "1", "title": "본문",
            "blocks": [{"id": "b1", "type": "paragraph",
                        "text": f"본문 {body} 끝."}],
        }],
    }


# 도달 불가 엔드포인트 — 127.0.0.1:1 은 연결이 즉시 거부된다.
_UNREACHABLE = "http://127.0.0.1:1"


@pytest.mark.asyncio
async def test_ollama_unreachable_falls_back_to_mock_with_links() -> None:
    """provider='ollama' + 도달 불가 endpoint → mock 폴백, placeholder 반환."""
    slug = f"tx-fb-{uuid.uuid4().hex[:8]}"
    await _make_doc(slug, _content_with_links("oled", "amoled", "lcd"))
    try:
        os.environ["TRIPLE_EXTRACTOR_PROVIDER"] = "ollama"
        os.environ["TRIPLE_EXTRACTOR_ENDPOINT"] = _UNREACHABLE
        async with session_scope() as s:
            ex = TripleExtractor(s)
            out = await ex.extract_for_doc(slug)
        # 폴백한 mock 결과 — 본문에 링크가 있으므로 placeholder 1~2 개.
        assert 1 <= len(out) <= 2
        for t in out:
            assert isinstance(t, ExtractedTriple)
            assert t.object_slug in ("oled", "amoled", "lcd")
            assert t.predicate
            assert 0.0 <= t.confidence <= 1.0
    finally:
        await _cleanup(slug)
        os.environ.pop("TRIPLE_EXTRACTOR_PROVIDER", None)
        os.environ.pop("TRIPLE_EXTRACTOR_ENDPOINT", None)


@pytest.mark.asyncio
async def test_ollama_unreachable_no_links_returns_empty() -> None:
    """후보 링크가 없으면 LLM 호출 자체를 건너뛰고 빈 list — 예외 없음."""
    slug = f"tx-fb-nolink-{uuid.uuid4().hex[:8]}"
    await _make_doc(slug, {"version": "1.0", "sections": [{
        "id": "s1", "number": "1", "title": "본문", "blocks": [
            {"id": "b1", "type": "paragraph", "text": "위키 링크 없는 본문."},
        ]},
    ]})
    try:
        os.environ["TRIPLE_EXTRACTOR_PROVIDER"] = "ollama"
        os.environ["TRIPLE_EXTRACTOR_ENDPOINT"] = _UNREACHABLE
        async with session_scope() as s:
            ex = TripleExtractor(s)
            out = await ex.extract_for_doc(slug)
        assert out == []
    finally:
        await _cleanup(slug)
        os.environ.pop("TRIPLE_EXTRACTOR_PROVIDER", None)
        os.environ.pop("TRIPLE_EXTRACTOR_ENDPOINT", None)


@pytest.mark.asyncio
async def test_ollama_unreachable_missing_doc_returns_empty() -> None:
    """존재하지 않는 문서 — 폴백 경로에서도 예외 없이 빈 list."""
    try:
        os.environ["TRIPLE_EXTRACTOR_PROVIDER"] = "ollama"
        os.environ["TRIPLE_EXTRACTOR_ENDPOINT"] = _UNREACHABLE
        async with session_scope() as s:
            ex = TripleExtractor(s)
            out = await ex.extract_for_doc("no-such-doc-fallback-xyz")
        assert out == []
    finally:
        os.environ.pop("TRIPLE_EXTRACTOR_PROVIDER", None)
        os.environ.pop("TRIPLE_EXTRACTOR_ENDPOINT", None)
