"""DocumentJSON v1.0 → GitHub-Flavoured Markdown 출력.

PDF 와 달리 Markdown 은 git 커밋/포터빌리티 용도이므로
- 외부 의존성 없음 (pure stdlib).
- 의미를 잃을 가능성이 있는 블록 (chart/gantt/flow/dashboard 등) 은
  fenced code block 또는 텍스트 요약으로 보존한다.
- 위키 링크 `[[slug]]` / `[[slug|label]]` 은 `[label](/docs/slug)` 로 변환.

`render_markdown(doc, *, include_metadata=True) -> str` 만 노출. 부수효과 없음.
"""
from __future__ import annotations

from typing import Any


# ── Public entry ─────────────────────────────────────────────────────


def render_markdown(doc: dict[str, Any], *, include_metadata: bool = True) -> str:
    """DocumentJSON dict 를 GFM 문자열로 렌더한다.

    Args:
        doc: DocumentJSON v1.0 dict.
        include_metadata: front-matter / 메타블록을 헤더로 포함할지.

    Returns:
        UTF-8 markdown 문자열. 끝에 trailing newline 1개.
    """
    title = _str(doc.get("title")) or "Untitled"
    summary = _str(doc.get("summary"))
    metadata = doc.get("metadata") or {}
    sections = doc.get("sections") or []

    parts: list[str] = []

    # H1 = doc title.
    parts.append(f"# {title}")

    if summary:
        parts.append(summary)

    if include_metadata:
        meta_block = _render_meta_block(doc, metadata)
        if meta_block:
            parts.append(meta_block)

    if doc.get("infobox"):
        parts.append(_render_infobox(doc["infobox"]))

    for section in sections:
        parts.append(_render_section(section))

    if doc.get("references"):
        parts.append(_render_references(doc["references"]))
    if doc.get("glossary"):
        parts.append(_render_glossary(doc["glossary"]))

    # join blocks with blank lines
    return "\n\n".join(p for p in parts if p) + "\n"


# ── Metadata / infobox ───────────────────────────────────────────────


def _render_meta_block(doc: dict[str, Any], metadata: dict[str, Any]) -> str:
    """문서 헤더 정보 (slug/division/team/...) 를 markdown table 로."""
    rows: list[tuple[str, str]] = []
    slug = _str(doc.get("slug"))
    if slug:
        rows.append(("slug", f"`{slug}`"))
    for key in ("division", "team", "group", "part", "category", "confidentiality"):
        v = metadata.get(key)
        if v:
            rows.append((key, _str(v)))
    owners = metadata.get("owners") or []
    if owners:
        rows.append(("owners", ", ".join(_str(o) for o in owners)))
    tags = metadata.get("tags") or []
    if tags:
        rows.append(("tags", ", ".join(f"`{_str(t)}`" for t in tags)))
    if not rows:
        return ""
    out = ["| 항목 | 값 |", "| --- | --- |"]
    for k, v in rows:
        out.append(f"| {k} | {_escape_table_cell(v)} |")
    return "\n".join(out)


def _render_infobox(infobox: dict[str, Any]) -> str:
    if not infobox:
        return ""
    out = ["| 항목 | 값 |", "| --- | --- |"]
    for k, v in infobox.items():
        if isinstance(v, list):
            value = ", ".join(_str(x) for x in v)
        else:
            value = _str(v)
        out.append(f"| {_escape_table_cell(_str(k))} | {_escape_table_cell(value)} |")
    return "\n".join(out)


# ── Section + block rendering ────────────────────────────────────────


def _render_section(section: dict[str, Any], depth: int = 1) -> str:
    """level=1 → ##, level=2 → ###, level=3 → ####.

    DocumentJSON 의 level 은 1..3. h1 은 문서 title 전용.
    """
    level = int(section.get("level") or depth)
    hashes = "#" * min(max(level + 1, 2), 6)
    number = _str(section.get("number"))
    title = _str(section.get("title"))
    heading = (
        f"{hashes} {number} {title}".strip()
        if number
        else f"{hashes} {title}".strip()
    )

    parts: list[str] = [heading]
    for b in section.get("blocks") or []:
        rendered = _render_block(b)
        if rendered:
            parts.append(rendered)
    for sub in section.get("subsections") or []:
        parts.append(_render_section(sub, depth=depth + 1))
    return "\n\n".join(p for p in parts if p)


def _render_block(block: dict[str, Any]) -> str:
    btype = _str(block.get("type"))
    handler = _BLOCK_HANDLERS.get(btype)
    rendered: str
    if handler is None:
        rendered = f"<!-- 알 수 없는 블록 타입: {btype} -->"
    else:
        try:
            rendered = handler(block)
        except Exception as e:  # pragma: no cover — defensive
            rendered = f"<!-- 블록 렌더 실패: {btype} — {e} -->"

    # `meta.note === 'page-break-before'` => visual separator in markdown.
    meta = block.get("meta") or {}
    if isinstance(meta, dict) and meta.get("note") == "page-break-before":
        if btype == "paragraph" and not _str(block.get("text")):
            return "---"
        return f"---\n\n{rendered}"
    return rendered


# ── Per-block handlers ──────────────────────────────────────────────


def _b_paragraph(block: dict[str, Any]) -> str:
    text = _str(block.get("text"))
    return _convert_inline(text)


def _b_heading_4(block: dict[str, Any]) -> str:
    """`heading-4` block — supports meta.level for visual depth.

    Default: ##### (level 4 inside the doc tree). meta.level∈{2,3,4} bumps it.
    """
    title = _str(block.get("title"))
    meta = block.get("meta") or {}
    level = 4
    if isinstance(meta, dict):
        ml = meta.get("level")
        if ml in (2, 3, 4):
            level = int(ml)
    hashes = "#" * (level + 1)
    return f"{hashes} {title}".strip()


def _b_list(block: dict[str, Any]) -> str:
    style = _str(block.get("style")) or "bullet"
    items = block.get("items") or []
    out: list[str] = []
    for idx, item in enumerate(items, start=1):
        # items can be str OR {text, depth} (legacy nested-list editor shape).
        if isinstance(item, dict):
            text = _str(item.get("text"))
            depth = int(item.get("depth") or 0)
        else:
            text = _str(item)
            depth = 0
        indent = "  " * max(depth, 0)
        if style == "number":
            out.append(f"{indent}{idx}. {_convert_inline(text)}")
        elif style == "check":
            out.append(f"{indent}- [ ] {_convert_inline(text)}")
        else:
            out.append(f"{indent}- {_convert_inline(text)}")
    return "\n".join(out)


def _b_quote(block: dict[str, Any]) -> str:
    text = _str(block.get("text"))
    cite = _str(block.get("cite"))
    lines = [f"> {ln}" if ln else ">" for ln in text.splitlines() or [""]]
    if cite:
        lines.append(f"> — {cite}")
    return "\n".join(lines)


def _b_callout(block: dict[str, Any]) -> str:
    """Render callouts as fenced code blocks with custom info-string.

    Convention: ` ```callout:warn ` then optional title + body. Editors that
    don't recognise the lang treat it as a code block. Pandoc-flavoured
    `> [!WARN]` admonitions are also widely understood, so we emit both:
    blockquote with admonition tag is the primary form.
    """
    variant = _str(block.get("variant")) or "info"
    title = _str(block.get("title"))
    text = _str(block.get("text"))
    tag = variant.upper()
    lines = [f"> [!{tag}]"]
    if title:
        lines.append(f"> **{title}**")
    for ln in text.splitlines() or [""]:
        lines.append(f"> {ln}" if ln else ">")
    return "\n".join(lines)


def _b_code(block: dict[str, Any]) -> str:
    language = _str(block.get("language")) or ""
    code = _str(block.get("code"))
    filename = _str(block.get("filename"))
    fence = "```"
    # Bump fence length if code body contains a triple-backtick already.
    while fence in code:
        fence += "`"
    header = f"{fence}{language}"
    out = [header]
    if filename:
        out.insert(0, f"_{filename}_")
        out.insert(1, "")
    out.append(code)
    out.append(fence)
    return "\n".join(out)


def _b_math(block: dict[str, Any]) -> str:
    expr = _str(block.get("expression"))
    display = _str(block.get("display")) or "block"
    if display == "inline":
        return f"${expr}$"
    return f"$$\n{expr}\n$$"


def _b_table(block: dict[str, Any]) -> str:
    headers = block.get("headers") or []
    rows = block.get("rows") or []
    if not headers and not rows:
        return ""
    if not headers:
        # Anonymous columns — best-effort GFM still requires a header row.
        cols = max((len(r) for r in rows), default=0)
        headers = [""] * cols
    head_line = "| " + " | ".join(_escape_table_cell(_str(h)) for h in headers) + " |"
    sep_line = "| " + " | ".join("---" for _ in headers) + " |"
    body_lines = []
    for r in rows:
        cells = [_escape_table_cell(_convert_inline(_str(c))) for c in r]
        # pad short rows to header length
        while len(cells) < len(headers):
            cells.append("")
        body_lines.append("| " + " | ".join(cells) + " |")
    return "\n".join([head_line, sep_line, *body_lines])


def _b_kpi_cards(block: dict[str, Any]) -> str:
    items = block.get("items") or []
    if not items:
        return ""
    lines = ["| 지표 | 값 | 변화 |", "| --- | --- | --- |"]
    for it in items:
        label = _str(it.get("label"))
        value = _str(it.get("value"))
        delta = _str(it.get("delta"))
        trend = _str(it.get("trend"))
        delta_cell = f"{delta} ({trend})" if delta and trend else delta or trend
        lines.append(
            f"| {_escape_table_cell(label)} | {_escape_table_cell(value)} | "
            f"{_escape_table_cell(delta_cell)} |"
        )
    return "\n".join(lines)


def _b_chart(block: dict[str, Any]) -> str:
    """Charts → underlying data as a GFM table + caption."""
    title = _str(block.get("title"))
    data = block.get("data") or {}
    labels = data.get("labels") or []
    series = data.get("series") or []
    parts: list[str] = []
    if title:
        parts.append(f"**{title}**")
    if not labels and not series:
        parts.append("> 📊 차트 (편집기에서 보기)")
        return "\n\n".join(parts)
    # First column = series name, then labels.
    headers = ["계열", *[_str(label) for label in labels]]
    head_line = "| " + " | ".join(_escape_table_cell(h) for h in headers) + " |"
    sep_line = "| " + " | ".join("---" for _ in headers) + " |"
    body_lines = []
    for sd in series:
        name = _str(sd.get("name"))
        values = sd.get("values") or []
        cells = [name, *[_str(v) for v in values]]
        while len(cells) < len(headers):
            cells.append("")
        body_lines.append("| " + " | ".join(_escape_table_cell(c) for c in cells) + " |")
    parts.append("\n".join([head_line, sep_line, *body_lines]))
    return "\n\n".join(parts)


def _b_gantt(block: dict[str, Any]) -> str:
    """Gantt → mermaid fenced block (renders in GitHub & most viewers)."""
    tasks = block.get("tasks") or []
    if not tasks:
        return "> 📊 Gantt (편집기에서 보기)"
    lines = ["```mermaid", "gantt", "    dateFormat YYYY-MM-DD", "    title 일정"]
    for t in tasks:
        name = _str(t.get("name")) or "task"
        start = _str(t.get("start")) or "2025-01-01"
        end = _str(t.get("end")) or start
        lines.append(f"    {name} :{start}, {end}")
    lines.append("```")
    return "\n".join(lines)


def _b_flow(block: dict[str, Any]) -> str:
    engine = _str(block.get("engine")) or "mermaid"
    source = _str(block.get("source"))
    lang = "mermaid" if engine == "mermaid" else engine
    return f"```{lang}\n{source}\n```"


def _b_org_chart(block: dict[str, Any]) -> str:
    root = block.get("root") or {}

    def render_node(node: dict[str, Any], depth: int = 0) -> list[str]:
        indent = "  " * depth
        label = _str(node.get("label"))
        role = _str(node.get("role"))
        suffix = f" — {role}" if role else ""
        out = [f"{indent}- {label}{suffix}"]
        for child in node.get("children") or []:
            out.extend(render_node(child, depth + 1))
        return out

    lines = render_node(root)
    return "\n".join(lines)


def _b_iframe(block: dict[str, Any]) -> str:
    src = _str(block.get("src"))
    title = _str(block.get("title")) or src
    return f"[{title}]({src})"


def _b_video(block: dict[str, Any]) -> str:
    url = _str(block.get("url"))
    title = _str(block.get("title")) or url
    return f"🎬 [{title}]({url})"


def _b_image(block: dict[str, Any]) -> str:
    image_id = _str(block.get("imageId") or block.get("image_id"))
    caption = _str(block.get("caption"))
    alt = _str(block.get("alt")) or caption or image_id
    href = f"/api/v1/images/{image_id}"
    out = f"![{alt}]({href})"
    if caption:
        out += f"\n\n_{caption}_"
    return out


def _b_gallery(block: dict[str, Any]) -> str:
    items = block.get("items") or []
    parts: list[str] = []
    for it in items:
        image_id = _str(it.get("imageId") or it.get("image_id"))
        caption = _str(it.get("caption"))
        alt = _str(it.get("alt")) or caption or image_id
        parts.append(f"![{alt}](/api/v1/images/{image_id})")
        if caption:
            parts.append(f"_{caption}_")
    return "\n\n".join(parts)


def _b_file(block: dict[str, Any]) -> str:
    file_id = _str(block.get("fileId") or block.get("file_id"))
    name = _str(block.get("name")) or file_id or "file"
    return f"[{name}](/api/v1/files/{file_id}/download)"


def _b_doc_link_card(block: dict[str, Any]) -> str:
    slug = _str(block.get("slug"))
    title = _str(block.get("title")) or slug
    return f"[{title}](/docs/{slug})"


def _b_glossary_ref(block: dict[str, Any]) -> str:
    term = _str(block.get("term"))
    return f"_{term}_"


def _b_columns(block: dict[str, Any]) -> str:
    """Markdown lacks columns — flatten to sequential blocks separated by hr."""
    columns = block.get("columns") or []
    cols_out: list[str] = []
    for col in columns:
        rendered = "\n\n".join(
            _render_block(b) for b in col if _render_block(b)
        )
        if rendered:
            cols_out.append(rendered)
    return "\n\n".join(cols_out)


def _b_tabs(block: dict[str, Any]) -> str:
    tabs = block.get("tabs") or []
    parts: list[str] = []
    for tab in tabs:
        label = _str(tab.get("label"))
        inner_blocks = tab.get("blocks") or []
        inner = "\n\n".join(_render_block(b) for b in inner_blocks if _render_block(b))
        parts.append(f"<details><summary>{label}</summary>\n\n{inner}\n\n</details>")
    return "\n\n".join(parts)


def _b_accordion(block: dict[str, Any]) -> str:
    items = block.get("items") or []
    parts: list[str] = []
    for it in items:
        label = _str(it.get("label"))
        inner_blocks = it.get("blocks") or []
        inner = "\n\n".join(_render_block(b) for b in inner_blocks if _render_block(b))
        parts.append(f"<details><summary>{label}</summary>\n\n{inner}\n\n</details>")
    return "\n\n".join(parts)


def _b_data_source(block: dict[str, Any]) -> str:
    endpoint = _str(block.get("endpoint"))
    render = _str(block.get("render"))
    return (
        "| 데이터 소스 | 값 |\n"
        "| --- | --- |\n"
        f"| endpoint | `{endpoint}` |\n"
        f"| render | {render} |\n"
        "\n_정적 markdown — 실시간 데이터 미반영_"
    )


def _b_dashboard_embed(block: dict[str, Any]) -> str:
    provider = _str(block.get("provider"))
    panel = _str(block.get("panelId") or block.get("panel_id"))
    return (
        "| 대시보드 | 값 |\n"
        "| --- | --- |\n"
        f"| provider | {provider} |\n"
        f"| panel | {panel} |\n"
        "\n_정적 markdown — 패널 미렌더_"
    )


def _b_calculator(block: dict[str, Any]) -> str:
    label = _str(block.get("label"))
    formula = _str(block.get("formula"))
    inputs = block.get("inputs") or []
    parts: list[str] = []
    if label:
        parts.append(f"**{label}**")
    if formula:
        parts.append(f"수식: `{formula}`")
    if inputs:
        lines = ["| 입력 | 기본값 |", "| --- | --- |"]
        for i in inputs:
            lines.append(
                f"| {_escape_table_cell(_str(i.get('label')))} | "
                f"{_escape_table_cell(_str(i.get('default', '')))} |"
            )
        parts.append("\n".join(lines))
    parts.append("_계산기 — 정적 export, 입력값은 기본값만 표시_")
    return "\n\n".join(parts)


_BLOCK_HANDLERS: dict[str, Any] = {
    "paragraph": _b_paragraph,
    "heading-4": _b_heading_4,
    "list": _b_list,
    "quote": _b_quote,
    "callout": _b_callout,
    "code": _b_code,
    "math": _b_math,
    "table": _b_table,
    "kpi-cards": _b_kpi_cards,
    "chart": _b_chart,
    "gantt": _b_gantt,
    "flow": _b_flow,
    "org-chart": _b_org_chart,
    "iframe": _b_iframe,
    "video": _b_video,
    "image": _b_image,
    "gallery": _b_gallery,
    "file": _b_file,
    "doc-link-card": _b_doc_link_card,
    "glossary-ref": _b_glossary_ref,
    "columns": _b_columns,
    "tabs": _b_tabs,
    "accordion": _b_accordion,
    "data-source": _b_data_source,
    "dashboard-embed": _b_dashboard_embed,
    "calculator": _b_calculator,
}


# ── Trailing sections ────────────────────────────────────────────────


def _render_references(refs: list[dict[str, Any]]) -> str:
    out = ["## 참고문헌", ""]
    for i, r in enumerate(refs, start=1):
        label = _str(r.get("label"))
        url = _str(r.get("url"))
        if url:
            out.append(f"{i}. [{label}]({url})")
        else:
            out.append(f"{i}. {label}")
    return "\n".join(out)


def _render_glossary(glossary: list[dict[str, Any]]) -> str:
    out = ["## 용어"]
    for g in glossary:
        term = _str(g.get("term"))
        definition = _str(g.get("definition"))
        out.append(f"- **{term}**: {definition}")
    return "\n".join(out)


# ── Helpers ──────────────────────────────────────────────────────────


def _str(v: Any) -> str:
    if v is None:
        return ""
    if isinstance(v, bool):
        return "true" if v else "false"
    return str(v)


def _escape_table_cell(s: str) -> str:
    """GFM table cell — pipes must be escaped, newlines collapsed to <br>."""
    return s.replace("|", "\\|").replace("\n", " <br> ")


def _convert_inline(text: str) -> str:
    """Convert wiki links `[[slug]]` / `[[slug|label]]` to markdown links.

    Footnote markers (`[^N]`) and inline markdown emphasis pass through
    unchanged — they're already markdown-compatible.
    """
    if not text:
        return ""
    out: list[str] = []
    i = 0
    n = len(text)
    while i < n:
        start = text.find("[[", i)
        if start < 0:
            out.append(text[i:])
            break
        out.append(text[i:start])
        end = text.find("]]", start + 2)
        if end < 0:
            out.append(text[start:])
            break
        inner = text[start + 2 : end]
        if "|" in inner:
            slug, _, label = inner.partition("|")
        else:
            slug = inner
            label = inner
        slug = slug.strip()
        label = label.strip()
        # Anchor-only links like `[[#section-1.1|타이틀]]` keep the hash as-is.
        href = slug if slug.startswith("#") else f"/docs/{slug}"
        out.append(f"[{label}]({href})")
        i = end + 2
    return "".join(out)
