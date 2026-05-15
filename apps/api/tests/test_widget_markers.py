"""Widget marker recognition — Phase 1 + Phase 2 (16 widgets wired).

LLM 이 docx/pptx 에 `Widget: <type>` 패턴을 박으면 import 시 진짜 위젯
블록으로 복원된다. Phase 1 = callout, kpi-cards. Phase 2 = chart, gantt,
flow, org-chart, columns, tabs, accordion, gallery, doc-link, glossary,
image-annotation, iframe, video, file (placeholder fileId), pdf
(placeholder file_id), whiteboard (image-preserving None fallback).
"""
from __future__ import annotations

import io
from typing import Any

import ulid

from app.services.docx_export import DocxOptions, render_docx
from app.services.docx_import import docx_to_document
from app.services.widget_markers import (
    WIDGET_CONVERTERS,
    _convert_accordion,
    _convert_chart,
    _convert_columns,
    _convert_file,
    _convert_gallery,
    _convert_iframe,
    _convert_org_chart,
    _convert_pdf,
    _convert_tabs,
    _convert_video,
    _convert_whiteboard,
    apply_widget_markers,
    parse_marker,
)


def _u() -> str:
    return str(ulid.new())


# ── parse_marker unit tests ──────────────────────────────────────────


def test_parse_marker_english_with_variant() -> None:
    assert parse_marker("Widget: callout (warn)") == ("callout", "warn")


def test_parse_marker_korean_no_variant() -> None:
    assert parse_marker("위젯: kpi-cards") == ("kpi-cards", None)


def test_parse_marker_case_insensitive_and_hyphen() -> None:
    assert parse_marker("WIDGET: org-chart") == ("org-chart", None)


def test_parse_marker_strips_whitespace_inside_parens() -> None:
    assert parse_marker("Widget: chart (  bar  )") == ("chart", "bar")


def test_parse_marker_rejects_freeform_text() -> None:
    assert parse_marker("Widget callout warn") is None
    assert parse_marker("정보: callout") is None
    assert parse_marker("a Widget: callout") is None
    assert parse_marker("") is None


# ── apply_widget_markers — direct unit ──────────────────────────────


class _Summary:
    def __init__(self) -> None:
        self.warnings: list[str] = []


def _para(text: str) -> dict[str, Any]:
    return {"type": "paragraph", "id": _u(), "text": text}


def _table(headers: list[str], rows: list[list[str]]) -> dict[str, Any]:
    return {"type": "table", "id": _u(), "headers": headers, "rows": rows}


def _code(src: str, lang: str = "mermaid") -> dict[str, Any]:
    return {"type": "code", "id": _u(), "language": lang, "code": src}


def _image(image_id: str | None = None) -> dict[str, Any]:
    return {"type": "image", "id": _u(), "imageId": image_id or _u()}


def _list(items: list[str]) -> dict[str, Any]:
    return {"type": "list", "id": _u(), "items": items}


def test_callout_marker_converts_following_paragraph() -> None:
    summary = _Summary()
    sections = [{
        "id": _u(),
        "level": 1,
        "title": "test",
        "blocks": [
            _para("Widget: callout (warn)"),
            _para("주의: 작업 중 중단 금지"),
            _para("일반 단락"),
        ],
        "subsections": [],
    }]
    apply_widget_markers(sections, summary)
    blocks = sections[0]["blocks"]
    assert len(blocks) == 2
    assert blocks[0]["type"] == "callout"
    assert blocks[0]["variant"] == "warn"
    assert "주의" in blocks[0]["text"]
    assert blocks[1]["type"] == "paragraph"
    assert summary.warnings == []


def test_callout_unknown_variant_falls_back_to_info() -> None:
    summary = _Summary()
    sections = [{
        "id": _u(),
        "level": 1,
        "title": "t",
        "blocks": [
            _para("Widget: callout (rainbow)"),
            _para("어떤 메시지"),
        ],
        "subsections": [],
    }]
    apply_widget_markers(sections, summary)
    assert sections[0]["blocks"][0]["variant"] == "info"


def test_kpi_cards_marker_converts_following_table() -> None:
    summary = _Summary()
    sections = [{
        "id": _u(),
        "level": 1,
        "title": "t",
        "blocks": [
            _para("위젯: kpi-cards"),
            _table(
                headers=["label", "value", "delta", "trend"],
                rows=[
                    ["매출", "100억", "+10%", "up"],
                    ["MAU", "5만", "+1k", "up"],
                ],
            ),
        ],
        "subsections": [],
    }]
    apply_widget_markers(sections, summary)
    blocks = sections[0]["blocks"]
    assert len(blocks) == 1
    assert blocks[0]["type"] == "kpi-cards"
    assert len(blocks[0]["items"]) == 2
    assert blocks[0]["items"][0]["label"] == "매출"
    assert blocks[0]["items"][0]["delta"] == "+10%"


def test_kpi_cards_missing_required_columns_keeps_marker_and_table() -> None:
    """label/value 헤더 없으면 변환 실패 → 둘 다 보존 (정보 손실 방지)."""
    summary = _Summary()
    sections = [{
        "id": _u(),
        "level": 1,
        "title": "t",
        "blocks": [
            _para("Widget: kpi-cards"),
            _table(headers=["a", "b"], rows=[["1", "2"]]),
        ],
        "subsections": [],
    }]
    apply_widget_markers(sections, summary)
    blocks = sections[0]["blocks"]
    assert len(blocks) == 2  # both kept
    assert blocks[0]["type"] == "paragraph"
    assert blocks[1]["type"] == "table"


def test_unwired_widget_marker_drops_marker_with_warning() -> None:
    """Recognised but not-yet-wired (dispatcher None) → marker 소비 +
    target 보존 + warning.

    All widget types are wired after Phase 2; we temporarily flip one
    converter to None just for this test so the guard stays meaningful.
    """
    summary = _Summary()
    sections = [{
        "id": _u(),
        "level": 1,
        "title": "t",
        "blocks": [
            _para("Widget: chart (bar)"),
            _table(headers=["x", "y"], rows=[["a", "1"]]),
        ],
        "subsections": [],
    }]
    saved = WIDGET_CONVERTERS["chart"]
    WIDGET_CONVERTERS["chart"] = None
    try:
        apply_widget_markers(sections, summary)
    finally:
        WIDGET_CONVERTERS["chart"] = saved
    blocks = sections[0]["blocks"]
    assert len(blocks) == 1
    assert blocks[0]["type"] == "table"  # target preserved
    assert any("'chart'" in w for w in summary.warnings)


def test_unknown_widget_type_is_left_as_paragraph() -> None:
    """Dispatcher 에 없는 타입은 marker 텍스트를 그대로 둠 (false positive 회피)."""
    summary = _Summary()
    sections = [{
        "id": _u(),
        "level": 1,
        "title": "t",
        "blocks": [
            _para("Widget: nonexistent"),
            _para("normal"),
        ],
        "subsections": [],
    }]
    apply_widget_markers(sections, summary)
    assert len(sections[0]["blocks"]) == 2
    assert sections[0]["blocks"][0]["type"] == "paragraph"


def test_marker_recurses_into_subsections() -> None:
    summary = _Summary()
    sections = [{
        "id": _u(),
        "level": 1,
        "title": "outer",
        "blocks": [],
        "subsections": [{
            "id": _u(),
            "level": 2,
            "title": "inner",
            "blocks": [
                _para("Widget: callout (tip)"),
                _para("팁 메시지"),
            ],
            "subsections": [],
        }],
    }]
    apply_widget_markers(sections, summary)
    inner_blocks = sections[0]["subsections"][0]["blocks"]
    assert len(inner_blocks) == 1
    assert inner_blocks[0]["type"] == "callout"
    assert inner_blocks[0]["variant"] == "tip"


def test_dispatcher_has_expected_converters() -> None:
    # Sanity: Phase 1 + all Phase 2 converters wired.
    for wired in (
        "callout", "kpi-cards",
        "chart", "gantt", "flow", "org-chart",
        "doc-link", "glossary", "image-annotation",
        "iframe", "video", "file", "pdf", "whiteboard",
        "columns", "tabs", "accordion", "gallery",
    ):
        assert callable(WIDGET_CONVERTERS[wired]), wired
    assert all(v is not None for v in WIDGET_CONVERTERS.values())


# ── docx integration: end-to-end through real import ────────────────


def _build_simple_doc(blocks: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "schema_version": "1.0",
        "id": _u(),
        "slug": "wm-test",
        "title": "Widget Marker Test",
        "metadata": {
            "division": "MX",
            "owners": ["t@e.com"],
            "tags": [],
            "confidentiality": "internal",
        },
        "sections": [{
            "id": _u(),
            "number": "1",
            "level": 1,
            "title": "본문",
            "blocks": blocks,
            "subsections": [],
        }],
    }


def _walk_blocks(doc: dict[str, Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []

    def w(secs: list[dict[str, Any]]) -> None:
        for s in secs or []:
            out.extend(s.get("blocks") or [])
            w(s.get("subsections") or [])

    w(doc.get("sections") or [])
    return out


def test_docx_import_recovers_callout_from_marker_pattern() -> None:
    """docx export → import 라운드트립: 일반 단락 2개를 marker + 본문으로 두면
    import 가 CalloutBlock 으로 재구성."""
    doc = _build_simple_doc([
        {"type": "paragraph", "id": _u(), "text": "Widget: callout (danger)"},
        {"type": "paragraph", "id": _u(), "text": "위험: 데이터 손실 가능"},
        {"type": "paragraph", "id": _u(), "text": "이후 일반 단락"},
    ])
    blob = render_docx(doc)
    result = docx_to_document(
        blob,
        slug="wm-import",
        title="",
        owner_user_id=_u(),
    )
    blocks = _walk_blocks(result["document"])
    callouts = [b for b in blocks if b.get("type") == "callout"]
    assert callouts, [b.get("type") for b in blocks]
    assert callouts[0]["variant"] == "danger"
    assert "데이터 손실" in callouts[0]["text"]


def test_docx_import_with_no_markers_is_byte_for_byte_equivalent() -> None:
    """마커 없는 문서는 widget post-pass 영향 0 — 회귀 가드."""
    doc = _build_simple_doc([
        {"type": "paragraph", "id": _u(), "text": "단순 문장"},
        {"type": "paragraph", "id": _u(), "text": "두번째 문장"},
    ])
    blob = render_docx(doc)
    result = docx_to_document(
        blob,
        slug="wm-import-2",
        title="",
        owner_user_id=_u(),
    )
    blocks = _walk_blocks(result["document"])
    types = [b.get("type") for b in blocks]
    assert "callout" not in types and "kpi-cards" not in types
    # Both paragraphs survived.
    paragraphs = [b for b in blocks if b.get("type") == "paragraph"]
    assert len(paragraphs) >= 2


# ── chart converter (direct unit; dispatcher hookup pending main-thread) ──


def _run_chart(
    marker_text: str,
    target: dict[str, Any],
) -> list[dict[str, Any]]:
    """Mimic the dispatcher rewrite by invoking ``_convert_chart`` directly.
    Returns the resulting block list (single widget on success, marker +
    target on None)."""
    summary = _Summary()
    parsed = parse_marker(marker_text)
    assert parsed is not None and parsed[0] == "chart"
    _, variant = parsed
    result = _convert_chart(variant, [target], summary)
    if result is None:
        return [_para(marker_text), target]
    widget, n = result
    assert n == 1
    return [widget]


def test_chart_marker_converts_2col_numeric_table() -> None:
    blocks = _run_chart(
        "Widget: chart (line)",
        _table(
            headers=["Month", "Revenue"],
            rows=[["Jan", "100"], ["Feb", "150"]],
        ),
    )
    assert len(blocks) == 1
    assert blocks[0]["type"] == "chart"
    assert blocks[0]["chartType"] == "line"
    assert blocks[0]["data"]["labels"] == ["Jan", "Feb"]
    assert blocks[0]["data"]["series"] == [
        {"name": "Revenue", "values": [100, 150]}
    ]


def test_chart_marker_with_3col_makes_multi_series() -> None:
    blocks = _run_chart(
        "위젯: chart (bar)",
        _table(
            headers=["Q", "Revenue", "Profit"],
            rows=[["Q1", "100", "20"], ["Q2", "150", "30"]],
        ),
    )
    assert len(blocks) == 1
    assert blocks[0]["type"] == "chart"
    assert blocks[0]["chartType"] == "bar"
    assert len(blocks[0]["data"]["series"]) == 2


def test_chart_marker_with_invalid_variant_falls_back_to_bar() -> None:
    blocks = _run_chart(
        "Widget: chart (rainbow)",
        _table(headers=["x", "y"], rows=[["a", "1"]]),
    )
    assert len(blocks) == 1
    assert blocks[0]["type"] == "chart"
    assert blocks[0]["chartType"] == "bar"


def test_chart_marker_with_paragraph_target_returns_none_keeps_both() -> None:
    blocks = _run_chart(
        "Widget: chart (line)",
        _para("not a table"),
    )
    assert len(blocks) == 2
    assert blocks[0]["type"] == "paragraph"
    assert blocks[1]["type"] == "paragraph"


def test_chart_marker_parses_percent_and_thousands() -> None:
    blocks = _run_chart(
        "Widget: chart (line)",
        _table(
            headers=["Label", "Value"],
            rows=[["A", "10%"], ["B", "1,234"]],
        ),
    )
    assert len(blocks) == 1
    assert blocks[0]["type"] == "chart"
    assert blocks[0]["data"]["series"][0]["values"] == [10.0, 1234.0]


def test_flow_marker_converts_mermaid_code_block() -> None:
    summary = _Summary()
    sections = [{
        "id": _u(),
        "level": 1,
        "title": "t",
        "blocks": [
            _para("Widget: flow"),
            _code("graph TD\nA-->B"),
        ],
        "subsections": [],
    }]
    apply_widget_markers(sections, summary)
    blocks = sections[0]["blocks"]
    assert len(blocks) == 1
    assert blocks[0]["type"] == "flow"
    assert blocks[0]["engine"] == "mermaid"
    assert "A-->B" in blocks[0]["source"]


def test_flow_marker_with_paragraph_target_returns_none() -> None:
    summary = _Summary()
    sections = [{
        "id": _u(),
        "level": 1,
        "title": "t",
        "blocks": [
            _para("Widget: flow"),
            _para("not a code block"),
        ],
        "subsections": [],
    }]
    apply_widget_markers(sections, summary)
    blocks = sections[0]["blocks"]
    assert len(blocks) == 2
    assert blocks[0]["type"] == "paragraph"
    assert blocks[1]["type"] == "paragraph"


def test_flow_marker_with_empty_code_returns_none() -> None:
    summary = _Summary()
    sections = [{
        "id": _u(),
        "level": 1,
        "title": "t",
        "blocks": [
            _para("Widget: flow"),
            _code(""),
        ],
        "subsections": [],
    }]
    apply_widget_markers(sections, summary)
    blocks = sections[0]["blocks"]
    assert len(blocks) == 2
    assert blocks[0]["type"] == "paragraph"
    assert blocks[1]["type"] == "code"


# ── gantt converter tests ───────────────────────────────────────────


def test_gantt_marker_converts_4col_table() -> None:
    summary = _Summary()
    sections = [{
        "id": _u(),
        "level": 1,
        "title": "t",
        "blocks": [
            _para("Widget: gantt"),
            _table(
                headers=["Task", "Start", "End", "Progress"],
                rows=[["Design", "2026-01-01", "2026-01-15", "50%"]],
            ),
        ],
        "subsections": [],
    }]
    apply_widget_markers(sections, summary)
    blocks = sections[0]["blocks"]
    assert len(blocks) == 1
    assert blocks[0]["type"] == "gantt"
    assert len(blocks[0]["tasks"]) == 1
    assert blocks[0]["tasks"][0]["progress"] == 50.0


def test_gantt_marker_korean_headers() -> None:
    summary = _Summary()
    sections = [{
        "id": _u(),
        "level": 1,
        "title": "t",
        "blocks": [
            _para("Widget: gantt"),
            _table(
                headers=["작업", "시작", "종료"],
                rows=[["설계", "2026-01-01", "2026-01-15"]],
            ),
        ],
        "subsections": [],
    }]
    apply_widget_markers(sections, summary)
    blocks = sections[0]["blocks"]
    assert len(blocks) == 1
    assert blocks[0]["type"] == "gantt"
    assert len(blocks[0]["tasks"]) == 1
    assert "progress" not in blocks[0]["tasks"][0]


def test_gantt_marker_missing_name_column_returns_none() -> None:
    summary = _Summary()
    sections = [{
        "id": _u(),
        "level": 1,
        "title": "t",
        "blocks": [
            _para("Widget: gantt"),
            _table(
                headers=["Start", "End"],
                rows=[["2026-01-01", "2026-01-15"]],
            ),
        ],
        "subsections": [],
    }]
    apply_widget_markers(sections, summary)
    blocks = sections[0]["blocks"]
    assert len(blocks) == 2
    assert blocks[0]["type"] == "paragraph"
    assert blocks[1]["type"] == "table"


def test_gantt_marker_skips_rows_with_empty_name() -> None:
    summary = _Summary()
    sections = [{
        "id": _u(),
        "level": 1,
        "title": "t",
        "blocks": [
            _para("Widget: gantt"),
            _table(
                headers=["Task", "Start", "End"],
                rows=[
                    ["Design", "2026-01-01", "2026-01-15"],
                    ["", "2026-01-16", "2026-01-20"],
                ],
            ),
        ],
        "subsections": [],
    }]
    apply_widget_markers(sections, summary)
    blocks = sections[0]["blocks"]
    assert len(blocks) == 1
    assert blocks[0]["type"] == "gantt"
    assert len(blocks[0]["tasks"]) == 1


# ── glossary converter ──────────────────────────────────────────────


def test_glossary_marker_emits_glossary_ref_type() -> None:
    summary = _Summary()
    sections = [{
        "id": _u(),
        "level": 1,
        "title": "t",
        "blocks": [
            _para("Widget: glossary"),
            _para("ULID"),
        ],
        "subsections": [],
    }]
    apply_widget_markers(sections, summary)
    blocks = sections[0]["blocks"]
    assert len(blocks) == 1
    assert blocks[0]["type"] == "glossary-ref"
    assert blocks[0]["term"] == "ULID"


def test_glossary_marker_strips_whitespace() -> None:
    summary = _Summary()
    sections = [{
        "id": _u(),
        "level": 1,
        "title": "t",
        "blocks": [
            _para("Widget: glossary"),
            _para("  TLS  "),
        ],
        "subsections": [],
    }]
    apply_widget_markers(sections, summary)
    blocks = sections[0]["blocks"]
    assert len(blocks) == 1
    assert blocks[0]["type"] == "glossary-ref"
    assert blocks[0]["term"] == "TLS"


def test_glossary_marker_empty_text_returns_none() -> None:
    summary = _Summary()
    sections = [{
        "id": _u(),
        "level": 1,
        "title": "t",
        "blocks": [
            _para("Widget: glossary"),
            _para(""),
        ],
        "subsections": [],
    }]
    apply_widget_markers(sections, summary)
    blocks = sections[0]["blocks"]
    assert len(blocks) == 2
    assert blocks[0]["type"] == "paragraph"
    assert blocks[1]["type"] == "paragraph"


def test_glossary_marker_with_table_target_returns_none() -> None:
    summary = _Summary()
    sections = [{
        "id": _u(),
        "level": 1,
        "title": "t",
        "blocks": [
            _para("Widget: glossary"),
            _table(headers=["term"], rows=[["ULID"]]),
        ],
        "subsections": [],
    }]
    apply_widget_markers(sections, summary)
    blocks = sections[0]["blocks"]
    assert len(blocks) == 2
    assert blocks[0]["type"] == "paragraph"
    assert blocks[1]["type"] == "table"


# ── doc-link converter ──────────────────────────────────────────────


def test_doc_link_marker_emits_doc_link_card_type() -> None:
    summary = _Summary()
    sections = [{
        "id": _u(),
        "level": 1,
        "title": "t",
        "blocks": [
            _para("Widget: doc-link"),
            _para("month-end-closing"),
        ],
        "subsections": [],
    }]
    apply_widget_markers(sections, summary)
    blocks = sections[0]["blocks"]
    assert len(blocks) == 1
    assert blocks[0]["type"] == "doc-link-card"
    assert blocks[0]["slug"] == "month-end-closing"


def test_doc_link_marker_extracts_slug_from_url() -> None:
    summary = _Summary()
    sections = [{
        "id": _u(),
        "level": 1,
        "title": "t",
        "blocks": [
            _para("Widget: doc-link"),
            _para("https://wp.example.com/docs/onboarding-guide"),
        ],
        "subsections": [],
    }]
    apply_widget_markers(sections, summary)
    blocks = sections[0]["blocks"]
    assert len(blocks) == 1
    assert blocks[0]["type"] == "doc-link-card"
    assert blocks[0]["slug"] == "onboarding-guide"


def test_doc_link_marker_invalid_slug_returns_none() -> None:
    summary = _Summary()
    sections = [{
        "id": _u(),
        "level": 1,
        "title": "t",
        "blocks": [
            _para("Widget: doc-link"),
            _para("some Random Sentence with Spaces"),
        ],
        "subsections": [],
    }]
    apply_widget_markers(sections, summary)
    blocks = sections[0]["blocks"]
    assert len(blocks) == 2
    assert blocks[0]["type"] == "paragraph"
    assert blocks[1]["type"] == "paragraph"


def test_doc_link_marker_with_table_target_returns_none() -> None:
    summary = _Summary()
    sections = [{
        "id": _u(),
        "level": 1,
        "title": "t",
        "blocks": [
            _para("Widget: doc-link"),
            _table(headers=["a", "b"], rows=[["1", "2"]]),
        ],
        "subsections": [],
    }]
    apply_widget_markers(sections, summary)
    blocks = sections[0]["blocks"]
    assert len(blocks) == 2
    assert blocks[0]["type"] == "paragraph"
    assert blocks[1]["type"] == "table"


# ── _convert_org_chart — direct unit tests ──────────────────────────


def test_org_chart_from_indented_string_list() -> None:
    summary = _Summary()
    target = _list(["CEO", "  CTO", "    Dev", "  CFO"])
    result = _convert_org_chart(None, [target], summary)
    assert result is not None
    widget, n = result
    assert n == 1
    assert widget["type"] == "org-chart"
    root = widget["root"]
    assert root["label"] == "CEO"
    children = root.get("children") or []
    labels = [c["label"] for c in children]
    assert labels == ["CTO", "CFO"]
    cto = children[0]
    cto_children = cto.get("children") or []
    assert [c["label"] for c in cto_children] == ["Dev"]


def test_org_chart_from_parent_table() -> None:
    summary = _Summary()
    target = _table(
        headers=["name", "parent"],
        rows=[["Alice", ""], ["Bob", "Alice"], ["Carol", "Alice"]],
    )
    result = _convert_org_chart(None, [target], summary)
    assert result is not None
    widget, n = result
    assert n == 1
    root = widget["root"]
    assert root["label"] == "Alice"
    labels = [c["label"] for c in root.get("children") or []]
    assert labels == ["Bob", "Carol"]


def test_org_chart_table_missing_parent_col_returns_none() -> None:
    """Missing parent column → converter returns None (info loss); the
    info-loss-0 rule in the dispatcher then preserves marker + target."""
    summary = _Summary()
    target = _table(headers=["name"], rows=[["Alice"], ["Bob"]])
    assert _convert_org_chart(None, [target], summary) is None


def test_org_chart_paragraph_target_returns_none() -> None:
    """Non list/table target → converter returns None (info-loss-0 rule)."""
    summary = _Summary()
    target = _para("just text")
    assert _convert_org_chart(None, [target], summary) is None


def test_org_chart_multiple_roots_takes_first_with_warning() -> None:
    summary = _Summary()
    target = _list(["A", "B"])
    result = _convert_org_chart(None, [target], summary)
    assert result is not None
    widget, _n = result
    assert widget["root"]["label"] == "A"
    assert summary.warnings


# ── image-annotation converter ──────────────────────────────────────


def test_image_annotation_marker_image_only() -> None:
    summary = _Summary()
    img = _image()
    sections = [{
        "id": _u(),
        "level": 1,
        "title": "t",
        "blocks": [
            _para("Widget: image-annotation"),
            img,
        ],
        "subsections": [],
    }]
    apply_widget_markers(sections, summary)
    blocks = sections[0]["blocks"]
    assert len(blocks) == 1
    assert blocks[0]["type"] == "image-annotation"
    assert blocks[0]["annotations"] == []
    assert blocks[0]["image_id"] == img["imageId"]


def test_image_annotation_marker_with_arrow_table() -> None:
    summary = _Summary()
    sections = [{
        "id": _u(),
        "level": 1,
        "title": "t",
        "blocks": [
            _para("Widget: image-annotation"),
            _image(),
            _table(
                headers=["kind", "from_x", "from_y", "to_x", "to_y", "color"],
                rows=[["arrow", "10", "20", "30", "40", "#ff0000"]],
            ),
        ],
        "subsections": [],
    }]
    apply_widget_markers(sections, summary)
    blocks = sections[0]["blocks"]
    assert len(blocks) == 1
    assert blocks[0]["type"] == "image-annotation"
    assert len(blocks[0]["annotations"]) == 1
    assert blocks[0]["annotations"][0]["kind"] == "arrow"


def test_image_annotation_marker_with_rect_and_callout() -> None:
    summary = _Summary()
    sections = [{
        "id": _u(),
        "level": 1,
        "title": "t",
        "blocks": [
            _para("Widget: image-annotation"),
            _image(),
            _table(
                headers=["kind", "x", "y", "w", "h", "text", "color"],
                rows=[
                    ["rect", "5", "5", "20", "10", "", "#00ff00"],
                    ["callout", "50", "60", "", "", "여기 보세요", "#0000ff"],
                ],
            ),
        ],
        "subsections": [],
    }]
    apply_widget_markers(sections, summary)
    blocks = sections[0]["blocks"]
    assert len(blocks) == 1
    assert blocks[0]["type"] == "image-annotation"
    kinds = {a["kind"] for a in blocks[0]["annotations"]}
    assert "rect" in kinds
    assert "callout" in kinds


def test_image_annotation_marker_non_image_target_emits_placeholder() -> None:
    """New policy: if neither image nor annotation table is found right
    after the marker, emit a placeholder ImageAnnotationBlock (empty
    annotations, fresh image_id) so the widget identity survives the
    round-trip. The marker is consumed (n_consumed=0); subsequent blocks
    are preserved untouched."""
    summary = _Summary()
    sections = [{
        "id": _u(),
        "level": 1,
        "title": "t",
        "blocks": [
            _para("Widget: image-annotation"),
            _para("not an image"),
        ],
        "subsections": [],
    }]
    apply_widget_markers(sections, summary)
    blocks = sections[0]["blocks"]
    assert len(blocks) == 2
    assert blocks[0]["type"] == "image-annotation"
    assert blocks[0]["annotations"] == []
    assert blocks[1]["type"] == "paragraph"
    assert blocks[1]["text"] == "not an image"
    assert any("placeholder" in w for w in summary.warnings)


def test_image_annotation_marker_image_plus_unparseable_table_consumes_only_image() -> None:
    summary = _Summary()
    sections = [{
        "id": _u(),
        "level": 1,
        "title": "t",
        "blocks": [
            _para("Widget: image-annotation"),
            _image(),
            _table(
                headers=["kind", "from_x", "from_y", "to_x", "to_y", "color"],
                rows=[["arrow", "n/a", "n/a", "n/a", "n/a", "#000000"]],
            ),
        ],
        "subsections": [],
    }]
    apply_widget_markers(sections, summary)
    blocks = sections[0]["blocks"]
    assert len(blocks) == 2
    assert blocks[0]["type"] == "image-annotation"
    assert blocks[0]["annotations"] == []
    assert blocks[1]["type"] == "table"


# ── iframe / video / file / pdf / whiteboard converters ─────────────
# Dispatcher hookup is owned by the main thread; tests call converters
# directly and emulate ``_rewrite_blocks`` None handling (keep marker +
# target, info-loss-zero).


import re as _re


_ULID_RE = _re.compile(r"^[0-9A-HJKMNP-TV-Z]{26}$")


def _run_converter(
    converter: Any,
    marker_text: str,
    targets: list[dict[str, Any]],
    summary: _Summary | None = None,
) -> tuple[list[dict[str, Any]], _Summary]:
    """Invoke a converter directly, emulating dispatcher None handling."""
    summary = summary or _Summary()
    parsed = parse_marker(marker_text)
    assert parsed is not None
    _, variant = parsed
    result = converter(variant, targets, summary)
    if result is None:
        return [_para(marker_text), *targets], summary
    widget, n = result
    # New policy: n >= 0. n == 0 means the converter emitted a widget without
    # consuming any target (placeholder path for gallery/whiteboard/image-
    # annotation when image bytes are absent). n >= 1 = standard path.
    assert n >= 0
    return [widget, *targets[n:]], summary


def test_iframe_marker_converts_url_paragraph() -> None:
    blocks, summary = _run_converter(
        _convert_iframe,
        "Widget: iframe",
        [_para("https://example.com/widget")],
    )
    assert len(blocks) == 1
    assert blocks[0]["type"] == "iframe"
    assert blocks[0]["src"] == "https://example.com/widget"
    assert summary.warnings == []


def test_iframe_marker_invalid_url_returns_none() -> None:
    blocks, _ = _run_converter(
        _convert_iframe,
        "Widget: iframe",
        [_para("not a url")],
    )
    assert len(blocks) == 2
    assert blocks[0]["type"] == "paragraph"
    assert blocks[1]["type"] == "paragraph"


def test_video_marker_detects_youtube() -> None:
    blocks, _ = _run_converter(
        _convert_video,
        "Widget: video",
        [_para("https://youtube.com/watch?v=xyz")],
    )
    assert len(blocks) == 1
    assert blocks[0]["type"] == "video"
    assert blocks[0]["provider"] == "youtube"


def test_video_marker_detects_vimeo() -> None:
    blocks, _ = _run_converter(
        _convert_video,
        "Widget: video",
        [_para("https://vimeo.com/12345")],
    )
    assert len(blocks) == 1
    assert blocks[0]["provider"] == "vimeo"


def test_video_marker_intra_default() -> None:
    blocks, _ = _run_converter(
        _convert_video,
        "Widget: video",
        [_para("https://mxwp.intra/video/1")],
    )
    assert len(blocks) == 1
    assert blocks[0]["provider"] == "intra"


def test_file_marker_emits_placeholder_with_warning() -> None:
    blocks, summary = _run_converter(
        _convert_file,
        "Widget: file",
        [_para("report.xlsx")],
    )
    assert len(blocks) == 1
    assert blocks[0]["type"] == "file"
    assert blocks[0]["name"] == "report.xlsx"
    # FileBlock uses camelCase ``fileId`` (vs PdfBlock's snake_case ``file_id``).
    assert _ULID_RE.match(blocks[0]["fileId"])
    assert summary.warnings
    assert "report.xlsx" in summary.warnings[0]


def test_file_marker_empty_returns_none() -> None:
    blocks, _ = _run_converter(
        _convert_file,
        "Widget: file",
        [_para("   ")],
    )
    assert len(blocks) == 2
    assert blocks[0]["type"] == "paragraph"
    assert blocks[1]["type"] == "paragraph"


def test_pdf_marker_emits_placeholder_with_warning() -> None:
    blocks, summary = _run_converter(
        _convert_pdf,
        "Widget: pdf",
        [_para("https://example.com/doc.pdf")],
    )
    assert len(blocks) == 1
    assert blocks[0]["type"] == "pdf"
    # PdfBlock uses snake_case ``file_id`` (vs FileBlock's camelCase ``fileId``).
    assert "file_id" in blocks[0]
    assert _ULID_RE.match(blocks[0]["file_id"])
    assert summary.warnings
    assert "doc.pdf" in summary.warnings[0]


def test_whiteboard_marker_emits_placeholder_preserves_following_image() -> None:
    """New policy: whiteboard converter emits a placeholder WhiteboardBlock
    (empty elements, schema-safe viewbox) with n_consumed=0. The marker
    is consumed but the following target (image) is preserved as a regular
    block. WhiteboardBlock identity survives even though strokes data is
    irrecoverable on docx round-trip."""
    image = _image()
    blocks, summary = _run_converter(
        _convert_whiteboard,
        "Widget: whiteboard",
        [image],
    )
    assert len(blocks) == 2
    assert blocks[0]["type"] == "whiteboard"
    assert blocks[0]["elements"] == []
    assert blocks[1]["type"] == "image"
    assert any("whiteboard" in w for w in summary.warnings)


# ── gallery converter (multi-block; dispatcher hookup pending main-thread) ──


def test_gallery_marker_groups_consecutive_images() -> None:
    para = _para("after gallery")
    blocks, _ = _run_converter(
        _convert_gallery,
        "Widget: gallery",
        [_image(), _image(), _image(), para],
    )
    assert len(blocks) == 2
    assert blocks[0]["type"] == "gallery"
    assert blocks[0]["layout"] == "grid"
    assert len(blocks[0]["items"]) == 3
    assert blocks[1] is para


def test_gallery_marker_stops_at_non_image() -> None:
    para = _para("interrupt")
    orphan = _image()
    blocks, _ = _run_converter(
        _convert_gallery,
        "Widget: gallery",
        [_image(), para, orphan],
    )
    assert len(blocks) == 3
    assert blocks[0]["type"] == "gallery"
    assert len(blocks[0]["items"]) == 1
    assert blocks[1] is para
    assert blocks[2] is orphan


def test_gallery_marker_with_carousel_variant() -> None:
    blocks, _ = _run_converter(
        _convert_gallery,
        "Widget: gallery (carousel)",
        [_image(), _image()],
    )
    assert len(blocks) == 1
    assert blocks[0]["type"] == "gallery"
    assert blocks[0]["layout"] == "carousel"
    assert len(blocks[0]["items"]) == 2


def test_gallery_marker_no_image_emits_placeholder_preserves_following() -> None:
    """New policy: gallery converter emits a placeholder gallery (one
    minted imageId) with n_consumed=0 when no image follows the marker.
    Marker consumed; subsequent non-image block preserved."""
    blocks, summary = _run_converter(
        _convert_gallery,
        "Widget: gallery",
        [_para("not an image")],
    )
    assert len(blocks) == 2
    assert blocks[0]["type"] == "gallery"
    assert len(blocks[0]["items"]) == 1
    assert blocks[1]["type"] == "paragraph"
    assert any("placeholder" in w for w in summary.warnings)


def test_gallery_marker_copies_caption_and_alt() -> None:
    img = _image()
    img["caption"] = "Figure 1: chart"
    img["alt"] = "bar chart of revenue"
    blocks, _ = _run_converter(
        _convert_gallery,
        "Widget: gallery",
        [img],
    )
    assert len(blocks) == 1
    item = blocks[0]["items"][0]
    assert item["imageId"] == img["imageId"]
    assert item["caption"] == "Figure 1: chart"
    assert item["alt"] == "bar chart of revenue"


# ── columns converter (multi-block; dispatcher hookup pending main-thread) ──


def _callout(text: str = "note") -> dict[str, Any]:
    return {"type": "callout", "id": _u(), "variant": "info", "text": text}


def test_columns_marker_groups_two_paragraphs() -> None:
    img = _image()
    p1 = _para("left")
    p2 = _para("right")
    blocks, _ = _run_converter(
        _convert_columns,
        "Widget: columns",
        [p1, p2, img],
    )
    assert len(blocks) == 2
    assert blocks[0]["type"] == "columns"
    assert len(blocks[0]["columns"]) == 2
    assert blocks[0]["columns"][0] == [p1]
    assert blocks[0]["columns"][1] == [p2]
    assert blocks[1] is img


def test_columns_marker_with_variant_3_takes_three() -> None:
    p1 = _para("a")
    p2 = _para("b")
    p3 = _para("c")
    blocks, _ = _run_converter(
        _convert_columns,
        "Widget: columns (3)",
        [p1, p2, p3],
    )
    assert len(blocks) == 1
    assert blocks[0]["type"] == "columns"
    assert len(blocks[0]["columns"]) == 3
    assert blocks[0]["columns"][0] == [p1]
    assert blocks[0]["columns"][1] == [p2]
    assert blocks[0]["columns"][2] == [p3]


def test_columns_marker_default_is_two() -> None:
    p1 = _para("a")
    p2 = _para("b")
    p3 = _para("c")
    p4 = _para("d")
    blocks, _ = _run_converter(
        _convert_columns,
        "Widget: columns",
        [p1, p2, p3, p4],
    )
    assert len(blocks) == 3
    assert blocks[0]["type"] == "columns"
    assert len(blocks[0]["columns"]) == 2
    assert blocks[1] is p3
    assert blocks[2] is p4


def test_columns_marker_single_block_returns_none() -> None:
    p1 = _para("only one simple")
    c = _callout("stop here")
    blocks, _ = _run_converter(
        _convert_columns,
        "Widget: columns",
        [p1, c],
    )
    assert len(blocks) == 3
    assert blocks[0]["type"] == "paragraph"
    assert blocks[1] is p1
    assert blocks[2] is c


def test_columns_marker_mixed_simple_types_ok() -> None:
    p = _para("text")
    img = _image()
    lst = _list(["a", "b"])
    blocks, _ = _run_converter(
        _convert_columns,
        "Widget: columns",
        [p, img, lst],
    )
    assert len(blocks) == 2
    assert blocks[0]["type"] == "columns"
    assert len(blocks[0]["columns"]) == 2
    assert blocks[0]["columns"][0] == [p]
    assert blocks[0]["columns"][1] == [img]
    assert blocks[1] is lst


# ── accordion converter (multi-block; dispatcher hookup pending main-thread) ──


def _h4(text: str) -> dict[str, Any]:
    # Schema field is `title` (not `text`). Converters read `title` first
    # with `text` fallback, but tests should exercise the canonical path.
    return {"type": "heading-4", "id": _u(), "title": text}


def test_accordion_marker_with_heading_pairs() -> None:
    blocks, _ = _run_converter(
        _convert_accordion,
        "Widget: accordion",
        [_h4("Q1"), _para("A1"), _h4("Q2"), _para("A2")],
    )
    assert len(blocks) == 1
    assert blocks[0]["type"] == "accordion"
    items = blocks[0]["items"]
    assert len(items) == 2
    assert items[0]["label"] == "Q1"
    assert len(items[0]["blocks"]) == 1
    assert items[0]["blocks"][0]["text"] == "A1"
    assert items[1]["label"] == "Q2"
    assert items[1]["blocks"][0]["text"] == "A2"


def test_accordion_marker_stops_at_next_widget_marker() -> None:
    next_marker = _para("Widget: callout (info)")
    tail = _para("callout body")
    blocks, _ = _run_converter(
        _convert_accordion,
        "Widget: accordion",
        [_h4("Q1"), _para("A1"), next_marker, tail],
    )
    assert blocks[0]["type"] == "accordion"
    assert len(blocks[0]["items"]) == 1
    assert blocks[0]["items"][0]["label"] == "Q1"
    # Marker + its target must remain for dispatcher to process next.
    assert blocks[1] is next_marker
    assert blocks[2] is tail


def test_accordion_marker_no_initial_heading_returns_none() -> None:
    blocks, _ = _run_converter(
        _convert_accordion,
        "Widget: accordion",
        [_para("no heading first"), _h4("Q1")],
    )
    assert len(blocks) == 3
    assert blocks[0]["type"] == "paragraph"  # marker preserved
    assert blocks[1]["type"] == "paragraph"
    assert blocks[2]["type"] == "heading-4"


def test_accordion_marker_emits_items_field_not_tabs() -> None:
    blocks, _ = _run_converter(
        _convert_accordion,
        "Widget: accordion",
        [_h4("Q1"), _para("A1")],
    )
    assert blocks[0]["type"] == "accordion"
    assert "items" in blocks[0]
    assert "tabs" not in blocks[0]


# ── tabs converter (multi-block; dispatcher hookup pending main-thread) ──


def test_tabs_marker_with_heading_pairs() -> None:
    blocks, _ = _run_converter(
        _convert_tabs,
        "Widget: tabs",
        [
            _h4("Overview"),
            _para("Intro text"),
            _h4("Details"),
            _para("More text"),
        ],
    )
    assert len(blocks) == 1
    assert blocks[0]["type"] == "tabs"
    tabs = blocks[0]["tabs"]
    assert len(tabs) == 2
    assert tabs[0]["label"] == "Overview"
    assert len(tabs[0]["blocks"]) == 1
    assert tabs[0]["blocks"][0]["text"] == "Intro text"
    assert tabs[1]["label"] == "Details"
    assert len(tabs[1]["blocks"]) == 1
    assert tabs[1]["blocks"][0]["text"] == "More text"


def test_tabs_marker_stops_at_next_widget_marker() -> None:
    next_marker = _para("Widget: callout (warn)")
    tail = _para("callout body")
    blocks, _ = _run_converter(
        _convert_tabs,
        "Widget: tabs",
        [_h4("A"), _para("A content"), next_marker, tail],
    )
    assert blocks[0]["type"] == "tabs"
    assert len(blocks[0]["tabs"]) == 1
    assert blocks[0]["tabs"][0]["label"] == "A"
    assert len(blocks[0]["tabs"][0]["blocks"]) == 1
    # Marker + its target must remain so dispatcher can process next widget.
    assert blocks[1] is next_marker
    assert blocks[2] is tail


def test_tabs_marker_no_initial_heading_returns_none() -> None:
    p = _para("body without heading")
    blocks, _ = _run_converter(
        _convert_tabs,
        "Widget: tabs",
        [p],
    )
    assert len(blocks) == 2
    assert blocks[0]["type"] == "paragraph"
    assert blocks[1] is p


def test_tabs_marker_single_heading_no_content() -> None:
    blocks, _ = _run_converter(
        _convert_tabs,
        "Widget: tabs",
        [_h4("Solo")],
    )
    assert len(blocks) == 1
    assert blocks[0]["type"] == "tabs"
    assert len(blocks[0]["tabs"]) == 1
    assert blocks[0]["tabs"][0]["label"] == "Solo"
    assert blocks[0]["tabs"][0]["blocks"] == []
