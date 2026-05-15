"""Widget marker recognition for docx/pptx import.

LLM 이 `Widget: callout (warn)` + 단락 같은 약속된 패턴을 docx/pptx 에 박으면
import 시 진짜 위젯 블록 (callout/kpi-cards/…) 으로 변환된다. 마커 단락은
소비되고, 마커 뒤 1 개 이상의 target 블록이 변환 함수로 전달된다.

Phase 1: ``callout`` + ``kpi-cards``. Phase 2: 14 추가 위젯 (chart / gantt /
flow / org-chart / columns / tabs / accordion / gallery / doc-link-card /
glossary-ref / image-annotation / iframe / video / file / pdf / whiteboard).

후처리(post-pass) 패턴 — `_build_sections()` 가 본문 walk 를 마친 후
:func:`apply_widget_markers` 가 각 section.blocks 리스트를 한 번 더 훑어
`[marker_paragraph, target_block, …]` 시퀀스를 단일 위젯 블록으로 rewrite.
walk 로직 자체는 변경 없음 → 회귀 위험 최소.

Converter 시그니처 (Phase 2):
    fn(variant, targets, summary) -> (widget_block, n_consumed) | None

`targets` 는 marker 다음 모든 블록의 리스트 (lookahead window). converter
는 자기가 소비한 갯수 ``n_consumed`` (>=1) 를 반환해 multi-block 위젯
(gallery / tabs / accordion / columns) 을 지원한다. ``None`` 반환 시
정보 손실 0 룰: marker + target 모두 보존.
"""
from __future__ import annotations

import re
from typing import Any, Callable, Protocol
from urllib.parse import urlparse

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
    targets: list[dict[str, Any]],
    _summary: _SummaryLike,
) -> tuple[dict[str, Any], int] | None:
    """``Widget: callout (variant)`` + 단락 → CalloutBlock.

    Variant 가 알 수 없는 값이면 ``info`` 로 폴백.
    """
    if not targets:
        return None
    target = targets[0]
    if target.get("type") != "paragraph":
        return None
    v = (variant or "info").lower()
    if v not in _ALLOWED_CALLOUT_VARIANTS:
        v = "info"
    text = str(target.get("text") or "")
    if not text.strip():
        return None
    return (
        {
            "type": "callout",
            "id": _new_id(),
            "variant": v,
            "text": text,
        },
        1,
    )


def _convert_kpi_cards(
    _variant: str | None,
    targets: list[dict[str, Any]],
    _summary: _SummaryLike,
) -> tuple[dict[str, Any], int] | None:
    """``Widget: kpi-cards`` + 표 → KpiCardsBlock.

    표 헤더가 ``label`` / ``value`` 를 포함해야 함. ``delta`` / ``trend`` 는
    옵션. 최대 4 카드 (KpiCardsBlock 의 시각적 캡 일치).
    """
    if not targets:
        return None
    target = targets[0]
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
    return (
        {
            "type": "kpi-cards",
            "id": _new_id(),
            "items": items,
        },
        1,
    )


_ALLOWED_CHART_TYPES = {"line", "bar", "pie", "area", "radar", "scatter"}


def _parse_number(s: str) -> float | None:
    """Parse plain int/float, percent ("10%"), thousands ("1,234"). Returns
    ``None`` if the cell isn't a numeric value after trimming."""
    if s is None:
        return None
    t = str(s).strip()
    if not t:
        return None
    if t.endswith("%"):
        t = t[:-1].strip()
    t = t.replace(",", "")
    try:
        return float(t)
    except ValueError:
        return None


def _convert_chart(
    variant: str | None,
    targets: list[dict[str, Any]],
    _summary: _SummaryLike,
) -> tuple[dict[str, Any], int] | None:
    """``Widget: chart (line|bar|…)`` + 표 → ChartBlock.

    Column 0 → x-axis labels; columns 1..N → series (one per column).
    Variant 가 빠지거나 enum 밖이면 ``bar`` 폴백.
    """
    if not targets:
        return None
    target = targets[0]
    if target.get("type") != "table":
        return None
    headers = target.get("headers") or []
    rows = target.get("rows") or []
    if len(headers) < 2:
        return None

    chart_type = (variant or "").strip().lower()
    if chart_type not in _ALLOWED_CHART_TYPES:
        chart_type = "bar"

    series_names = [str(h) for h in headers[1:]]
    labels: list[str] = []
    series_values: list[list[float]] = [[] for _ in series_names]

    for row in rows:
        cells = list(row) if isinstance(row, list) else []
        parsed = [
            _parse_number(str(cells[k + 1])) if k + 1 < len(cells) else None
            for k in range(len(series_names))
        ]
        if all(v is None for v in parsed):
            continue
        label = str(cells[0]).strip() if cells else ""
        labels.append(label)
        # Missing cells in a partially-filled row get 0.0 so every series
        # ends up with len == len(labels). Otherwise the renderer gets a
        # ragged dataset that misaligns x-axis labels.
        for k, v in enumerate(parsed):
            series_values[k].append(v if v is not None else 0.0)

    if not labels:
        return None

    series = [
        {"name": name, "values": series_values[k]}
        for k, name in enumerate(series_names)
    ]

    widget: dict[str, Any] = {
        "type": "chart",
        "id": _new_id(),
        "chartType": chart_type,
        "data": {"labels": labels, "series": series},
    }
    meta = target.get("meta") or {}
    caption = meta.get("caption") if isinstance(meta, dict) else None
    if isinstance(caption, str) and caption.strip():
        widget["title"] = caption
    return widget, 1


def _codeblock_source(block: dict[str, Any]) -> str | None:
    """Return the first non-empty source-text field from a CodeBlock-shaped dict.

    Schema defines ``code``; alternative shapes may use ``source`` or ``text``.
    Returns None if none of them carry a non-empty string.
    """
    for key in ("code", "source", "text"):
        value = block.get(key)
        if isinstance(value, str) and value.strip():
            return value
    return None


def _convert_flow(
    _variant: str | None,
    targets: list[dict[str, Any]],
    _summary: _SummaryLike,
) -> tuple[dict[str, Any], int] | None:
    """``Widget: flow`` + 코드 블록 → FlowBlock (engine=mermaid).

    Schema 는 excalidraw 도 허용하지만 docx/pptx authoring 경로는 mermaid 만.
    """
    if not targets:
        return None
    target = targets[0]
    if target.get("type") != "code":
        return None
    source = _codeblock_source(target)
    if not source:
        return None
    return (
        {
            "type": "flow",
            "id": _new_id(),
            "engine": "mermaid",
            "source": source,
        },
        1,
    )


_GANTT_NAME_HEADERS = {"name", "task", "task name", "작업", "이름"}
_GANTT_START_HEADERS = {"start", "start date", "시작"}
_GANTT_END_HEADERS = {"end", "end date", "종료"}
_GANTT_PROGRESS_HEADERS = {"progress", "progress%", "진행률"}


def _convert_gantt(
    _variant: str | None,
    targets: list[dict[str, Any]],
    _summary: _SummaryLike,
) -> tuple[dict[str, Any], int] | None:
    """``Widget: gantt`` + 표 → GanttBlock.

    표 헤더는 ``name`` / ``start`` / ``end`` 컬럼을 (영/한 별칭 포함) 가져야 함.
    ``progress`` 는 옵션이며 ``"50%"`` 또는 ``"50"`` 을 0-100 float 로 파싱.
    """
    if not targets:
        return None
    target = targets[0]
    if target.get("type") != "table":
        return None
    headers = target.get("headers") or []
    rows = target.get("rows") or []
    if not headers or not rows:
        return None
    headers_lc = [str(h).strip().lower() for h in headers]

    def _col(aliases: set[str]) -> int | None:
        for i, h in enumerate(headers_lc):
            if h in aliases:
                return i
        return None

    name_i = _col(_GANTT_NAME_HEADERS)
    start_i = _col(_GANTT_START_HEADERS)
    end_i = _col(_GANTT_END_HEADERS)
    if name_i is None or start_i is None or end_i is None:
        return None
    progress_i = _col(_GANTT_PROGRESS_HEADERS)

    tasks: list[dict[str, Any]] = []
    for row in rows:
        cells = list(row) if isinstance(row, list) else []

        def _cell(i: int | None) -> str:
            if i is None or i >= len(cells):
                return ""
            return str(cells[i] or "").strip()

        name = _cell(name_i)
        if not name:
            continue
        task: dict[str, Any] = {
            "name": name,
            "start": _cell(start_i),
            "end": _cell(end_i),
        }
        if progress_i is not None:
            raw = _cell(progress_i)
            if raw:
                s = raw.rstrip("%").strip()
                try:
                    p = float(s)
                except ValueError:
                    p = None
                if p is not None and 0 <= p <= 100:
                    task["progress"] = p
        tasks.append(task)
    if not tasks:
        return None
    return (
        {
            "type": "gantt",
            "id": _new_id(),
            "tasks": tasks,
        },
        1,
    )


def _convert_image_annotation(
    _variant: str | None,
    targets: list[dict[str, Any]],
    _summary: _SummaryLike,
) -> tuple[dict[str, Any], int] | None:
    """``Widget: image-annotation`` + ImageBlock (+ optional TableBlock) →
    ImageAnnotationBlock.

    Optional second target is a TableBlock whose rows describe arrow/rect/
    callout annotations over the image. Field name asymmetry: ImageBlock
    carries ``imageId`` (camelCase) while ImageAnnotationBlock stores it as
    ``image_id`` (snake_case) — keep that conversion in mind when editing.
    """
    if not targets:
        return None
    img = targets[0]
    if img.get("type") != "image":
        return None
    image_id = str(img.get("imageId") or "")

    annotations: list[dict[str, Any]] = []
    n_consumed = 1

    if len(targets) >= 2 and targets[1].get("type") == "table":
        table = targets[1]
        headers = table.get("headers") or []
        rows = table.get("rows") or []
        headers_lc = [str(h).strip().lower() for h in headers]

        def _col(*names: str) -> int | None:
            for name in names:
                try:
                    return headers_lc.index(name)
                except ValueError:
                    continue
            return None

        kind_i = _col("kind")
        if kind_i is not None:
            x_i = _col("x")
            y_i = _col("y")
            fx_i = _col("from_x", "fx")
            fy_i = _col("from_y", "fy")
            tx_i = _col("to_x", "tx")
            ty_i = _col("to_y", "ty")
            w_i = _col("w", "width")
            h_i = _col("h", "height")
            text_i = _col("text", "label")
            color_i = _col("color")

            def _cell(cells: list[Any], i: int | None) -> str:
                if i is None or i >= len(cells):
                    return ""
                return str(cells[i] or "").strip()

            for row in rows:
                cells = list(row) if isinstance(row, list) else []
                kind = _cell(cells, kind_i).lower()
                color = _cell(cells, color_i) or "#000000"

                if kind == "arrow":
                    from_x = _parse_number(
                        _cell(cells, fx_i) or _cell(cells, x_i)
                    )
                    from_y = _parse_number(
                        _cell(cells, fy_i) or _cell(cells, y_i)
                    )
                    to_x = _parse_number(_cell(cells, tx_i))
                    to_y = _parse_number(_cell(cells, ty_i))
                    if None in (from_x, from_y, to_x, to_y):
                        continue
                    annotations.append({
                        "kind": "arrow",
                        "id": _new_id(),
                        "from": {"x": from_x, "y": from_y},
                        "to": {"x": to_x, "y": to_y},
                        "color": color,
                    })
                elif kind == "rect":
                    x = _parse_number(_cell(cells, x_i))
                    y = _parse_number(_cell(cells, y_i))
                    w = _parse_number(_cell(cells, w_i))
                    h = _parse_number(_cell(cells, h_i))
                    if None in (x, y, w, h):
                        continue
                    annotations.append({
                        "kind": "rect",
                        "id": _new_id(),
                        "x": x,
                        "y": y,
                        "w": w,
                        "h": h,
                        "color": color,
                    })
                elif kind == "callout":
                    x = _parse_number(_cell(cells, x_i))
                    y = _parse_number(_cell(cells, y_i))
                    text = _cell(cells, text_i)
                    if x is None or y is None or not text:
                        continue
                    annotations.append({
                        "kind": "callout",
                        "id": _new_id(),
                        "x": x,
                        "y": y,
                        "text": text,
                        "color": color,
                    })

            if annotations:
                n_consumed = 2

    return (
        {
            "type": "image-annotation",
            "id": _new_id(),
            "image_id": image_id,
            "annotations": annotations,
        },
        n_consumed,
    )


def _convert_gallery(
    variant: str | None,
    targets: list[dict[str, Any]],
    _summary: _SummaryLike,
) -> tuple[dict[str, Any], int] | None:
    """``Widget: gallery`` (또는 ``Widget: gallery (carousel)``) + 연속된
    ImageBlock N 개 → GalleryBlock.

    Multi-block consumer: ``targets`` 앞쪽에서 image 가 연속되는 만큼 소비.
    image 가 0 개면 None (정보 손실 0 룰). 1 개여도 gallery 로 변환 — schema
    minItems=1 을 만족하며 marker 의 의도를 존중한다.
    """
    items: list[dict[str, Any]] = []
    n_consumed = 0
    for t in targets:
        if t.get("type") != "image":
            break
        image_id = str(t.get("imageId") or "")
        item: dict[str, Any] = {"imageId": image_id}
        caption = t.get("caption")
        if isinstance(caption, str) and caption:
            item["caption"] = caption
        alt = t.get("alt")
        if isinstance(alt, str) and alt:
            item["alt"] = alt
        items.append(item)
        n_consumed += 1
    if n_consumed == 0:
        return None
    layout = "carousel" if (variant or "").lower() == "carousel" else "grid"
    return (
        {
            "type": "gallery",
            "id": _new_id(),
            "layout": layout,
            "items": items,
        },
        n_consumed,
    )


def _convert_glossary(
    _variant: str | None,
    targets: list[dict[str, Any]],
    _summary: _SummaryLike,
) -> tuple[dict[str, Any], int] | None:
    """``Widget: glossary`` + 단락 → GlossaryRefBlock.

    Target paragraph 의 텍스트가 용어 (``term``) 가 된다. 빈 텍스트나
    paragraph 가 아닌 target 은 변환 실패 (정보 손실 0 룰).
    """
    if not targets:
        return None
    target = targets[0]
    if target.get("type") != "paragraph":
        return None
    term = str(target.get("text") or "").strip()
    if not term:
        return None
    return (
        {
            "type": "glossary-ref",
            "id": _new_id(),
            "term": term,
        },
        1,
    )


_SLUG_RE = re.compile(
    r"^[a-z0-9가-힣][a-z0-9가-힣-]{0,99}$"
)


def _convert_doc_link(
    _variant: str | None,
    targets: list[dict[str, Any]],
    _summary: _SummaryLike,
) -> tuple[dict[str, Any], int] | None:
    """``Widget: doc-link`` + 단락 (slug 또는 ``/docs/<slug>`` URL) → DocLinkCardBlock.

    슬러그가 schema 의 Slug 패턴에 맞지 않으면 None (정보 손실 0 룰).
    """
    if not targets:
        return None
    target = targets[0]
    if target.get("type") != "paragraph":
        return None
    text = str(target.get("text") or "").strip()
    if not text:
        return None
    if text.startswith("http") or text.startswith("/") or "/docs/" in text:
        segments = [s for s in text.split("/") if s]
        if not segments:
            return None
        slug = segments[-1]
    else:
        slug = text
    if not _SLUG_RE.match(slug):
        return None
    return (
        {
            "type": "doc-link-card",
            "id": _new_id(),
            "slug": slug,
        },
        1,
    )


def _org_chart_indent_depth(s: str) -> int:
    """Infer depth from leading whitespace: tabs count as one level each;
    otherwise count leading spaces / 2 (floor)."""
    depth = 0
    i = 0
    spaces = 0
    while i < len(s):
        ch = s[i]
        if ch == "\t":
            depth += 1
            i += 1
        elif ch == " ":
            spaces += 1
            i += 1
        else:
            break
    depth += spaces // 2
    return depth


def _convert_org_chart(
    _variant: str | None,
    targets: list[dict[str, Any]],
    summary: _SummaryLike,
) -> tuple[dict[str, Any], int] | None:
    """``Widget: org-chart`` + list/table → OrgChartBlock.

    List branch: each item is a string; depth is inferred from leading
    whitespace (2 spaces or 1 tab = 1 level). Stack-based attach: each
    item becomes a child of the most-recent node at depth-1.
    Table branch: requires ``name`` + ``parent`` columns; empty parent
    means root. Multiple roots → first wins + warning.
    """
    if not targets:
        return None
    target = targets[0]
    ttype = target.get("type")

    if ttype == "list":
        items = target.get("items") or []
        parsed: list[tuple[int, str]] = []
        for it in items:
            if isinstance(it, str):
                depth = _org_chart_indent_depth(it)
                label = it.strip()
            elif isinstance(it, dict):
                if "depth" in it:
                    depth = int(it.get("depth") or 0)
                elif "level" in it:
                    depth = int(it.get("level") or 0)
                else:
                    depth = 0
                label = str(it.get("text") or it.get("label") or "").strip()
            else:
                continue
            if not label:
                continue
            parsed.append((depth, label))
        if not parsed:
            return None

        roots: list[dict[str, Any]] = []
        # stack[d] = most recent node at depth d (used to attach children)
        stack: dict[int, dict[str, Any]] = {}
        for depth, label in parsed:
            node: dict[str, Any] = {"id": _new_id(), "label": label}
            if depth <= 0:
                roots.append(node)
                stack = {0: node}
            else:
                parent = stack.get(depth - 1)
                if parent is None:
                    # Orphan — promote to root.
                    roots.append(node)
                    stack = {0: node}
                else:
                    parent.setdefault("children", []).append(node)
                    for d in list(stack.keys()):
                        if d >= depth:
                            del stack[d]
                    stack[depth] = node
        if not roots:
            return None
        if len(roots) > 1:
            summary.warnings.append(
                "org-chart marker: multiple roots in list — taking first"
            )
        return (
            {"type": "org-chart", "id": _new_id(), "root": roots[0]},
            1,
        )

    if ttype == "table":
        headers = target.get("headers") or []
        rows = target.get("rows") or []
        headers_lc = [str(h).strip().lower() for h in headers]

        def _col(*names: str) -> int | None:
            for n in names:
                try:
                    return headers_lc.index(n)
                except ValueError:
                    continue
            return None

        name_i = _col("name", "이름")
        parent_i = _col("parent", "상위", "부모")
        if name_i is None or parent_i is None:
            return None

        nodes: dict[str, dict[str, Any]] = {}
        order: list[str] = []
        parents: dict[str, str] = {}
        for row in rows:
            cells = list(row) if isinstance(row, list) else []
            if name_i >= len(cells):
                continue
            name = str(cells[name_i] or "").strip()
            if not name or name in nodes:
                continue
            parent = (
                str(cells[parent_i] or "").strip()
                if parent_i < len(cells)
                else ""
            )
            nodes[name] = {"id": _new_id(), "label": name}
            order.append(name)
            parents[name] = parent

        if not nodes:
            return None

        roots_t: list[dict[str, Any]] = []
        for name in order:
            p = parents[name]
            if p and p in nodes:
                nodes[p].setdefault("children", []).append(nodes[name])
            else:
                roots_t.append(nodes[name])

        if not roots_t:
            return None
        if len(roots_t) > 1:
            summary.warnings.append(
                "org-chart marker: multiple roots in table — taking first"
            )
        return (
            {"type": "org-chart", "id": _new_id(), "root": roots_t[0]},
            1,
        )

    return None


def _paragraph_text(targets: list[dict[str, Any]]) -> str | None:
    """Return stripped text of the first paragraph target, or None if the
    target is missing / not a paragraph / empty."""
    if not targets:
        return None
    target = targets[0]
    if target.get("type") != "paragraph":
        return None
    text = str(target.get("text") or "").strip()
    return text or None


def _convert_iframe(
    _variant: str | None,
    targets: list[dict[str, Any]],
    _summary: _SummaryLike,
) -> tuple[dict[str, Any], int] | None:
    """``Widget: iframe`` + URL 단락 → IframeBlock.

    URL 은 ``http://`` / ``https://`` 만 허용. 아니면 변환 실패 (정보 손실 0).
    """
    url = _paragraph_text(targets)
    if not url:
        return None
    if not (url.startswith("http://") or url.startswith("https://")):
        return None
    return (
        {
            "type": "iframe",
            "id": _new_id(),
            "src": url,
        },
        1,
    )


def _convert_video(
    _variant: str | None,
    targets: list[dict[str, Any]],
    _summary: _SummaryLike,
) -> tuple[dict[str, Any], int] | None:
    """``Widget: video`` + URL 단락 → VideoBlock.

    Provider 자동 감지: youtube/youtu.be → ``youtube``, vimeo.com → ``vimeo``,
    그 외 → ``intra``. URL 은 http(s) 만 허용.
    """
    url = _paragraph_text(targets)
    if not url:
        return None
    if not (url.startswith("http://") or url.startswith("https://")):
        return None
    host = (urlparse(url).hostname or "").lower()
    if "youtube.com" in host or "youtu.be" in host:
        provider = "youtube"
    elif "vimeo.com" in host:
        provider = "vimeo"
    else:
        provider = "intra"
    return (
        {
            "type": "video",
            "id": _new_id(),
            "url": url,
            "provider": provider,
        },
        1,
    )


def _convert_file(
    _variant: str | None,
    targets: list[dict[str, Any]],
    summary: _SummaryLike,
) -> tuple[dict[str, Any], int] | None:
    """``Widget: file`` + 파일명 단락 → FileBlock.

    Import 시점엔 실제 파일이 없으므로 ``fileId`` 는 placeholder ULID 로
    채우고 warnings 에 기록. 사후 수동 연결 필요.
    """
    name = _paragraph_text(targets)
    if not name:
        return None
    summary.warnings.append(
        f"file marker '{name}': placeholder fileId emitted (no real file linked at import)"
    )
    return (
        {
            "type": "file",
            "id": _new_id(),
            "fileId": _new_id(),
            "name": name,
        },
        1,
    )


def _convert_pdf(
    _variant: str | None,
    targets: list[dict[str, Any]],
    summary: _SummaryLike,
) -> tuple[dict[str, Any], int] | None:
    """``Widget: pdf`` + URL/파일명 단락 → PdfBlock.

    Schema 의 FK 필드는 ``file_id`` (snake_case). FileBlock 의 ``fileId``
    (camelCase) 와 다름. Import 시점엔 실제 파일이 없으므로 placeholder ULID.
    """
    title = _paragraph_text(targets)
    if not title:
        return None
    summary.warnings.append(
        f"pdf marker '{title}': placeholder file_id emitted (no real file linked at import)"
    )
    return (
        {
            "type": "pdf",
            "id": _new_id(),
            "file_id": _new_id(),
            "title": title,
        },
        1,
    )


def _convert_whiteboard(
    _variant: str | None,
    _targets: list[dict[str, Any]],
    summary: _SummaryLike,
) -> tuple[dict[str, Any], int] | None:
    """``Widget: whiteboard`` — 항상 변환 실패.

    Whiteboard 는 strokes/shapes/text 의 vector 표현인데 docx/pptx 에선
    이를 표현할 수가 없다 (이미지로 평탄화되거나 누락). 충실한 round-trip 이
    불가하므로 변환을 시도하지 않고, marker + 원본 target (보통 이미지) 모두
    보존하는 정보 손실 0 경로로 위임한다.
    """
    summary.warnings.append(
        "whiteboard marker: docx/pptx cannot express whiteboard strokes; "
        "original image preserved"
    )
    return None


_COLUMNS_SIMPLE_TYPES = {"paragraph", "image", "list", "table"}


def _convert_columns(
    variant: str | None,
    targets: list[dict[str, Any]],
    _summary: _SummaryLike,
) -> tuple[dict[str, Any], int] | None:
    """``Widget: columns`` 또는 ``Widget: columns (2|3|4)`` + N 개의 단순 블록 → ColumnsBlock.

    "단순 블록" = paragraph / image / list / table. 다른 위젯 블록을 만나면
    그 자리에서 수집을 멈춘다. 실제 수집된 개수가 2 미만이면 None (schema
    minItems=2). 각 컬럼은 single-element array.
    """
    v = (variant or "").strip()
    if v in {"2", "3", "4"}:
        n = int(v)
    else:
        n = 2

    collected: list[dict[str, Any]] = []
    for t in targets:
        if t.get("type") not in _COLUMNS_SIMPLE_TYPES:
            break
        collected.append(t)
        if len(collected) >= n:
            break

    if len(collected) < 2:
        return None

    return (
        {
            "type": "columns",
            "id": _new_id(),
            "columns": [[blk] for blk in collected],
        },
        len(collected),
    )


def _convert_tabs(
    _variant: str | None,
    targets: list[dict[str, Any]],
    _summary: _SummaryLike,
) -> tuple[dict[str, Any], int] | None:
    """``Widget: tabs`` + heading-4 들에 의해 구분된 블록 시퀀스 → TabsBlock.

    Multi-block consumer. 각 ``heading-4`` 가 새 탭을 열고 그 heading 의 텍스트가
    ``label`` 이 된다. 다음 heading-4 (또는 다음 widget marker) 전까지의 비-heading
    블록들이 현재 탭의 ``blocks`` 로 쌓인다. 첫 target 이 heading-4 이 아니면 None
    (정보 손실 0 룰). 다음 widget marker 단락을 만나면 거기서 멈춰 dispatcher 가
    다음 위젯을 별도로 처리할 수 있게 한다.

    Heading 텍스트는 schema 의 ``title`` 필드를 우선, ``text`` 도 fallback.
    """
    if not targets:
        return None
    if targets[0].get("type") != "heading-4":
        return None

    tabs: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    n_consumed = 0
    for t in targets:
        ttype = t.get("type")
        if ttype == "paragraph":
            text = str(t.get("text") or "")
            if parse_marker(text) is not None:
                break
        if ttype == "heading-4":
            label = str(t.get("title") or t.get("text") or "")
            current = {"label": label, "blocks": []}
            tabs.append(current)
        else:
            if current is None:
                break
            current["blocks"].append(t)
        n_consumed += 1

    if not tabs:
        return None
    return (
        {
            "type": "tabs",
            "id": _new_id(),
            "tabs": tabs,
        },
        n_consumed,
    )


def _convert_accordion(
    _variant: str | None,
    targets: list[dict[str, Any]],
    _summary: _SummaryLike,
) -> tuple[dict[str, Any], int] | None:
    """``Widget: accordion`` + heading-4 로 구분된 블록 시퀀스 → AccordionBlock.

    Tabs 와 동일한 multi-block 패턴이나 emit 하는 필드명이 다르다 — AccordionBlock
    은 ``items`` (tabs 의 ``tabs`` 가 아님). 각 heading-4 가 새 item 을 열고
    label 로 들어가며, 다음 heading-4 (또는 widget marker 단락) 전까지의 비-heading
    블록들이 현재 item 의 ``blocks`` 로 쌓인다.
    """
    if not targets:
        return None
    if targets[0].get("type") != "heading-4":
        return None

    items: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    n_consumed = 0
    for t in targets:
        ttype = t.get("type")
        if ttype == "paragraph":
            text = str(t.get("text") or "")
            if parse_marker(text) is not None:
                break
        if ttype == "heading-4":
            label = str(t.get("title") or t.get("text") or "")
            current = {"label": label, "blocks": []}
            items.append(current)
        else:
            if current is None:
                break
            current["blocks"].append(t)
        n_consumed += 1

    if not items:
        return None
    return (
        {
            "type": "accordion",
            "id": _new_id(),
            "items": items,
        },
        n_consumed,
    )


# ── Dispatcher ───────────────────────────────────────────────────────

# Converter signature: (variant, targets_lookahead, summary) -> (widget, n_consumed) or None
# Phase 2: ``targets`` is a list (slice of all post-marker blocks); converter
# returns how many it actually consumed. n_consumed=1 mimics Phase 1 behaviour.
ConverterResult = tuple[dict[str, Any], int]
ConverterFn = Callable[
    [str | None, list[dict[str, Any]], _SummaryLike],
    ConverterResult | None,
]

WIDGET_CONVERTERS: dict[str, ConverterFn | None] = {
    # ── Phase 1 ─────────────────────────────────────────────────────────
    "callout": _convert_callout,
    "kpi-cards": _convert_kpi_cards,
    # ── Phase 2 (Wave A — single-target widgets) ────────────────────────
    "chart": _convert_chart,
    "gantt": _convert_gantt,
    "flow": _convert_flow,
    "org-chart": _convert_org_chart,
    "doc-link": _convert_doc_link,
    "glossary": _convert_glossary,
    "image-annotation": _convert_image_annotation,
    "iframe": _convert_iframe,
    "video": _convert_video,
    "file": _convert_file,
    "pdf": _convert_pdf,
    "whiteboard": _convert_whiteboard,
    # ── Phase 2 (Wave B — multi-target widgets) ─────────────────────────
    "columns": _convert_columns,
    "tabs": _convert_tabs,
    "accordion": _convert_accordion,
    "gallery": _convert_gallery,
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
                "(recognised but not converted)"
            )
            # Drop the marker paragraph; keep the target block as-is.
            i += 1
            continue
        if i + 1 >= len(blocks):
            # Marker with no following block — drop the marker silently.
            i += 1
            continue
        targets = blocks[i + 1 :]
        result = converter(variant, targets, summary)
        if result is None:
            # Conversion failed — keep both marker + first target intact
            # to avoid info loss. (Subsequent blocks are unaffected.)
            out.append(block)
            i += 1
            continue
        widget, n_consumed = result
        if n_consumed < 1:
            # Defensive: a converter that returns a widget must consume at
            # least the first target. Treat as conversion failure.
            out.append(block)
            i += 1
            continue
        out.append(widget)
        i += 1 + n_consumed
    # Mutate the original list in place so callers can keep their reference.
    blocks.clear()
    blocks.extend(out)
