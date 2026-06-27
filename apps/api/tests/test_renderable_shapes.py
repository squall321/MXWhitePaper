"""렌더 불가능한 구조 거부 — _assert_renderable_shapes 회귀 테스트.

적대적 검증에서 발견된 MED/LOW 구조검증 부재의 회귀 가드:
ragged table(행>헤더), 빈 chart, chart series.values 길이불일치를 write 경로
에서 거부한다. source-driven / xy-line / boxplot / 짧은 행은 carve-out.
"""
from __future__ import annotations

import ulid
import pytest

from app.core.errors import ValidationFailed
from app.services.document_service import validate_documentjson


def _u() -> str:
    return str(ulid.new())


_OWNER = _u()


def _doc(blocks: list[dict]) -> dict:
    return {
        "schema_version": "1.0",
        "id": _u(),
        "slug": "shapes-fixture",
        "title": "shapes",
        "metadata": {
            "division": "MX",
            "owners": [_OWNER],
            "tags": [],
            "confidentiality": "internal",
        },
        "sections": [
            {"id": _u(), "level": 1, "title": "S", "blocks": blocks, "subsections": []}
        ],
    }


# ── 거부돼야 ──
def test_ragged_table_row_longer_than_headers_rejected() -> None:
    blk = {"type": "table", "id": _u(), "headers": ["A", "B", "C"],
           "rows": [["1", "2"], ["w", "x", "y", "z"]]}
    with pytest.raises(ValidationFailed):
        validate_documentjson(_doc([blk]))


def test_empty_chart_rejected() -> None:
    blk = {"type": "chart", "id": _u(), "chartType": "bar",
           "data": {"labels": [], "series": []}}
    with pytest.raises(ValidationFailed):
        validate_documentjson(_doc([blk]))


def test_chart_series_length_mismatch_rejected() -> None:
    blk = {"type": "chart", "id": _u(), "chartType": "line",
           "data": {"labels": ["a", "b", "c"], "series": [{"name": "s", "values": []}]}}
    with pytest.raises(ValidationFailed):
        validate_documentjson(_doc([blk]))


# ── carve-out: 통과해야 ──
def test_normal_chart_passes() -> None:
    blk = {"type": "chart", "id": _u(), "chartType": "bar",
           "data": {"labels": ["a", "b"], "series": [{"name": "s", "values": [1, 2]}]}}
    validate_documentjson(_doc([blk]))


def test_xy_line_chart_passes() -> None:
    blk = {"type": "chart", "id": _u(), "chartType": "xy-line",
           "data": {"labels": [], "series": [{"name": "s", "points": [{"x": 1, "y": 2}]}]}}
    validate_documentjson(_doc([blk]))


def test_source_driven_empty_chart_passes() -> None:
    blk = {"type": "chart", "id": _u(), "chartType": "bar",
           "source": {"kind": "inline", "rows": [{"a": 1}]},
           "data": {"labels": [], "series": []}}
    validate_documentjson(_doc([blk]))


def test_short_table_row_passes() -> None:
    blk = {"type": "table", "id": _u(), "headers": ["A", "B", "C"],
           "rows": [["1"], ["1", "2"]]}
    validate_documentjson(_doc([blk]))
