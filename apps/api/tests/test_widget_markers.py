"""Widget marker recognition — Phase 1 (callout + kpi-cards).

LLM 이 docx/pptx 에 `Widget: <type>` 패턴을 박으면 import 시 진짜 위젯
블록으로 복원된다. Phase 1 은 callout, kpi-cards 두 위젯만 변환하며,
나머지 12 위젯 타입은 "recognised but not converted" 경고만 추가하고
target 블록은 평소대로 emit.
"""
from __future__ import annotations

import io
from typing import Any

import ulid

from app.services.docx_export import DocxOptions, render_docx
from app.services.docx_import import docx_to_document
from app.services.widget_markers import (
    WIDGET_CONVERTERS,
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


def test_phase2_widget_marker_drops_marker_with_warning() -> None:
    """Recognised but not-yet-converted (chart, gantt, …) → marker 소비 +
    target 보존 + warning."""
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
    apply_widget_markers(sections, summary)
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


def test_phase1_dispatcher_has_expected_converters() -> None:
    # Sanity: Phase 1 set is real, Phase 2 set is hook-only.
    assert callable(WIDGET_CONVERTERS["callout"])
    assert callable(WIDGET_CONVERTERS["kpi-cards"])
    assert WIDGET_CONVERTERS["chart"] is None
    assert WIDGET_CONVERTERS["gantt"] is None


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
