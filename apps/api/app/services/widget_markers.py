"""Widget marker recognition for docx/pptx import.

LLM 이 `Widget: callout (warn)` + 단락 같은 약속된 패턴을 docx/pptx 에 박으면
import 시 진짜 위젯 블록 (callout/kpi-cards/…) 으로 변환된다. 마커 단락은
소비되고, 마커 뒤 1 개의 target 블록이 변환 함수로 전달된다.

Phase 1: ``callout`` + ``kpi-cards`` 만 지원. 나머지 12 위젯은 dispatcher 의
``None`` 자리에 등록돼 있어 마커는 인식하되 "미지원" 경고만 남기고 target
블록은 평소대로 emit. Phase 2 에서 converter 함수 채워 넣기만 하면 확장.

후처리(post-pass) 패턴 — `_build_sections()` 가 본문 walk 를 마친 후
:func:`apply_widget_markers` 가 각 section.blocks 리스트를 한 번 더 훑어
`[marker_paragraph, target_block]` 쌍을 단일 위젯 블록으로 rewrite. walk
로직 자체는 변경 없음 → 회귀 위험 최소.
"""
from __future__ import annotations

import re
from typing import Any, Callable, Protocol

import ulid

# Match groups:
#   1 = widget type (lowercase letters / hyphens)
#   2 = optional variant or args inside parens
WIDGET_MARKER_RE = re.compile(
    r"^\s*(?:Widget|위젯)\s*:\s*([a-z][a-z0-9-]*)"
    r"\s*(?:\(\s*([^)]+?)\s*\))?\s*$",
    re.IGNORECASE,
)


class _SummaryLike(Protocol):
    """Subset of ImportSummary that widget conversion mutates."""

    warnings: list[str]


def _new_id() -> str:
    return str(ulid.new())


def parse_marker(text: str) -> tuple[str, str | None] | None:
    """Return ``(widget_type_lc, variant_or_None)`` if ``text`` is a marker."""
    if not text:
        return None
    m = WIDGET_MARKER_RE.match(text.strip())
    if not m:
        return None
    widget_type = m.group(1).lower()
    variant = (m.group(2) or "").strip() or None
    return widget_type, variant


# ── Phase 1 converters ───────────────────────────────────────────────


_ALLOWED_CALLOUT_VARIANTS = {"info", "warn", "danger", "tip"}


def _convert_callout(
    variant: str | None,
    target: dict[str, Any],
    _summary: _SummaryLike,
) -> dict[str, Any] | None:
    """``Widget: callout (variant)`` + 단락 → CalloutBlock.

    Variant 가 알 수 없는 값이면 ``info`` 로 폴백.
    """
    if target.get("type") != "paragraph":
        return None
    v = (variant or "info").lower()
    if v not in _ALLOWED_CALLOUT_VARIANTS:
        v = "info"
    text = str(target.get("text") or "")
    if not text.strip():
        return None
    return {
        "type": "callout",
        "id": _new_id(),
        "variant": v,
        "text": text,
    }


def _convert_kpi_cards(
    _variant: str | None,
    target: dict[str, Any],
    _summary: _SummaryLike,
) -> dict[str, Any] | None:
    """``Widget: kpi-cards`` + 표 → KpiCardsBlock.

    표 헤더가 ``label`` / ``value`` 를 포함해야 함. ``delta`` / ``trend`` 는
    옵션. 최대 4 카드 (KpiCardsBlock 의 시각적 캡 일치).
    """
    if target.get("type") != "table":
        return None
    headers = target.get("headers") or []
    rows = target.get("rows") or []
    if not headers or not rows:
        return None
    headers_lc = [str(h).strip().lower() for h in headers]

    def _col(name: str) -> int | None:
        try:
            return headers_lc.index(name)
        except ValueError:
            return None

    label_i = _col("label")
    value_i = _col("value")
    if label_i is None or value_i is None:
        return None
    delta_i = _col("delta")
    trend_i = _col("trend")

    items: list[dict[str, Any]] = []
    for row in rows[:4]:
        cells = list(row) if isinstance(row, list) else []

        def _cell(i: int | None) -> str:
            if i is None or i >= len(cells):
                return ""
            return str(cells[i] or "").strip()

        item: dict[str, Any] = {
            "label": _cell(label_i),
            "value": _cell(value_i),
        }
        d = _cell(delta_i)
        t = _cell(trend_i)
        if d:
            item["delta"] = d
        if t:
            item["trend"] = t
        items.append(item)
    if not items:
        return None
    return {
        "type": "kpi-cards",
        "id": _new_id(),
        "items": items,
    }


# ── Dispatcher ───────────────────────────────────────────────────────

# Converter signature: (variant, target_block, summary) -> widget_block_or_None
ConverterFn = Callable[
    [str | None, dict[str, Any], _SummaryLike],
    dict[str, Any] | None,
]

WIDGET_CONVERTERS: dict[str, ConverterFn | None] = {
    "callout": _convert_callout,
    "kpi-cards": _convert_kpi_cards,
    # ── Phase 2 hooks (recognised but not converted yet) ──────────────
    "chart": None,
    "gantt": None,
    "flow": None,
    "org-chart": None,
    "columns": None,
    "tabs": None,
    "accordion": None,
    "gallery": None,
    "doc-link": None,
    "glossary": None,
    "image-annotation": None,
    "iframe": None,
    "video": None,
    "file": None,
    "pdf": None,
    "whiteboard": None,
}


def apply_widget_markers(
    sections: list[dict[str, Any]],
    summary: _SummaryLike,
) -> None:
    """Walk every section + subsection. Rewrite consecutive
    ``[marker_paragraph, target_block]`` pairs into a single widget block.

    Mutates ``sections`` in place. Adds a warning for each recognised but
    unsupported marker type so authors know which Phase 2 work is gated.
    """
    for sec in sections:
        _rewrite_blocks(sec.get("blocks") or [], summary, sec)
        subs = sec.get("subsections") or []
        if subs:
            apply_widget_markers(subs, summary)


def _rewrite_blocks(
    blocks: list[dict[str, Any]],
    summary: _SummaryLike,
    parent_section: dict[str, Any],
) -> None:
    if not blocks:
        return
    out: list[dict[str, Any]] = []
    i = 0
    while i < len(blocks):
        block = blocks[i]
        marker = (
            parse_marker(str(block.get("text") or ""))
            if block.get("type") == "paragraph"
            else None
        )
        if marker is None:
            out.append(block)
            i += 1
            continue
        widget_type, variant = marker
        if widget_type not in WIDGET_CONVERTERS:
            # Unknown widget type — keep marker paragraph as-is, no warning
            # to avoid spamming for normal "Widget:" looking text (rare).
            out.append(block)
            i += 1
            continue
        converter = WIDGET_CONVERTERS[widget_type]
        if converter is None:
            summary.warnings.append(
                f"Widget marker '{widget_type}' is not yet supported "
                "(recognised but not converted in Phase 1)"
            )
            # Drop the marker paragraph; keep the target block as-is.
            i += 1
            continue
        if i + 1 >= len(blocks):
            # Marker with no following block — drop the marker silently.
            i += 1
            continue
        target = blocks[i + 1]
        widget = converter(variant, target, summary)
        if widget is None:
            # Conversion failed (wrong target type, missing required
            # headers, etc.) — keep both blocks intact to avoid info loss.
            out.append(block)
            i += 1
            continue
        out.append(widget)
        i += 2
    # Mutate the original list in place so callers can keep their reference.
    blocks.clear()
    blocks.extend(out)
