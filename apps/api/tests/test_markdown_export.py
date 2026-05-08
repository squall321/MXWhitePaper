"""Markdown export 렌더러 단위 테스트.

renderer 자체는 부수효과 없는 pure function. endpoint 통합은 한 건만 스모크.
"""
from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.services.markdown_export import render_markdown


def _doc(blocks: list[dict] | None = None, **overrides: object) -> dict:
    base = {
        "schema_version": "1.0",
        "id": "01TESTDOC0000000000000000Z",
        "slug": "fixture-md",
        "title": "마크다운 문서",
        "summary": "단위 테스트 픽스처",
        "metadata": {
            "division": "MX",
            "owners": ["someone@example.com"],
            "tags": ["unit", "md"],
            "confidentiality": "internal",
        },
        "sections": [
            {
                "id": "01SEC00000000000000000000A",
                "number": "1",
                "level": 1,
                "title": "본문",
                "blocks": blocks or [
                    {"type": "paragraph", "id": "01P000000000000000000000A1", "text": "첫 문단"},
                ],
                "subsections": [],
            }
        ],
    }
    base.update(overrides)
    return base


# ── pure renderer ────────────────────────────────────────────────────


def test_renderer_emits_h1_title_and_section_h2() -> None:
    out = render_markdown(_doc())
    assert out.startswith("# 마크다운 문서")
    # level=1 section → ##
    assert "## 1 본문" in out
    assert "첫 문단" in out


def test_renderer_metadata_block_can_be_disabled() -> None:
    with_meta = render_markdown(_doc())
    no_meta = render_markdown(_doc(), include_metadata=False)
    assert "| slug |" in with_meta
    assert "| slug |" not in no_meta
    # title and body still present
    assert no_meta.startswith("# 마크다운 문서")
    assert "첫 문단" in no_meta


def test_renderer_paragraph_converts_wiki_links() -> None:
    blocks = [
        {
            "type": "paragraph",
            "id": "01P000000000000000000001A",
            "text": "참고: [[other-doc]] / [[slug-x|커스텀]] / [[#section-1.1|섹션]]",
        }
    ]
    out = render_markdown(_doc(blocks))
    assert "[other-doc](/docs/other-doc)" in out
    assert "[커스텀](/docs/slug-x)" in out
    assert "[섹션](#section-1.1)" in out


def test_renderer_lists_bullet_number_check() -> None:
    blocks = [
        {"type": "list", "id": "01L1A0000000000000000001A", "style": "bullet", "items": ["a", "b"]},
        {"type": "list", "id": "01L1B0000000000000000001A", "style": "number", "items": ["x", "y"]},
        {"type": "list", "id": "01L1C0000000000000000001A", "style": "check", "items": ["todo1", "todo2"]},
    ]
    out = render_markdown(_doc(blocks))
    assert "- a" in out and "- b" in out
    assert "1. x" in out and "2. y" in out
    assert "- [ ] todo1" in out
    assert "- [ ] todo2" in out


def test_renderer_nested_list_indents_with_two_spaces() -> None:
    blocks = [
        {
            "type": "list",
            "id": "01L1D0000000000000000001A",
            "style": "bullet",
            "items": [
                {"text": "depth0", "depth": 0},
                {"text": "depth1", "depth": 1},
                {"text": "depth2", "depth": 2},
            ],
        }
    ]
    out = render_markdown(_doc(blocks))
    assert "- depth0" in out
    assert "  - depth1" in out
    assert "    - depth2" in out


def test_renderer_table_emits_gfm() -> None:
    blocks = [
        {
            "type": "table",
            "id": "01T1A0000000000000000001A",
            "headers": ["이름", "수량"],
            "rows": [["사과", "3"], ["배 | 일", "2"]],
        }
    ]
    out = render_markdown(_doc(blocks))
    assert "| 이름 | 수량 |" in out
    assert "| --- | --- |" in out
    assert "| 사과 | 3 |" in out
    # pipe in cell must be escaped
    assert "배 \\| 일" in out


def test_renderer_code_block_uses_fence_with_language() -> None:
    blocks = [
        {
            "type": "code",
            "id": "01C1A0000000000000000001A",
            "language": "python",
            "code": "print('hi')",
            "filename": "x.py",
        }
    ]
    out = render_markdown(_doc(blocks))
    assert "```python" in out
    assert "print('hi')" in out
    assert "_x.py_" in out


def test_renderer_code_block_escapes_internal_triple_backtick() -> None:
    blocks = [
        {
            "type": "code",
            "id": "01C1B0000000000000000001A",
            "language": "md",
            "code": "before\n```python\nx\n```\nafter",
        }
    ]
    out = render_markdown(_doc(blocks))
    # The fence is bumped to 4 backticks because the body contains 3.
    assert "````md" in out


def test_renderer_callout_emits_blockquote_admonition() -> None:
    blocks = [
        {
            "type": "callout",
            "id": "01CA0000000000000000001A",
            "variant": "warn",
            "title": "주의",
            "text": "조심하세요\n두번째 줄",
        }
    ]
    out = render_markdown(_doc(blocks))
    assert "> [!WARN]" in out
    assert "> **주의**" in out
    assert "> 조심하세요" in out
    assert "> 두번째 줄" in out


def test_renderer_quote_with_citation() -> None:
    blocks = [
        {"type": "quote", "id": "01QU0000000000000000001A", "text": "인용문", "cite": "출처"}
    ]
    out = render_markdown(_doc(blocks))
    assert "> 인용문" in out
    assert "> — 출처" in out


def test_renderer_math_block_and_inline() -> None:
    blocks = [
        {"type": "math", "id": "01M10000000000000000001A", "expression": "E = mc^2"},
        {
            "type": "math",
            "id": "01M20000000000000000001A",
            "expression": "x^2",
            "display": "inline",
        },
    ]
    out = render_markdown(_doc(blocks))
    assert "$$\nE = mc^2\n$$" in out
    assert "$x^2$" in out


def test_renderer_page_break_paragraph_becomes_hr() -> None:
    blocks = [
        {"type": "paragraph", "id": "01P00000000000000000001A", "text": "before"},
        {
            "type": "paragraph",
            "id": "01P00000000000000000002A",
            "text": "",
            "meta": {"note": "page-break-before"},
        },
        {"type": "paragraph", "id": "01P00000000000000000003A", "text": "after"},
    ]
    out = render_markdown(_doc(blocks))
    # The empty page-break paragraph collapses to a thematic break.
    assert "\n---\n" in out


def test_renderer_chart_emits_data_table() -> None:
    blocks = [
        {
            "type": "chart",
            "id": "01CH0000000000000000001A",
            "chartType": "line",
            "title": "T",
            "data": {
                "labels": ["Q1", "Q2"],
                "series": [{"name": "rev", "values": [1, 2]}],
            },
        }
    ]
    out = render_markdown(_doc(blocks))
    assert "**T**" in out
    assert "| 계열 | Q1 | Q2 |" in out
    assert "| rev | 1 | 2 |" in out


def test_renderer_flow_emits_mermaid_fence() -> None:
    blocks = [
        {
            "type": "flow",
            "id": "01FL0000000000000000001A",
            "engine": "mermaid",
            "source": "graph TD; A-->B",
        }
    ]
    out = render_markdown(_doc(blocks))
    assert "```mermaid" in out
    assert "graph TD; A-->B" in out


def test_renderer_image_and_file_emit_links() -> None:
    blocks = [
        {
            "type": "image",
            "id": "01I10000000000000000001A",
            "imageId": "01IMG00000000000000000000",
            "caption": "그림 1",
        },
        {
            "type": "file",
            "id": "01F10000000000000000001A",
            "fileId": "01FIL00000000000000000000",
            "name": "doc.pdf",
        },
    ]
    out = render_markdown(_doc(blocks))
    assert "![그림 1](/api/v1/images/01IMG00000000000000000000)" in out
    assert "[doc.pdf](/api/v1/files/01FIL00000000000000000000/download)" in out


def test_renderer_doc_link_card_and_glossary_ref() -> None:
    blocks = [
        {"type": "doc-link-card", "id": "01D10000000000000000001A", "slug": "other"},
        {"type": "glossary-ref", "id": "01G10000000000000000001A", "term": "RBAC"},
    ]
    out = render_markdown(_doc(blocks))
    assert "[other](/docs/other)" in out
    assert "_RBAC_" in out


def test_renderer_nested_sections_emit_progressive_headings() -> None:
    doc = _doc()
    doc["sections"][0]["subsections"] = [
        {
            "id": "01SUB000000000000000000001",
            "number": "1.1",
            "level": 2,
            "title": "서브",
            "blocks": [],
            "subsections": [
                {
                    "id": "01SUBSUB0000000000000000A1",
                    "number": "1.1.1",
                    "level": 3,
                    "title": "딥",
                    "blocks": [
                        {"type": "paragraph", "id": "01P00000000000000000005A", "text": "depth-3"}
                    ],
                    "subsections": [],
                }
            ],
        }
    ]
    out = render_markdown(doc)
    assert "## 1 본문" in out
    assert "### 1.1 서브" in out
    assert "#### 1.1.1 딥" in out
    assert "depth-3" in out


def test_renderer_glossary_and_references_appear() -> None:
    doc = _doc()
    doc["glossary"] = [{"term": "RBAC", "definition": "Role-Based Access Control"}]
    doc["references"] = [
        {"label": "Wikipedia: RBAC", "url": "https://en.wikipedia.org/wiki/RBAC"}
    ]
    out = render_markdown(doc)
    assert "## 참고문헌" in out
    assert "[Wikipedia: RBAC](https://en.wikipedia.org/wiki/RBAC)" in out
    assert "## 용어" in out
    assert "**RBAC**: Role-Based Access Control" in out


# ── endpoint integration ─────────────────────────────────────────────


SEED_SLUG = "month-end-closing"


@pytest.mark.asyncio
async def test_export_markdown_endpoint_returns_attachment() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post("/api/v1/exports/markdown", json={"slug": SEED_SLUG})
    assert r.status_code == 200, r.text
    ctype = r.headers.get("content-type", "")
    assert "text/markdown" in ctype
    cd = r.headers.get("content-disposition") or ""
    assert "attachment" in cd
    assert f"{SEED_SLUG}.md" in cd
    body = r.content.decode("utf-8")
    assert body.startswith("# ")


@pytest.mark.asyncio
async def test_export_markdown_endpoint_404_for_missing_slug() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post(
            "/api/v1/exports/markdown",
            json={"slug": "no-such-slug-xxx-xxx"},
        )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_export_markdown_endpoint_rejects_missing_slug() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post("/api/v1/exports/markdown", json={})
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_export_pdf_endpoint_501_when_weasyprint_missing() -> None:
    """WeasyPrint 미설치 환경에서 PDF 엔드포인트는 501 + 가이드 메시지."""
    from app.routers import exports as exports_router_mod

    if exports_router_mod._WEASYPRINT is not None:
        pytest.skip("WeasyPrint 가 설치된 환경 — 이 케이스는 미설치 가정 테스트.")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post("/api/v1/exports/pdf", json={"slug": SEED_SLUG})
    assert r.status_code == 501
    body = r.json()
    assert body.get("error", {}).get("code") == "PDF_EXPORT_UNAVAILABLE"
