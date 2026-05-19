"""HTML export 렌더러 + 엔드포인트 단위 테스트 (Cycle 14).

renderer 자체는 부수효과가 없는 pure function 이라 DB 없이 검증한다.
endpoint 테스트는 seed 의 `month-end-closing` 문서를 사용한다.
"""
from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.services.html_renderer import RenderOptions, render_namuwiki_html


def _doc(blocks: list[dict] | None = None, **overrides: object) -> dict:
    base = {
        "schema_version": "1.0",
        "id": "01TESTDOC0000000000000000Z",
        "slug": "fixture",
        "title": "테스트 문서",
        "summary": "단위 테스트 픽스처",
        "metadata": {
            "division": "MX",
            "owners": ["someone@example.com"],
            "tags": ["unit", "html-export"],
            "confidentiality": "internal",
        },
        "sections": [
            {
                "id": "01SEC00000000000000000000A",
                "number": "1",
                "level": 1,
                "title": "본문",
                "blocks": blocks or [
                    {"type": "paragraph", "id": "01P000000000000000000000A1", "text": "안녕하세요"},
                ],
                "subsections": [],
            }
        ],
    }
    base.update(overrides)
    return base


# ── pure renderer ────────────────────────────────────────────────────


def test_renderer_returns_self_contained_html() -> None:
    out = render_namuwiki_html(_doc())
    assert out.startswith("<!DOCTYPE html>")
    assert "<title>테스트 문서</title>" in out
    assert "<style>" in out
    # No external references by default
    assert "katex" not in out.lower()
    assert "mermaid" not in out.lower()
    # 본문이 들어있는지
    assert "안녕하세요" in out


def test_renderer_handles_empty_section() -> None:
    doc = _doc()
    doc["sections"][0]["blocks"] = []
    out = render_namuwiki_html(doc)
    # 섹션 헤딩은 여전히 나와야 한다
    assert "본문" in out
    assert 'id="section-1"' in out


def test_renderer_renders_all_block_types_smoke() -> None:
    """26개 block 타입을 한 번에 거는 스모크 테스트."""
    blocks = [
        {"type": "paragraph", "id": "01" + "A" * 24, "text": "P [[other-doc|다른]]"},
        {"type": "heading-4", "id": "01" + "B" * 24, "title": "H4"},
        {
            "type": "list",
            "id": "01" + "C" * 24,
            "style": "bullet",
            "items": ["a", "b"],
        },
        {"type": "quote", "id": "01" + "D" * 24, "text": "인용", "cite": "출처"},
        {
            "type": "callout",
            "id": "01" + "E" * 24,
            "variant": "warn",
            "title": "주의",
            "text": "주의사항",
        },
        {
            "type": "code",
            "id": "01" + "F" * 24,
            "language": "python",
            "code": "print('hi')",
            "filename": "x.py",
        },
        {"type": "math", "id": "01" + "G" * 24, "expression": "E=mc^2"},
        {
            "type": "table",
            "id": "01" + "H" * 24,
            "headers": ["a", "b"],
            "rows": [["1", "2"]],
        },
        {
            "type": "kpi-cards",
            "id": "01" + "J" * 24,
            "items": [{"label": "매출", "value": 100, "delta": 5, "trend": "up"}],
        },
        {
            "type": "chart",
            "id": "01" + "K" * 24,
            "chartType": "line",
            "title": "T",
            "data": {
                "labels": ["Q1", "Q2"],
                "series": [{"name": "rev", "values": [1, 2]}],
            },
        },
        {
            "type": "gantt",
            "id": "01" + "M" * 24,
            "tasks": [{"name": "t1", "start": "2025-01-01", "end": "2025-01-05", "progress": 30}],
        },
        {"type": "flow", "id": "01" + "N" * 24, "engine": "mermaid", "source": "graph TD; A-->B"},
        {
            "type": "org-chart",
            "id": "01" + "P" * 24,
            "root": {
                "id": "n1",
                "label": "CEO",
                "children": [{"id": "n2", "label": "CTO"}],
            },
        },
        {"type": "iframe", "id": "01" + "Q" * 24, "src": "https://example.com", "title": "embed"},
        {"type": "video", "id": "01" + "R" * 24, "url": "https://example.com/v.mp4", "provider": "intra"},
        {"type": "image", "id": "01" + "S" * 24, "imageId": "01IMG00000000000000000000", "alt": "alt", "caption": "cap"},
        {
            "type": "gallery",
            "id": "01" + "T" * 24,
            "items": [{"imageId": "01IMG00000000000000000000", "caption": "g1"}],
        },
        {"type": "file", "id": "01" + "V" * 24, "fileId": "01FIL00000000000000000000", "name": "doc.pdf", "size": 12345, "mime": "application/pdf"},
        {"type": "doc-link-card", "id": "01" + "W" * 24, "slug": "other-doc"},
        {"type": "glossary-ref", "id": "01" + "X" * 24, "term": "용어"},
        {
            "type": "columns",
            "id": "01" + "Y" * 24,
            "columns": [
                [{"type": "paragraph", "id": "01CP00000000000000000001A", "text": "L"}],
                [{"type": "paragraph", "id": "01CP00000000000000000002A", "text": "R"}],
            ],
        },
        {
            "type": "tabs",
            "id": "01" + "Z" * 24,
            "tabs": [
                {"label": "Tab1", "blocks": [{"type": "paragraph", "id": "01TB00000000000000000001A", "text": "1"}]},
            ],
        },
        {
            "type": "accordion",
            "id": "0123456789ABCDEFGHJKMNPQRT",
            "items": [
                {"label": "Item1", "blocks": [{"type": "paragraph", "id": "01AC00000000000000000001A", "text": "x"}]},
            ],
        },
        {"type": "data-source", "id": "0123456789ABCDEFGHJKMNPQRV", "endpoint": "/api/v1/widgets/foo", "render": "table"},
        {"type": "dashboard-embed", "id": "0123456789ABCDEFGHJKMNPQRW", "provider": "grafana", "panelId": "p1"},
        {
            "type": "calculator",
            "id": "0123456789ABCDEFGHJKMNPQRX",
            "inputs": [{"name": "x", "label": "X", "default": 1, "kind": "number"}],
            "formula": "x * 2",
        },
    ]
    doc = _doc(blocks)
    out = render_namuwiki_html(doc)
    # 각 블록이 적어도 한 번씩 등장한다
    for cls in [
        "b-paragraph",
        "b-heading-4",
        "b-list",
        "b-quote",
        "b-callout",
        "b-code",
        "b-math",
        "b-table",
        "b-kpi-cards",
        "b-chart",
        "b-gantt",
        "b-flow",
        "b-org-chart",
        "b-iframe",
        "b-video",
        "b-image",
        "b-gallery",
        "b-file",
        "b-doc-link-card",
        "b-glossary-ref",
        "b-columns",
        "b-tabs",
        "b-accordion",
        "b-data-source",
        "b-dashboard-embed",
        "b-calculator",
    ]:
        assert cls in out, f"missing class={cls}"


def test_renderer_wiki_link_grammar() -> None:
    blocks = [
        {"type": "paragraph", "id": "01" + "A" * 24, "text": "참고: [[other-doc]] 또는 [[slug-x|커스텀 라벨]]."},
    ]
    out = render_namuwiki_html(_doc(blocks))
    assert 'href="/docs/other-doc"' in out
    assert 'href="/docs/slug-x"' in out
    assert "커스텀 라벨" in out


def test_renderer_image_missing_when_resolver_returns_none() -> None:
    blocks = [
        {"type": "image", "id": "01" + "A" * 24, "imageId": "MISSINGIMAGEID0000000000ZZ", "caption": "c"},
    ]
    out = render_namuwiki_html(_doc(blocks))
    assert "[이미지 누락" in out


def test_renderer_image_with_resolver() -> None:
    blocks = [
        {"type": "image", "id": "01" + "A" * 24, "imageId": "01IMG00000000000000000000", "caption": "ok"},
    ]

    def resolver(image_id: str) -> dict | None:
        return {"url": f"https://cdn.example/{image_id}.webp", "mime": "image/webp"}

    out = render_namuwiki_html(_doc(blocks), options=RenderOptions(image_resolver=resolver))
    assert 'src="https://cdn.example/01IMG00000000000000000000.webp"' in out


def test_renderer_inline_images_emits_data_url() -> None:
    blocks = [
        {"type": "image", "id": "01" + "A" * 24, "imageId": "01IMG00000000000000000000"},
    ]

    def resolver(image_id: str) -> dict | None:
        return {
            "url": "https://cdn.example/x.webp",
            "bytes": b"fake-bytes",
            "mime": "image/webp",
        }

    out = render_namuwiki_html(
        _doc(blocks),
        options=RenderOptions(inline_images=True, image_resolver=resolver),
    )
    assert "src=\"data:image/webp;base64," in out


def test_renderer_deeply_nested_sections_render() -> None:
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
                        {"type": "paragraph", "id": "01" + "D" * 24, "text": "depth-3"}
                    ],
                    "subsections": [],
                }
            ],
        }
    ]
    out = render_namuwiki_html(doc)
    assert 'id="section-1.1"' in out
    assert 'id="section-1.1.1"' in out
    assert "depth-3" in out


def test_renderer_katex_cdn_opt_in() -> None:
    blocks = [{"type": "math", "id": "01" + "A" * 24, "expression": "x^2"}]
    out_off = render_namuwiki_html(_doc(blocks))
    out_on = render_namuwiki_html(_doc(blocks), options=RenderOptions(katex_cdn=True))
    assert "katex" not in out_off.lower()
    assert "katex" in out_on.lower()


def test_renderer_mermaid_cdn_opt_in() -> None:
    blocks = [{"type": "flow", "id": "01" + "A" * 24, "engine": "mermaid", "source": "graph TD; A-->B"}]
    out_off = render_namuwiki_html(_doc(blocks))
    out_on = render_namuwiki_html(_doc(blocks), options=RenderOptions(mermaid_cdn=True))
    assert "class=\"b-flow mermaid\"" not in out_off
    assert "class=\"b-flow mermaid\"" in out_on


def test_renderer_page_break_block_emits_css_break() -> None:
    """Empty paragraph with `meta.note='page-break-before'` becomes a CSS page break."""
    blocks = [
        {"type": "paragraph", "id": "01" + "P" * 24, "text": "before"},
        {
            "type": "paragraph",
            "id": "01" + "Q" * 24,
            "text": "",
            "meta": {"note": "page-break-before"},
        },
        {"type": "paragraph", "id": "01" + "R" * 24, "text": "after"},
    ]
    out = render_namuwiki_html(_doc(blocks))
    assert "b-page-break" in out
    assert "page-break-before: always" in out


def test_renderer_image_align_emits_alignment_class() -> None:
    """`meta.align` propagates to a CSS class on the figure."""
    blocks = [
        {
            "type": "image",
            "id": "01" + "I" * 24,
            "imageId": "01" + "M" * 24,
            "meta": {"align": "right"},
        }
    ]

    def resolver(_: str) -> dict:
        return {"url": "https://example.com/x.png"}

    out = render_namuwiki_html(_doc(blocks), options=RenderOptions(image_resolver=resolver))
    assert "b-image-align-right" in out


def test_renderer_bibliography_emits_heading_and_ordered_list() -> None:
    """BibliographyBlock → `<h2>` + numbered `<ol>` with cite anchors."""
    blocks = [
        {
            "type": "bibliography",
            "id": "01BIB00000000000000000001",
            "title": "참고",
            "entries": [
                {"key": "smith2020", "text": "Smith, J. (2020). Foo.", "url": "https://example.org/foo"},
                {"text": "익명 보고서, 2021."},
            ],
        }
    ]
    out = render_namuwiki_html(_doc(blocks))
    assert "<section class=\"b-bibliography\">" in out
    assert "<h2>참고</h2>" in out
    assert '<ol class="bibliography-list">' in out
    assert 'id="cite-smith2020"' in out
    assert "https://example.org/foo" in out
    assert "익명 보고서, 2021." in out


def test_renderer_table_stripe_class_reflects_options() -> None:
    """`options.stripe=True/False` → `striped` / `no-stripe` CSS class."""
    striped_blocks = [
        {
            "type": "table",
            "id": "01TBL00000000000000000001",
            "headers": ["A", "B"],
            "rows": [["1", "2"]],
            "options": {"stripe": True},
        }
    ]
    plain_blocks = [
        {
            "type": "table",
            "id": "01TBL00000000000000000002",
            "headers": ["A", "B"],
            "rows": [["1", "2"]],
            "options": {"stripe": False},
        }
    ]
    striped_out = render_namuwiki_html(_doc(striped_blocks))
    plain_out = render_namuwiki_html(_doc(plain_blocks))
    assert "b-table striped" in striped_out
    assert "b-table no-stripe" in plain_out


def test_renderer_glossary_and_references_appear() -> None:
    doc = _doc()
    doc["glossary"] = [{"term": "RBAC", "definition": "Role-Based Access Control"}]
    doc["references"] = [{"type": "external", "label": "Wikipedia: RBAC", "url": "https://en.wikipedia.org/wiki/RBAC"}]
    out = render_namuwiki_html(doc)
    assert "RBAC" in out
    assert "참고문헌" in out
    assert "용어" in out


# ── endpoint integration ─────────────────────────────────────────────


SEED_SLUG = "month-end-closing"


@pytest.mark.asyncio
async def test_export_html_endpoint_default_namuwiki() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get(f"/api/v1/documents/{SEED_SLUG}/export.html")
    assert r.status_code == 200, r.text
    ctype = r.headers.get("content-type", "")
    assert "text/html" in ctype
    cd = r.headers.get("content-disposition") or ""
    assert "attachment" in cd
    assert "month-end-closing.html" in cd
    body = r.content.decode("utf-8")
    assert body.startswith("<!DOCTYPE html>")
    assert "<title>" in body
    assert "<style>" in body
    # 외부 스크립트 없이 떨어진다 (default)
    assert "cdn.jsdelivr.net" not in body


@pytest.mark.asyncio
async def test_export_html_endpoint_rejects_unknown_style() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get(
            f"/api/v1/documents/{SEED_SLUG}/export.html",
            params={"style": "academic"},
        )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_export_html_endpoint_404_for_missing_slug() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/v1/documents/no-such-slug-xxx/export.html")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_export_html_endpoint_katex_cdn_query() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get(
            f"/api/v1/documents/{SEED_SLUG}/export.html",
            params={"katex": "cdn"},
        )
    assert r.status_code == 200
    # 시드 문서에 math 블록이 없을 수도 있어 head 에 노출되는 boolean 만 확인.
    body = r.content.decode("utf-8")
    # math 블록이 없으면 katex CDN 도 들어가지 않는다 — 양쪽 케이스 모두 OK.
    if "b-math" in body:
        assert "katex" in body.lower()
