"""Phase 3 — marker-less widget auto-detection.

Mirror to ``test_widget_markers.py`` but the post-pass under test is
``apply_widget_autodetect``: a 1x1 table that carries an emoji/label/bg
signal is rewritten into a CalloutBlock without any ``Widget:`` marker.
"""
from __future__ import annotations

from typing import Any

import ulid

from app.services.docx_export import DocxOptions, render_docx
from app.services.docx_import import docx_to_document
from app.services.widget_markers import (
    WIDGET_AUTODETECTORS,
    _autodetect_gallery,
    _autodetect_gantt,
    _autodetect_kpi_cards,
    apply_section_column_autodetect,
    apply_widget_autodetect,
)


def _u() -> str:
    return str(ulid.new())


class _Summary:
    def __init__(self) -> None:
        self.warnings: list[str] = []


def _section(blocks: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "id": _u(),
        "level": 1,
        "title": "s",
        "blocks": blocks,
        "subsections": [],
    }


def _single_cell_table(
    text: str = "",
    bg: str | None = None,
) -> dict[str, Any]:
    cell: dict[str, Any] = {"r": 0, "c": 0, "text": text, "header": True}
    if bg is not None:
        cell["bg"] = bg
    return {
        "type": "table",
        "id": _u(),
        "headers": [text],
        "rows": [],
        "cells": [cell],
    }


# ── Emoji-prefixed text triggers ────────────────────────────────────


def test_autodetect_callout_from_emoji_warn() -> None:
    sec = _section([_single_cell_table(text="⚠️ 작업 중지 금지")])
    s = _Summary()
    apply_widget_autodetect([sec], s)
    blocks = sec["blocks"]
    assert len(blocks) == 1
    b = blocks[0]
    assert b["type"] == "callout"
    assert b["variant"] == "warn"
    assert b["text"] == "작업 중지 금지"


def test_autodetect_callout_from_emoji_danger() -> None:
    sec = _section([_single_cell_table(text="🚨 즉시 대피")])
    apply_widget_autodetect([sec], _Summary())
    b = sec["blocks"][0]
    assert b["type"] == "callout"
    assert b["variant"] == "danger"
    assert b["text"] == "즉시 대피"


def test_autodetect_callout_from_emoji_tip() -> None:
    sec = _section([_single_cell_table(text="💡 단축키 Ctrl+S")])
    apply_widget_autodetect([sec], _Summary())
    b = sec["blocks"][0]
    assert b["type"] == "callout"
    assert b["variant"] == "tip"
    assert b["text"] == "단축키 Ctrl+S"


def test_autodetect_callout_from_emoji_info() -> None:
    sec = _section([_single_cell_table(text="ℹ️ 참고 사항")])
    apply_widget_autodetect([sec], _Summary())
    b = sec["blocks"][0]
    assert b["type"] == "callout"
    assert b["variant"] == "info"
    assert b["text"] == "참고 사항"


# ── Label-prefixed text triggers ────────────────────────────────────


def test_autodetect_callout_from_label_korean() -> None:
    sec = _section([_single_cell_table(text="[주의] 내용")])
    apply_widget_autodetect([sec], _Summary())
    b = sec["blocks"][0]
    assert b["type"] == "callout"
    assert b["variant"] == "warn"
    assert b["text"] == "내용"


# ── Background-color triggers ───────────────────────────────────────


def test_autodetect_callout_from_bg_red() -> None:
    sec = _section([_single_cell_table(text="긴급", bg="#FF3030")])
    apply_widget_autodetect([sec], _Summary())
    b = sec["blocks"][0]
    assert b["type"] == "callout"
    assert b["variant"] == "danger"
    assert b["text"] == "긴급"


def test_autodetect_callout_from_bg_blue() -> None:
    sec = _section([_single_cell_table(text="참고", bg="#3030FF")])
    apply_widget_autodetect([sec], _Summary())
    b = sec["blocks"][0]
    assert b["type"] == "callout"
    assert b["variant"] == "info"
    assert b["text"] == "참고"


# ── Negative cases (NOT converted) ──────────────────────────────────


def test_autodetect_callout_skips_plain_table_no_signal() -> None:
    blk = _single_cell_table(text="그냥 내용")
    sec = _section([blk])
    apply_widget_autodetect([sec], _Summary())
    out = sec["blocks"][0]
    assert out["type"] == "table"
    # Block identity preserved (same id).
    assert out["id"] == blk["id"]


def test_autodetect_callout_skips_multi_row_table() -> None:
    # 2-row 1-col via the cells form.
    blk: dict[str, Any] = {
        "type": "table",
        "id": _u(),
        "headers": ["h"],
        "rows": [["r1"]],
        "cells": [
            {"r": 0, "c": 0, "text": "⚠️ a", "header": True},
            {"r": 1, "c": 0, "text": "b"},
        ],
    }
    sec = _section([blk])
    apply_widget_autodetect([sec], _Summary())
    assert sec["blocks"][0]["type"] == "table"


def test_autodetect_callout_skips_multi_col_table() -> None:
    blk: dict[str, Any] = {
        "type": "table",
        "id": _u(),
        "headers": ["h1", "h2"],
        "rows": [["⚠️ a", "b"]],
        # No `cells` field → headers/rows path. 1-row x 2-col rejected.
    }
    sec = _section([blk])
    apply_widget_autodetect([sec], _Summary())
    assert sec["blocks"][0]["type"] == "table"


def test_autodetect_callout_skips_already_callout() -> None:
    blk: dict[str, Any] = {
        "type": "callout",
        "id": _u(),
        "variant": "info",
        "text": "already a callout",
    }
    sec = _section([blk])
    apply_widget_autodetect([sec], _Summary())
    out = sec["blocks"][0]
    assert out["type"] == "callout"
    assert out["id"] == blk["id"]
    assert out["text"] == "already a callout"


def test_autodetect_marker_processed_callout_not_affected() -> None:
    # Mix: a marker-converted callout sitting next to a plain table.
    callout: dict[str, Any] = {
        "type": "callout",
        "id": _u(),
        "variant": "warn",
        "text": "marker-driven",
    }
    plain_table = _single_cell_table(text="그냥 내용")
    sec = _section([callout, plain_table])
    apply_widget_autodetect([sec], _Summary())
    blocks = sec["blocks"]
    assert len(blocks) == 2
    assert blocks[0] is callout  # identity, untouched
    assert blocks[1]["type"] == "table"


# ── Dispatcher contract ─────────────────────────────────────────────


def test_autodetect_dispatcher_has_all_four() -> None:
    keys = [name for name, _fn in WIDGET_AUTODETECTORS]
    assert set(keys) == {"callout", "kpi-cards", "gantt", "gallery"}
    for _name, fn in WIDGET_AUTODETECTORS:
        assert callable(fn)


# ── End-to-end DOCX round-trip ──────────────────────────────────────


def test_docx_import_autodetects_callout_from_color_cell() -> None:
    """Round-trip: a single-cell table whose text starts with the warn emoji
    is auto-detected on DOCX import as a callout.

    NOTE: the docx pipeline doesn't currently round-trip per-cell ``bg`` hex
    fills back into the imported block dict, so the emoji prefix carries
    the signal across the round-trip. The ``bg`` field on the source block
    is harmless — it just isn't the trigger for the imported callout.
    """
    doc: dict[str, Any] = {
        "schema_version": "1.0",
        "id": _u(),
        "slug": "phase3-autodetect",
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
                "blocks": [
                    {
                        "type": "table",
                        "id": _u(),
                        "headers": ["⚠️ test"],
                        "rows": [],
                        "cells": [
                            {
                                "r": 0,
                                "c": 0,
                                "text": "⚠️ test",
                                "header": True,
                                "bg": "#FFE0E0",
                            }
                        ],
                    }
                ],
                "subsections": [],
            }
        ],
    }
    blob = render_docx(doc, options=DocxOptions())
    result = docx_to_document(blob, slug="rt", title="", owner_user_id=_u())

    def _walk(secs: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for s in secs or []:
            out.extend(s.get("blocks") or [])
            out.extend(_walk(s.get("subsections") or []))
        return out

    blocks = _walk(result["document"].get("sections") or [])
    callouts = [b for b in blocks if b.get("type") == "callout"]
    assert callouts, f"no callout block found; blocks={[b.get('type') for b in blocks]}"
    assert callouts[0]["variant"] == "warn"
    assert "test" in callouts[0]["text"]


# ── Gallery auto-detection (G2) ─────────────────────────────────────


def _image(image_id: str | None = None) -> dict[str, Any]:
    return {"type": "image", "id": _u(), "imageId": image_id or _u()}


def _paragraph(text: str = "hello") -> dict[str, Any]:
    return {"type": "paragraph", "id": _u(), "text": text}


def _run_autodetect_with_gallery(
    sections: list[dict[str, Any]],
    summary: _Summary,
) -> None:
    """Temporarily register `_autodetect_gallery` so the dispatcher walk
    can exercise it end-to-end, then restore the original list. Proves the
    function integrates correctly with `apply_widget_autodetect` without
    permanently mutating the module-level dispatcher.
    """
    original = list(WIDGET_AUTODETECTORS)
    WIDGET_AUTODETECTORS.append(("gallery", _autodetect_gallery))
    try:
        apply_widget_autodetect(sections, summary)
    finally:
        WIDGET_AUTODETECTORS.clear()
        WIDGET_AUTODETECTORS.extend(original)


def test_autodetect_gallery_from_three_images() -> None:
    img1, img2, img3 = _image(), _image(), _image()
    para = _paragraph("after")
    sec = _section([img1, img2, img3, para])
    s = _Summary()
    _run_autodetect_with_gallery([sec], s)
    blocks = sec["blocks"]
    assert len(blocks) == 2
    assert blocks[0]["type"] == "gallery"
    assert blocks[0]["layout"] == "grid"
    assert len(blocks[0]["items"]) == 3
    assert [it["imageId"] for it in blocks[0]["items"]] == [
        img1["imageId"], img2["imageId"], img3["imageId"],
    ]
    assert blocks[1] is para
    assert any("auto-detected gallery from 3" in w for w in s.warnings)


def test_autodetect_gallery_from_five_images() -> None:
    imgs = [_image() for _ in range(5)]
    sec = _section(list(imgs))
    s = _Summary()
    _run_autodetect_with_gallery([sec], s)
    blocks = sec["blocks"]
    assert len(blocks) == 1
    assert blocks[0]["type"] == "gallery"
    assert len(blocks[0]["items"]) == 5
    assert [it["imageId"] for it in blocks[0]["items"]] == [
        i["imageId"] for i in imgs
    ]
    assert any("auto-detected gallery from 5" in w for w in s.warnings)


def test_autodetect_gallery_stops_at_paragraph() -> None:
    img1, img2, img3 = _image(), _image(), _image()
    para = _paragraph("break")
    img4 = _image()
    sec = _section([img1, img2, img3, para, img4])
    _run_autodetect_with_gallery([sec], _Summary())
    blocks = sec["blocks"]
    assert len(blocks) == 3
    assert blocks[0]["type"] == "gallery"
    assert len(blocks[0]["items"]) == 3
    assert blocks[1] is para
    assert blocks[2] is img4
    assert blocks[2]["type"] == "image"


def test_autodetect_gallery_two_images_not_enough() -> None:
    img1, img2 = _image(), _image()
    para = _paragraph("after")
    sec = _section([img1, img2, para])
    s = _Summary()
    _run_autodetect_with_gallery([sec], s)
    blocks = sec["blocks"]
    assert len(blocks) == 3
    assert blocks[0] is img1
    assert blocks[1] is img2
    assert blocks[2] is para
    assert not any("gallery" in w for w in s.warnings)


def test_autodetect_gallery_single_image_not_enough() -> None:
    img1 = _image()
    sec = _section([img1])
    s = _Summary()
    _run_autodetect_with_gallery([sec], s)
    blocks = sec["blocks"]
    assert len(blocks) == 1
    assert blocks[0] is img1
    assert blocks[0]["type"] == "image"
    assert not any("gallery" in w for w in s.warnings)


def test_autodetect_gallery_copies_caption_and_alt() -> None:
    def _img_with(c: str, a: str) -> dict[str, Any]:
        return {
            "type": "image",
            "id": _u(),
            "imageId": _u(),
            "caption": c,
            "alt": a,
        }

    i1 = _img_with("cap1", "alt1")
    i2 = _img_with("cap2", "alt2")
    i3 = _img_with("cap3", "alt3")
    sec = _section([i1, i2, i3])
    _run_autodetect_with_gallery([sec], _Summary())
    blocks = sec["blocks"]
    assert len(blocks) == 1
    gal = blocks[0]
    assert gal["type"] == "gallery"
    assert len(gal["items"]) == 3
    for src, item in zip([i1, i2, i3], gal["items"], strict=False):
        assert item["imageId"] == src["imageId"]
        assert item["caption"] == src["caption"]
        assert item["alt"] == src["alt"]


def test_autodetect_gallery_function_is_callable() -> None:
    assert callable(_autodetect_gallery)
    assert ("gallery", _autodetect_gallery) in WIDGET_AUTODETECTORS


# ── Gantt autodetect ────────────────────────────────────────────────


def _run_autodetect_with_gantt(
    sections: list[dict[str, Any]],
    summary: _Summary,
) -> None:
    """Temporarily register `_autodetect_gantt` so the dispatcher walk
    can exercise it end-to-end, then restore the original list.
    """
    original = list(WIDGET_AUTODETECTORS)
    WIDGET_AUTODETECTORS.append(("gantt", _autodetect_gantt))
    try:
        apply_widget_autodetect(sections, summary)
    finally:
        WIDGET_AUTODETECTORS.clear()
        WIDGET_AUTODETECTORS.extend(original)


def _table(headers: list[str], rows: list[list[str]]) -> dict[str, Any]:
    return {
        "type": "table",
        "id": _u(),
        "headers": headers,
        "rows": rows,
    }


def test_autodetect_gantt_basic_english_headers() -> None:
    blk = _table(
        ["Task", "Start", "End", "Progress"],
        [
            ["Design", "2025-01-01", "2025-01-15", "100%"],
            ["Build", "2025-01-16", "2025-02-15", "50"],
        ],
    )
    sec = _section([blk])
    s = _Summary()
    _run_autodetect_with_gantt([sec], s)
    out = sec["blocks"]
    assert len(out) == 1
    g = out[0]
    assert g["type"] == "gantt"
    assert len(g["tasks"]) == 2
    assert g["tasks"][0] == {
        "name": "Design",
        "start": "2025-01-01",
        "end": "2025-01-15",
        "progress": 100.0,
    }
    assert g["tasks"][1] == {
        "name": "Build",
        "start": "2025-01-16",
        "end": "2025-02-15",
        "progress": 50.0,
    }
    assert any("auto-detected gantt" in w for w in s.warnings)


def test_autodetect_gantt_korean_headers() -> None:
    blk = _table(
        ["작업", "시작", "종료"],
        [["기획", "2025-03-01", "2025-03-10"]],
    )
    sec = _section([blk])
    _run_autodetect_with_gantt([sec], _Summary())
    g = sec["blocks"][0]
    assert g["type"] == "gantt"
    assert len(g["tasks"]) == 1
    t = g["tasks"][0]
    assert t == {"name": "기획", "start": "2025-03-01", "end": "2025-03-10"}
    assert "progress" not in t


def test_autodetect_gantt_missing_end_column_returns_none() -> None:
    blk = _table(
        ["Task", "Start"],
        [["A", "2025-01-01"]],
    )
    sec = _section([blk])
    _run_autodetect_with_gantt([sec], _Summary())
    out = sec["blocks"][0]
    assert out["type"] == "table"
    assert out["id"] == blk["id"]


def test_autodetect_gantt_chart_style_table_returns_none() -> None:
    # False-positive guard: a chart-shaped table has no name/start/end.
    blk = _table(
        ["Month", "Revenue", "Profit"],
        [
            ["Jan", "100", "10"],
            ["Feb", "120", "15"],
        ],
    )
    sec = _section([blk])
    _run_autodetect_with_gantt([sec], _Summary())
    out = sec["blocks"][0]
    assert out["type"] == "table"
    assert out["id"] == blk["id"]


def test_autodetect_gantt_bold_wrapped_headers() -> None:
    # docx/pptx round-trip may wrap header cells in `**…**`.
    blk = _table(
        ["**Task**", "**Start**", "**End**"],
        [["A", "2025-01-01", "2025-01-05"]],
    )
    sec = _section([blk])
    _run_autodetect_with_gantt([sec], _Summary())
    g = sec["blocks"][0]
    assert g["type"] == "gantt"
    assert g["tasks"] == [{"name": "A", "start": "2025-01-01", "end": "2025-01-05"}]


def test_autodetect_gantt_skips_rows_with_empty_name() -> None:
    blk = _table(
        ["Task", "Start", "End"],
        [
            ["Real", "2025-01-01", "2025-01-05"],
            ["", "2025-01-06", "2025-01-10"],
        ],
    )
    sec = _section([blk])
    _run_autodetect_with_gantt([sec], _Summary())
    g = sec["blocks"][0]
    assert g["type"] == "gantt"
    assert len(g["tasks"]) == 1
    assert g["tasks"][0]["name"] == "Real"


def test_autodetect_gantt_zero_valid_tasks_returns_none() -> None:
    blk = _table(
        ["Task", "Start", "End"],
        [
            ["", "2025-01-01", "2025-01-05"],
            ["", "2025-01-06", "2025-01-10"],
        ],
    )
    sec = _section([blk])
    _run_autodetect_with_gantt([sec], _Summary())
    out = sec["blocks"][0]
    assert out["type"] == "table"
    assert out["id"] == blk["id"]


def test_autodetect_gantt_function_is_callable() -> None:
    assert callable(_autodetect_gantt)
    assert ("gantt", _autodetect_gantt) in WIDGET_AUTODETECTORS


# ── KPI-cards auto-detection (G3) ───────────────────────────────────


def _kpi_table(
    headers: list[str],
    rows: list[list[str]],
) -> dict[str, Any]:
    return {
        "type": "table",
        "id": _u(),
        "headers": list(headers),
        "rows": [list(r) for r in rows],
    }


def _run_autodetect_with_kpi_cards(
    sections: list[dict[str, Any]],
    summary: _Summary,
) -> None:
    """Temporarily register `_autodetect_kpi_cards` so the dispatcher walk
    can exercise it end-to-end, then restore the original list.
    """
    original = list(WIDGET_AUTODETECTORS)
    WIDGET_AUTODETECTORS.append(("kpi-cards", _autodetect_kpi_cards))
    try:
        apply_widget_autodetect(sections, summary)
    finally:
        WIDGET_AUTODETECTORS.clear()
        WIDGET_AUTODETECTORS.extend(original)


def test_autodetect_kpi_cards_basic() -> None:
    sec = _section([
        _kpi_table(
            headers=["label", "value"],
            rows=[["매출", "100억"], ["MAU", "5만"]],
        ),
    ])
    s = _Summary()
    _run_autodetect_with_kpi_cards([sec], s)
    blocks = sec["blocks"]
    assert len(blocks) == 1
    b = blocks[0]
    assert b["type"] == "kpi-cards"
    assert len(b["items"]) == 2
    assert b["items"][0]["label"] == "매출"
    assert b["items"][0]["value"] == "100억"
    assert b["items"][1]["label"] == "MAU"
    assert b["items"][1]["value"] == "5만"
    assert any(
        "auto-detected kpi-cards" in w and "N=2" in w for w in s.warnings
    )


def test_autodetect_kpi_cards_with_optional_columns() -> None:
    sec = _section([
        _kpi_table(
            headers=["label", "value", "delta", "trend"],
            rows=[["매출", "100억", "+10%", "up"]],
        ),
    ])
    _run_autodetect_with_kpi_cards([sec], _Summary())
    b = sec["blocks"][0]
    assert b["type"] == "kpi-cards"
    assert len(b["items"]) == 1
    assert b["items"][0]["delta"] == "+10%"
    assert b["items"][0]["trend"] == "up"


def test_autodetect_kpi_cards_bold_wrapped_headers() -> None:
    sec = _section([
        _kpi_table(
            headers=["**label**", "**value**"],
            rows=[["매출", "100억"]],
        ),
    ])
    _run_autodetect_with_kpi_cards([sec], _Summary())
    b = sec["blocks"][0]
    assert b["type"] == "kpi-cards"
    assert len(b["items"]) == 1
    assert b["items"][0]["label"] == "매출"
    assert b["items"][0]["value"] == "100억"


def test_autodetect_kpi_cards_missing_value_column_returns_none() -> None:
    blk = _kpi_table(headers=["label", "x"], rows=[["매출", "100억"]])
    sec = _section([blk])
    _run_autodetect_with_kpi_cards([sec], _Summary())
    out = sec["blocks"][0]
    assert out["type"] == "table"
    assert out["id"] == blk["id"]


def test_autodetect_kpi_cards_too_many_rows_returns_none() -> None:
    blk = _kpi_table(
        headers=["label", "value"],
        rows=[
            ["a", "1"], ["b", "2"], ["c", "3"], ["d", "4"], ["e", "5"],
        ],
    )
    sec = _section([blk])
    _run_autodetect_with_kpi_cards([sec], _Summary())
    out = sec["blocks"][0]
    assert out["type"] == "table"
    assert out["id"] == blk["id"]


def test_autodetect_kpi_cards_zero_rows_returns_none() -> None:
    blk = _kpi_table(headers=["label", "value"], rows=[])
    sec = _section([blk])
    _run_autodetect_with_kpi_cards([sec], _Summary())
    out = sec["blocks"][0]
    assert out["type"] == "table"
    assert out["id"] == blk["id"]


def test_autodetect_kpi_cards_extra_columns_ignored() -> None:
    sec = _section([
        _kpi_table(
            headers=["label", "value", "note", "author"],
            rows=[["매출", "100억", "Q1", "alice"]],
        ),
    ])
    _run_autodetect_with_kpi_cards([sec], _Summary())
    b = sec["blocks"][0]
    assert b["type"] == "kpi-cards"
    assert len(b["items"]) == 1
    item = b["items"][0]
    assert item["label"] == "매출"
    assert item["value"] == "100억"
    assert "note" not in item
    assert "author" not in item


# ── Section-level columns auto-detection (G3) ───────────────────────


def _para(text: str = "p") -> dict[str, Any]:
    return {"type": "paragraph", "id": _u(), "text": text}


def test_section_column_autodetect_wraps_two_cols() -> None:
    blocks = [_para("a"), _para("b"), _para("c"), _para("d")]
    sec = _section(list(blocks))
    sec["multi_column"] = 2
    s = _Summary()
    apply_section_column_autodetect([sec], s)
    assert "multi_column" not in sec
    assert len(sec["blocks"]) == 1
    cb = sec["blocks"][0]
    assert cb["type"] == "columns"
    assert len(cb["columns"]) == 2
    assert cb["columns"][0] == [blocks[0], blocks[1]]
    assert cb["columns"][1] == [blocks[2], blocks[3]]
    assert any("2-column section" in w for w in s.warnings)


def test_section_column_autodetect_three_cols() -> None:
    blocks = [_para(str(i)) for i in range(6)]
    sec = _section(list(blocks))
    sec["multi_column"] = 3
    apply_section_column_autodetect([sec], _Summary())
    cb = sec["blocks"][0]
    assert cb["type"] == "columns"
    assert len(cb["columns"]) == 3
    assert cb["columns"][0] == [blocks[0], blocks[1]]
    assert cb["columns"][1] == [blocks[2], blocks[3]]
    assert cb["columns"][2] == [blocks[4], blocks[5]]


def test_section_column_autodetect_uneven_distribution() -> None:
    # 3 blocks, N=2 → per_col = ceil(3/2) = 2 → col0 has 2, col1 has 1.
    blocks = [_para("a"), _para("b"), _para("c")]
    sec = _section(list(blocks))
    sec["multi_column"] = 2
    apply_section_column_autodetect([sec], _Summary())
    cb = sec["blocks"][0]
    assert cb["type"] == "columns"
    assert len(cb["columns"]) == 2
    assert cb["columns"][0] == [blocks[0], blocks[1]]
    assert cb["columns"][1] == [blocks[2]]


def test_section_column_autodetect_too_few_blocks_skips() -> None:
    # 1 block, N=4 → per_col=1 → only col0 is non-empty → < 2 chunks → skip.
    only = _para("solo")
    sec = _section([only])
    sec["multi_column"] = 4
    s = _Summary()
    apply_section_column_autodetect([sec], s)
    assert "multi_column" not in sec
    assert sec["blocks"] == [only]
    assert not any("column section" in w for w in s.warnings)


def test_section_column_autodetect_no_multi_column_unchanged() -> None:
    blocks = [_para("a"), _para("b")]
    sec = _section(list(blocks))
    # No `multi_column` key.
    s = _Summary()
    apply_section_column_autodetect([sec], s)
    assert sec["blocks"] == blocks
    assert s.warnings == []


def test_section_column_autodetect_recurses_subsections() -> None:
    inner_blocks = [_para("a"), _para("b"), _para("c"), _para("d")]
    inner = _section(list(inner_blocks))
    inner["multi_column"] = 2
    outer = _section([])
    outer["subsections"] = [inner]
    apply_section_column_autodetect([outer], _Summary())
    assert "multi_column" not in inner
    assert len(inner["blocks"]) == 1
    cb = inner["blocks"][0]
    assert cb["type"] == "columns"
    assert len(cb["columns"]) == 2


def _build_docx_with_cols(num_cols: int, body_inner: str) -> bytes:
    """Construct a minimal .docx whose body ends with
    ``<w:sectPr><w:cols w:num="N"/></w:sectPr>``. ``body_inner`` is the
    raw XML for the body's content paragraphs/tables.
    """
    import io as _io
    import zipfile as _zip

    document_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        f'<w:body>{body_inner}'
        f'<w:sectPr><w:cols w:num="{num_cols}"/></w:sectPr>'
        '</w:body></w:document>'
    )
    rels_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '</Relationships>'
    )
    content_types = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/word/document.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
        '</Types>'
    )
    package_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" '
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
        'Target="word/document.xml"/>'
        '</Relationships>'
    )
    out = _io.BytesIO()
    with _zip.ZipFile(out, "w", _zip.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", content_types)
        zf.writestr("_rels/.rels", package_rels)
        zf.writestr("word/document.xml", document_xml)
        zf.writestr("word/_rels/document.xml.rels", rels_xml)
    return out.getvalue()


def test_docx_import_autodetects_columns_from_sectpr_cols() -> None:
    """End-to-end: a docx whose body's <w:sectPr> carries <w:cols w:num="2"/>
    yields a top-level section whose blocks are wrapped in a ColumnsBlock.
    """
    # 4 plain paragraphs → with N=2, expect a columns block with 2 columns
    # of 2 paragraphs each.
    body_inner = "".join(
        f'<w:p><w:r><w:t xml:space="preserve">{txt}</w:t></w:r></w:p>'
        for txt in ("alpha", "beta", "gamma", "delta")
    )
    blob = _build_docx_with_cols(2, body_inner)
    result = docx_to_document(blob, slug="cols", title="T", owner_user_id=_u())
    sections = result["document"].get("sections") or []
    assert sections, "no sections produced"
    top = sections[0]
    assert "multi_column" not in top
    assert len(top["blocks"]) == 1
    cb = top["blocks"][0]
    assert cb["type"] == "columns"
    assert len(cb["columns"]) == 2
    # Each column should hold 2 paragraph blocks.
    for col in cb["columns"]:
        assert len(col) == 2
        for b in col:
            assert b["type"] == "paragraph"


# ── Shaded-paragraph callout autodetect (marker-less) ────────────────


def test_autodetect_callout_from_shaded_paragraph_with_emoji() -> None:
    sec = _section([{
        "type": "paragraph", "id": _u(), "text": "⚠️ 작업 중지 금지",
        "__paragraph_bg__": "#FFF0F0",
    }])
    apply_widget_autodetect([sec], _Summary())
    b = sec["blocks"][0]
    assert b["type"] == "callout"
    assert b["variant"] == "warn"
    assert b["text"] == "작업 중지 금지"


def test_autodetect_callout_from_shaded_paragraph_with_label() -> None:
    sec = _section([{
        "type": "paragraph", "id": _u(), "text": "[주의] 내용",
        "__paragraph_bg__": "#FFE0E0",
    }])
    apply_widget_autodetect([sec], _Summary())
    b = sec["blocks"][0]
    assert b["type"] == "callout"
    assert b["variant"] == "warn"


def test_autodetect_callout_skips_shaded_paragraph_without_signal() -> None:
    # Shaded paragraph WITHOUT emoji/label → not a callout.
    sec = _section([{
        "type": "paragraph", "id": _u(), "text": "그냥 색칠된 단락",
        "__paragraph_bg__": "#FFE0E0",
    }])
    apply_widget_autodetect([sec], _Summary())
    assert sec["blocks"][0]["type"] == "paragraph"


def test_autodetect_callout_skips_paragraph_emoji_without_shading() -> None:
    # Emoji without BG color → not strict enough.
    sec = _section([{
        "type": "paragraph", "id": _u(), "text": "⚠️ 그냥 텍스트"
    }])
    apply_widget_autodetect([sec], _Summary())
    assert sec["blocks"][0]["type"] == "paragraph"


def test_autodetect_transient_paragraph_bg_field_is_stripped() -> None:
    sec = _section([{
        "type": "paragraph", "id": _u(), "text": "그냥 단락",
        "__paragraph_bg__": "#FFFFFF",
    }])
    apply_widget_autodetect([sec], _Summary())
    # The transient field should be removed after the pass.
    assert "__paragraph_bg__" not in sec["blocks"][0]
