"""Export-side widget marker emission tests.

Verifies that ``emit_marker_text`` returns the correct ``"Widget: <type>"`` text
for widgets that need an export-side marker prepend, returns ``None`` for the
auto-detected opt-out widgets, and that ``render_docx`` actually emits those
markers as plain-text paragraphs for round-trip recognition.
"""
from __future__ import annotations

import io

import ulid
from docx import Document
from pptx import Presentation

from app.services.docx_export import DocxOptions, render_docx
from app.services.pptx_export import PptxOptions, render_pptx
from app.services.widget_markers import emit_marker_text


def _u() -> str:
    return str(ulid.new())


def _build_doc(blocks: list[dict]) -> dict:
    return {
        "schema_version": "1.0",
        "id": _u(),
        "slug": "wm-export-test",
        "title": "T",
        "metadata": {
            "division": "MX",
            "owners": ["t@e.com"],
            "tags": [],
            "confidentiality": "internal",
        },
        "sections": [
            {
                "id": _u(),
                "number": "1",
                "level": 1,
                "title": "sec",
                "blocks": blocks,
                "subsections": [],
            }
        ],
    }


def _all_paragraphs(blob: bytes) -> list[str]:
    return [p.text for p in Document(io.BytesIO(blob)).paragraphs]


def _all_pptx_text(blob: bytes) -> str:
    pres = Presentation(io.BytesIO(blob))
    chunks: list[str] = []
    for slide in pres.slides:
        for shape in slide.shapes:
            if shape.has_text_frame:
                for para in shape.text_frame.paragraphs:
                    for run in para.runs:
                        chunks.append(run.text)
                    chunks.append(para.text)
    return "\n".join(chunks)


# ── emit_marker_text unit tests ──────────────────────────────────────


def test_emit_marker_for_iframe() -> None:
    assert emit_marker_text({"type": "iframe", "src": "http://x"}) == "Widget: iframe"


def test_emit_marker_for_chart_with_variant() -> None:
    assert (
        emit_marker_text({"type": "chart", "chartType": "line"})
        == "Widget: chart (line)"
    )


def test_emit_marker_for_chart_invalid_chartType_no_variant() -> None:
    assert (
        emit_marker_text({"type": "chart", "chartType": "unknown"})
        == "Widget: chart"
    )


def test_emit_marker_for_doc_link_card_uses_marker_key() -> None:
    assert (
        emit_marker_text({"type": "doc-link-card", "slug": "x"})
        == "Widget: doc-link"
    )


def test_emit_marker_for_glossary_ref_uses_marker_key() -> None:
    assert (
        emit_marker_text({"type": "glossary-ref", "term": "x"})
        == "Widget: glossary"
    )


def test_emit_marker_returns_none_for_callout() -> None:
    assert (
        emit_marker_text({"type": "callout", "variant": "warn", "text": "x"})
        is None
    )


def test_emit_marker_returns_none_for_kpi_cards() -> None:
    assert emit_marker_text({"type": "kpi-cards"}) is None


def test_emit_marker_returns_none_for_gallery() -> None:
    assert emit_marker_text({"type": "gallery"}) is None


def test_emit_marker_returns_none_for_columns() -> None:
    assert emit_marker_text({"type": "columns"}) is None


def test_emit_marker_returns_none_for_paragraph() -> None:
    assert emit_marker_text({"type": "paragraph"}) is None


def test_emit_marker_returns_none_for_table() -> None:
    assert emit_marker_text({"type": "table"}) is None


# ── docx render integration tests ────────────────────────────────────


def test_docx_export_emits_marker_for_iframe() -> None:
    doc = _build_doc(
        [{"type": "iframe", "id": _u(), "src": "https://example.com"}]
    )
    blob = render_docx(doc, options=DocxOptions())
    paragraphs = _all_paragraphs(blob)
    assert "Widget: iframe" in paragraphs


def test_docx_export_emits_marker_for_chart() -> None:
    doc = _build_doc(
        [
            {
                "type": "chart",
                "id": _u(),
                "chartType": "line",
                "data": {
                    "labels": ["a", "b"],
                    "series": [{"name": "s1", "values": [1, 2]}],
                },
            }
        ]
    )
    blob = render_docx(doc, options=DocxOptions())
    paragraphs = _all_paragraphs(blob)
    assert "Widget: chart (line)" in paragraphs


def test_docx_export_no_marker_for_callout() -> None:
    doc = _build_doc(
        [{"type": "callout", "id": _u(), "variant": "warn", "text": "hi"}]
    )
    blob = render_docx(doc, options=DocxOptions())
    paragraphs = _all_paragraphs(blob)
    assert not any("Widget: callout" in p for p in paragraphs)


def test_docx_export_no_marker_for_kpi_cards() -> None:
    doc = _build_doc(
        [
            {
                "type": "kpi-cards",
                "id": _u(),
                "items": [{"label": "L", "value": "V"}],
            }
        ]
    )
    blob = render_docx(doc, options=DocxOptions())
    paragraphs = _all_paragraphs(blob)
    assert not any("Widget: kpi" in p for p in paragraphs)


# ── pptx render integration tests ────────────────────────────────────


def test_pptx_export_emits_marker_for_iframe() -> None:
    doc = _build_doc(
        [{"type": "iframe", "id": _u(), "src": "https://example.com"}]
    )
    blob = render_pptx(doc, options=PptxOptions())
    text = _all_pptx_text(blob)
    assert "Widget: iframe" in text


def test_pptx_export_emits_marker_for_chart_with_variant() -> None:
    doc = _build_doc(
        [
            {
                "type": "chart",
                "id": _u(),
                "chartType": "bar",
                "data": {
                    "labels": ["a", "b"],
                    "series": [{"name": "s1", "values": [1, 2]}],
                },
            }
        ]
    )
    blob = render_pptx(doc, options=PptxOptions())
    text = _all_pptx_text(blob)
    assert "Widget: chart (bar)" in text


def test_pptx_export_emits_marker_for_doc_link_card() -> None:
    doc = _build_doc(
        [{"type": "doc-link-card", "slug": "x", "id": _u()}]
    )
    blob = render_pptx(doc, options=PptxOptions())
    text = _all_pptx_text(blob)
    assert "Widget: doc-link" in text


def test_pptx_export_no_marker_for_callout() -> None:
    doc = _build_doc(
        [{"type": "callout", "id": _u(), "variant": "warn", "text": "hi"}]
    )
    blob = render_pptx(doc, options=PptxOptions())
    text = _all_pptx_text(blob)
    assert "Widget: callout" not in text


# ── html render integration tests ────────────────────────────────────


def test_html_export_emits_comment_marker_for_iframe() -> None:
    from app.services.html_renderer import render_namuwiki_html

    doc = _build_doc(
        [{"type": "iframe", "id": _u(), "src": "https://example.com"}]
    )
    out = render_namuwiki_html(doc)
    assert "<!-- Widget: iframe -->" in out


def test_html_export_emits_comment_for_chart_with_variant() -> None:
    from app.services.html_renderer import render_namuwiki_html

    doc = _build_doc(
        [
            {
                "type": "chart",
                "id": _u(),
                "chartType": "line",
                "data": {
                    "labels": ["a", "b"],
                    "series": [{"name": "s1", "values": [1, 2]}],
                },
            }
        ]
    )
    out = render_namuwiki_html(doc)
    assert "<!-- Widget: chart (line) -->" in out


def test_html_export_no_marker_for_callout() -> None:
    from app.services.html_renderer import render_namuwiki_html

    doc = _build_doc(
        [{"type": "callout", "id": _u(), "variant": "warn", "text": "hi"}]
    )
    out = render_namuwiki_html(doc)
    assert "<!-- Widget: callout" not in out


# ── markdown render integration tests ────────────────────────────────


def test_markdown_export_emits_marker_for_iframe() -> None:
    from app.services.markdown_export import render_markdown

    doc = _build_doc(
        [{"type": "iframe", "id": _u(), "src": "https://example.com"}]
    )
    out = render_markdown(doc)
    assert "Widget: iframe" in out


def test_markdown_export_emits_marker_for_chart_with_variant() -> None:
    from app.services.markdown_export import render_markdown

    doc = _build_doc(
        [
            {
                "type": "chart",
                "id": _u(),
                "chartType": "line",
                "data": {
                    "labels": ["a", "b"],
                    "series": [{"name": "s1", "values": [1, 2]}],
                },
            }
        ]
    )
    out = render_markdown(doc)
    assert "Widget: chart (line)" in out


def test_markdown_export_no_marker_for_callout() -> None:
    from app.services.markdown_export import render_markdown

    doc = _build_doc(
        [{"type": "callout", "id": _u(), "variant": "warn", "text": "hi"}]
    )
    out = render_markdown(doc)
    assert "Widget: callout" not in out


# ── pdf / whiteboard / image-annotation: marker + body across renderers ──


def _pdf_block() -> dict:
    return {
        "type": "pdf",
        "id": _u(),
        "file_id": _u(),
        "title": "Spec v1",
        "page": 3,
    }


def _whiteboard_block() -> dict:
    return {
        "type": "whiteboard",
        "id": _u(),
        "viewbox": {"w": 1000, "h": 600},
        "elements": [],
    }


def _image_annotation_block() -> dict:
    return {
        "type": "image-annotation",
        "id": _u(),
        "image_id": _u(),
        "annotations": [],
    }


def test_pptx_export_emits_marker_and_body_for_pdf() -> None:
    doc = _build_doc([_pdf_block()])
    blob = render_pptx(doc, options=PptxOptions())
    text = _all_pptx_text(blob)
    assert "Widget: pdf" in text
    assert "Spec v1" in text
    assert "📕" in text


def test_pptx_export_emits_marker_and_body_for_whiteboard() -> None:
    doc = _build_doc([_whiteboard_block()])
    blob = render_pptx(doc, options=PptxOptions())
    text = _all_pptx_text(blob)
    assert "Widget: whiteboard" in text
    assert "🖼" in text
    assert "1000" in text and "600" in text


def test_pptx_export_emits_marker_and_body_for_image_annotation() -> None:
    block = _image_annotation_block()
    doc = _build_doc([block])
    blob = render_pptx(doc, options=PptxOptions())
    text = _all_pptx_text(blob)
    assert "Widget: image-annotation" in text
    assert "🖼" in text
    assert block["image_id"] in text


def test_html_export_emits_marker_and_body_for_pdf() -> None:
    from app.services.html_renderer import render_namuwiki_html

    doc = _build_doc([_pdf_block()])
    out = render_namuwiki_html(doc)
    assert "<!-- Widget: pdf -->" in out
    assert "widget-pdf" in out
    assert "Spec v1" in out


def test_html_export_emits_marker_and_body_for_whiteboard() -> None:
    from app.services.html_renderer import render_namuwiki_html

    doc = _build_doc([_whiteboard_block()])
    out = render_namuwiki_html(doc)
    assert "<!-- Widget: whiteboard -->" in out
    assert "widget-whiteboard" in out
    assert "1000" in out and "600" in out


def test_html_export_emits_marker_and_body_for_image_annotation() -> None:
    from app.services.html_renderer import render_namuwiki_html

    block = _image_annotation_block()
    doc = _build_doc([block])
    out = render_namuwiki_html(doc)
    assert "<!-- Widget: image-annotation -->" in out
    assert "widget-image-annotation" in out
    assert block["image_id"] in out


def test_markdown_export_emits_marker_and_body_for_pdf() -> None:
    from app.services.markdown_export import render_markdown

    doc = _build_doc([_pdf_block()])
    out = render_markdown(doc)
    assert "Widget: pdf" in out
    assert "PDF" in out
    assert "Spec v1" in out


def test_markdown_export_emits_marker_and_body_for_whiteboard() -> None:
    from app.services.markdown_export import render_markdown

    doc = _build_doc([_whiteboard_block()])
    out = render_markdown(doc)
    assert "Widget: whiteboard" in out
    assert "Whiteboard" in out
    assert "1000" in out and "600" in out


def test_markdown_export_emits_marker_and_body_for_image_annotation() -> None:
    from app.services.markdown_export import render_markdown

    block = _image_annotation_block()
    doc = _build_doc([block])
    out = render_markdown(doc)
    assert "Widget: image-annotation" in out
    assert "Annotated image" in out
    assert block["image_id"] in out
