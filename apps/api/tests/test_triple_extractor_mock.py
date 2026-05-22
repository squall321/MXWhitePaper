"""graph-edge-predicates — TripleExtractor mock provider 단위 테스트.

라우터 무관 — 서비스 객체를 직접 호출. mock provider 는 본문의 [[slug]]
위키 링크 앞 1~2 개를 placeholder triple 로 반환하거나, 링크가 없으면 빈 list.
"""
from __future__ import annotations

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


async def _make_doc(slug: str, content: dict) -> str:
    """테스트용 문서 생성 — id 반환. content_json 은 jsonb."""
    async with session_scope() as s:
        import json
        owner = await _admin_id(s)
        row = (await s.execute(
            text("""
                INSERT INTO documents (slug, title, status, content_json, owner_id)
                VALUES (:slug, :title, 'published', CAST(:cj AS jsonb), :owner)
                RETURNING id
            """),
            {"slug": slug, "title": slug, "cj": json.dumps(content), "owner": owner},
        )).first()
        await s.commit()
        assert row is not None
        return str(row[0])


async def _drop_doc(slug: str) -> None:
    async with session_scope() as s:
        await s.execute(text("DELETE FROM documents WHERE slug = :slug"), {"slug": slug})
        await s.commit()


def _content_with_links(*targets: str) -> dict:
    """[[slug]] 위키 링크가 본문에 들어간 DocumentJSON 스캐폴드.

    DocumentJSON v1.0 — sections[].blocks[] 구조. wiki_link_extractor 는
    section.blocks 의 paragraph.text 를 스캔한다.
    """
    body = " ".join(f"[[{t}]]" for t in targets)
    return {
        "version": "1.0",
        "sections": [
            {
                "id": "s1",
                "number": "1",
                "title": "본문",
                "blocks": [
                    {"id": "b1", "type": "paragraph", "text": f"본문 {body} 끝."},
                ],
            },
        ],
    }


@pytest.mark.asyncio
async def test_mock_returns_placeholder_for_doc_with_links() -> None:
    slug = f"tx-mock-{uuid.uuid4().hex[:8]}"
    await _make_doc(slug, _content_with_links("oled", "amoled", "lcd"))
    try:
        os.environ["TRIPLE_EXTRACTOR_PROVIDER"] = "mock"
        async with session_scope() as s:
            ex = TripleExtractor(s)
            out = await ex.extract_for_doc(slug)
        # mock 은 앞 1~2 개만.
        assert 1 <= len(out) <= 2
        for t in out:
            assert isinstance(t, ExtractedTriple)
            assert 0.0 <= t.confidence <= 1.0
            assert t.object_slug in ("oled", "amoled", "lcd")
            assert t.predicate  # 비어있지 않음
    finally:
        await _drop_doc(slug)
        os.environ.pop("TRIPLE_EXTRACTOR_PROVIDER", None)


@pytest.mark.asyncio
async def test_mock_returns_empty_for_doc_without_links() -> None:
    slug = f"tx-nolink-{uuid.uuid4().hex[:8]}"
    await _make_doc(slug, {"version": "1.0", "sections": [
        {"id": "s1", "number": "1", "title": "본문", "blocks": [
            {"id": "b1", "type": "paragraph", "text": "위키 링크 없는 본문."},
        ]},
    ]})
    try:
        os.environ["TRIPLE_EXTRACTOR_PROVIDER"] = "mock"
        async with session_scope() as s:
            ex = TripleExtractor(s)
            out = await ex.extract_for_doc(slug)
        assert out == []
    finally:
        await _drop_doc(slug)
        os.environ.pop("TRIPLE_EXTRACTOR_PROVIDER", None)


@pytest.mark.asyncio
async def test_mock_returns_empty_for_missing_doc() -> None:
    os.environ["TRIPLE_EXTRACTOR_PROVIDER"] = "mock"
    try:
        async with session_scope() as s:
            ex = TripleExtractor(s)
            out = await ex.extract_for_doc("no-such-doc-xyz")
        assert out == []
    finally:
        os.environ.pop("TRIPLE_EXTRACTOR_PROVIDER", None)


@pytest.mark.asyncio
async def test_non_mock_provider_returns_empty() -> None:
    """provider='openai' 등 — 실 호출은 다음 사이클, 지금은 no-op 빈 list."""
    slug = f"tx-openai-{uuid.uuid4().hex[:8]}"
    await _make_doc(slug, _content_with_links("oled"))
    try:
        os.environ["TRIPLE_EXTRACTOR_PROVIDER"] = "openai"
        async with session_scope() as s:
            ex = TripleExtractor(s)
            out = await ex.extract_for_doc(slug)
        assert out == []
    finally:
        await _drop_doc(slug)
        os.environ.pop("TRIPLE_EXTRACTOR_PROVIDER", None)
