"""DocumentJSON v1.0 → 자체 완비형(self-contained) HTML 출력.

Cycle 14 — 나무위키 스타일 HTML export 의 BE 렌더러.

특징
----
- 외부 CSS/JS 없이 단일 파일로 떨어진다 (KaTeX/Mermaid 는 opt-in CDN).
- DocumentJSON 26개 Block 타입을 모두 처리한다 (data-source / dashboard-embed
  / calculator 처럼 런타임 렌더가 필요한 것들은 정적 fallback 으로 표시).
- Recharts/Excalidraw 처럼 클라이언트 렌더가 필수인 경우 → `<table>` 또는
  `<pre>` 로 데이터를 보존한다 (인쇄/오프라인에서도 의미 유지).
- 이미지: 기본은 절대 URL (MINIO_PUBLIC_ENDPOINT). `inline_images=True` 일 때
  base64 인라인 — 사이즈가 폭증하므로 호출자가 명시적으로 켜야 한다.

I/O
----
`render_namuwiki_html(doc, *, options) -> str` 만 노출. 부수효과 없음 — 테스트
하기 쉽다.

`doc` 은 DocumentJSON v1.0 dict 본문 (server-side renumber 후 형태).
`options.title` 가 없으면 `doc["title"]` 을 사용한다.
"""
from __future__ import annotations

import base64
import html
from dataclasses import dataclass, field
from typing import Any

from app.services.css_sanitizer import sanitize_css
from app.services.variables import walk_doc_substitute


# ── Options ──────────────────────────────────────────────────────────


@dataclass
class RenderOptions:
    """렌더링 토글.

    - `inline_images`: 이미지 src 를 base64 data URL 로 임베드 (기본 False).
    - `katex_cdn`: math 블록을 KaTeX CDN 으로 렌더 (기본 False — raw LaTeX).
    - `mermaid_cdn`: flow(mermaid) 블록을 mermaid CDN 으로 렌더 (기본 False).
    - `image_resolver`: 함수(image_id) → {url, alt?, width?, height?, mime?}.
       endpoint 가 DB 를 거쳐 주입한다. None 이면 alt/caption 만 살린다.
    - `lang`: <html lang=…> 속성 값.
    - `oembed_base_url`: 지정하면 head 에 ``<link rel="alternate" type=
      "application/json+oembed" …>`` 태그를 삽입한다. Slack/Notion 등 외부
      툴이 export 된 HTML 을 가져갔을 때 oEmbed 엔드포인트를 자동 발견할 수
      있도록. None 이면 태그를 추가하지 않는다.
    """

    inline_images: bool = False
    katex_cdn: bool = False
    mermaid_cdn: bool = False
    image_resolver: Any = None  # Callable[[str], dict | None] | None
    lang: str = "ko"
    oembed_base_url: str | None = None


# ── Public entry ─────────────────────────────────────────────────────


def render_namuwiki_html(
    doc: dict[str, Any],
    *,
    options: RenderOptions | None = None,
    requester_role: str | None = None,
) -> str:
    """DocumentJSON dict 를 단일 HTML 문서로 렌더한다.

    Args:
        doc: DocumentJSON v1.0 dict (validated).
        options: 렌더 옵션. None 이면 기본값.
        requester_role: 호출자 role. 지정 시 admin 미만은 meta.permission 이
            높은 블록을 redact 한 결과를 렌더한다. None 이면 scrub 미적용.

    Returns:
        UTF-8 HTML 문자열 (DOCTYPE 포함).
    """
    opts = options or RenderOptions()
    ctx = _Ctx(opts=opts, used_katex=False, used_mermaid=False)

    if requester_role is not None:
        from .document_service import scrub_for_response

        doc = scrub_for_response(doc, role=requester_role)
    # Resolve `{{var}}` tokens up front. Code blocks are skipped inside the
    # helper (matches the FE rule: no substitution inside <pre><code>).
    doc = walk_doc_substitute(doc, doc.get("variables"))

    title = _str(doc.get("title")) or "Untitled"
    summary = _str(doc.get("summary"))
    metadata = doc.get("metadata") or {}
    sections = doc.get("sections") or []

    body_parts: list[str] = []
    body_parts.append(_render_header(doc, title, summary, metadata))
    if doc.get("infobox"):
        body_parts.append(_render_infobox(doc["infobox"]))
    body_parts.append(_render_toc(sections))

    for section in sections:
        body_parts.append(_render_section(section, ctx))

    if doc.get("references"):
        body_parts.append(_render_references(doc["references"]))
    if doc.get("glossary"):
        body_parts.append(_render_glossary(doc["glossary"]))

    head_extras: list[str] = []
    if opts.katex_cdn and ctx.used_katex:
        head_extras.append(_KATEX_CDN_LINK)
    if opts.mermaid_cdn and ctx.used_mermaid:
        head_extras.append(_MERMAID_CDN_SCRIPT)
    # oEmbed auto-discovery — Slack/Notion/Discord/Teams/Linear scrape the
    # head when a wiki URL is pasted; this <link> lets them locate the
    # oEmbed endpoint without baking knowledge of our URL scheme.
    if opts.oembed_base_url:
        slug_for_oembed = _str(doc.get("slug"))
        if slug_for_oembed:
            base = opts.oembed_base_url.rstrip("/")
            href = f"{base}/api/v1/oembed?url={base}/docs/{slug_for_oembed}"
            head_extras.append(
                f'<link rel="alternate" type="application/json+oembed" '
                f'href="{html.escape(href)}" '
                f'title="MX White Paper oEmbed">'
            )
    # Per-doc admin-supplied CSS. Already sanitized by the PATCH endpoint
    # before persistence, but we re-run the scrub here defensively (e.g.
    # imports/restores might bypass the API). NOT scoped — leaks into the
    # whole rendered page. Document warning + admin-only role limit blast
    # radius. Escaping `</style>` defends against attribute-style breakouts.
    raw_custom_css = _str(doc.get("custom_css"))
    if raw_custom_css:
        safe_css, _warnings = sanitize_css(raw_custom_css)
        if safe_css:
            safe_css = safe_css.replace("</style>", "<\\/style>")
            head_extras.append(f"<style data-mxwp-custom-css=\"1\">{safe_css}</style>")

    return _HTML_TEMPLATE.format(
        lang=html.escape(opts.lang),
        title=html.escape(title),
        styles=_INLINE_CSS,
        head_extras="\n".join(head_extras),
        body="\n".join(body_parts),
    )


# ── Internal rendering context ───────────────────────────────────────


@dataclass
class _Ctx:
    opts: RenderOptions
    used_katex: bool = False
    used_mermaid: bool = False
    notes: list[str] = field(default_factory=list)


# ── Header / metadata strip ──────────────────────────────────────────


def _render_header(
    doc: dict[str, Any],
    title: str,
    summary: str,
    metadata: dict[str, Any],
) -> str:
    path_parts = [
        metadata.get("division"),
        metadata.get("team"),
        metadata.get("group"),
        metadata.get("part"),
    ]
    path = " / ".join(p for p in path_parts if p)
    confidentiality = _str(metadata.get("confidentiality"))
    tags = metadata.get("tags") or []

    pieces: list[str] = ['<header class="doc-header">']
    pieces.append(
        f'<div class="doc-slug">/{html.escape(_str(doc.get("slug")))}</div>'
    )
    pieces.append(f"<h1 class=\"doc-title\">{html.escape(title)}</h1>")
    if summary:
        pieces.append(f'<p class="doc-summary">{html.escape(summary)}</p>')
    pieces.append('<p class="doc-meta">')
    if path:
        pieces.append(f'<span class="meta-path">{html.escape(path)}</span>')
    if confidentiality:
        pieces.append(
            f'<span class="badge badge-{html.escape(confidentiality)}">'
            f"{html.escape(confidentiality)}</span>"
        )
    if tags:
        pieces.append(
            "".join(
                f'<span class="badge badge-tag">#{html.escape(_str(t))}</span>'
                for t in tags
            )
        )
    pieces.append("</p>")
    pieces.append("</header>")
    return "".join(pieces)


def _render_infobox(infobox: dict[str, Any]) -> str:
    rows: list[str] = []
    for k, v in infobox.items():
        if isinstance(v, list):
            value_html = "<br>".join(html.escape(_str(x)) for x in v)
        else:
            value_html = html.escape(_str(v))
        rows.append(
            f"<tr><th>{html.escape(_str(k))}</th><td>{value_html}</td></tr>"
        )
    return (
        '<aside class="infobox"><table><tbody>'
        + "".join(rows)
        + "</tbody></table></aside>"
    )


def _render_toc(sections: list[dict[str, Any]]) -> str:
    """단순 ToC: level 1/2 만 나열, level 3 은 생략 (인쇄 친화)."""
    if not sections:
        return ""
    items: list[str] = []
    for s in sections:
        items.append(_toc_item(s))
        for sub in s.get("subsections") or []:
            items.append(_toc_item(sub, indent=1))
    return (
        '<nav class="toc"><h2 class="toc-title">목차</h2>'
        '<ol class="toc-list">'
        + "".join(items)
        + "</ol></nav>"
    )


def _toc_item(section: dict[str, Any], indent: int = 0) -> str:
    number = _str(section.get("number"))
    title = _str(section.get("title"))
    anchor = _section_anchor(section)
    return (
        f'<li class="toc-l{indent}">'
        f'<a href="#{html.escape(anchor)}">'
        f'<span class="toc-num">{html.escape(number)}</span>'
        f'<span class="toc-title-text">{html.escape(title)}</span>'
        f"</a></li>"
    )


def _section_anchor(section: dict[str, Any]) -> str:
    number = _str(section.get("number"))
    if number:
        return f"section-{number}"
    return f"section-{_str(section.get('id'))}"


# ── Section + Block rendering ────────────────────────────────────────


def _render_section(section: dict[str, Any], ctx: _Ctx) -> str:
    level = section.get("level", 1)
    # h1 = doc title; sections start at h2
    tag = {1: "h2", 2: "h3", 3: "h4"}.get(int(level), "h2")
    number = _str(section.get("number"))
    title = _str(section.get("title"))
    anchor = _section_anchor(section)
    blocks = section.get("blocks") or []
    subs = section.get("subsections") or []

    parts: list[str] = []
    parts.append(f'<section class="sec sec-l{level}">')
    parts.append(
        f'<{tag} id="{html.escape(anchor)}" class="sec-heading">'
        f'<span class="sec-num">{html.escape(number)}</span> '
        f'<span class="sec-title">{html.escape(title)}</span>'
        f"</{tag}>"
    )
    for b in blocks:
        parts.append(_render_block(b, ctx))
    for sub in subs:
        parts.append(_render_section(sub, ctx))
    parts.append("</section>")
    return "\n".join(parts)


def _render_block(block: dict[str, Any], ctx: _Ctx) -> str:
    btype = _str(block.get("type"))
    handler = _BLOCK_HANDLERS.get(btype)
    if handler is None:
        return (
            f'<div class="block block-unknown">[알 수 없는 블록: '
            f"{html.escape(btype)}]</div>"
        )
    try:
        rendered = handler(block, ctx)
    except Exception as e:  # pragma: no cover — defensive
        return (
            f'<div class="block block-error">[블록 렌더 실패: '
            f"{html.escape(btype)} — {html.escape(str(e))}]</div>"
        )
    # `meta.note === 'page-break-before'` => print/PDF page break before this
    # block. Used by the "페이지 나누기" palette item. Empty paragraph carriers
    # collapse to a zero-height div so they don't add visible whitespace.
    meta = block.get("meta") or {}
    if isinstance(meta, dict) and meta.get("note") == "page-break-before":
        if btype == "paragraph" and not _str(block.get("text")):
            return (
                '<div class="b-page-break" '
                'style="page-break-before: always; break-before: page; '
                'height: 0;"></div>'
            )
        return (
            '<div class="b-page-break" '
            'style="page-break-before: always; break-before: page;">'
            f"{rendered}</div>"
        )
    return rendered


# ── Per-block-type handlers ──────────────────────────────────────────


def _b_paragraph(block: dict[str, Any], _ctx: _Ctx) -> str:
    text = _render_inline(_str(block.get("text")))
    return f'<p class="b-paragraph">{text}</p>'


def _b_heading_4(block: dict[str, Any], _ctx: _Ctx) -> str:
    return (
        f'<h5 class="b-heading-4">{html.escape(_str(block.get("title")))}</h5>'
    )


def _b_list(block: dict[str, Any], _ctx: _Ctx) -> str:
    style = _str(block.get("style")) or "bullet"
    items_html = "".join(
        f"<li>{_render_inline(_str(it))}</li>"
        for it in (block.get("items") or [])
    )
    if style == "number":
        return f'<ol class="b-list b-list-number">{items_html}</ol>'
    if style == "check":
        # checklist: prepend ☐ (인쇄 시 의미 보존)
        items_html = "".join(
            f'<li class="check-item">☐ {_render_inline(_str(it))}</li>'
            for it in (block.get("items") or [])
        )
        return f'<ul class="b-list b-list-check">{items_html}</ul>'
    return f'<ul class="b-list b-list-bullet">{items_html}</ul>'


def _b_quote(block: dict[str, Any], _ctx: _Ctx) -> str:
    text = html.escape(_str(block.get("text")))
    cite = _str(block.get("cite"))
    cite_html = (
        f'<footer class="quote-cite">— {html.escape(cite)}</footer>' if cite else ""
    )
    return (
        f'<blockquote class="b-quote"><p>{text}</p>{cite_html}</blockquote>'
    )


def _b_callout(block: dict[str, Any], _ctx: _Ctx) -> str:
    variant = _str(block.get("variant")) or "info"
    title = _str(block.get("title"))
    text = html.escape(_str(block.get("text")))
    title_html = (
        f'<div class="callout-title">{html.escape(title)}</div>' if title else ""
    )
    return (
        f'<div class="b-callout callout-{html.escape(variant)}">'
        f"{title_html}"
        f'<div class="callout-body">{text}</div>'
        f"</div>"
    )


def _b_code(block: dict[str, Any], _ctx: _Ctx) -> str:
    language = _str(block.get("language")) or "text"
    code = html.escape(_str(block.get("code")))
    filename = _str(block.get("filename"))
    fname_html = (
        f'<div class="code-filename">{html.escape(filename)}</div>'
        if filename
        else ""
    )
    return (
        f'<div class="b-code">{fname_html}'
        f'<pre><code class="lang-{html.escape(language)}">{code}</code></pre>'
        f"</div>"
    )


def _b_math(block: dict[str, Any], ctx: _Ctx) -> str:
    expr = _str(block.get("expression"))
    display = _str(block.get("display")) or "block"
    if ctx.opts.katex_cdn:
        ctx.used_katex = True
        # CDN auto-render picks up these classes/delimiters.
        delim = "$$" if display == "block" else "$"
        return (
            f'<span class="b-math math-{display}">'
            f"{html.escape(delim)}{html.escape(expr)}{html.escape(delim)}"
            f"</span>"
        )
    # Default: emit raw LaTeX as <pre> so it stays readable.
    tag = "pre" if display == "block" else "code"
    return f'<{tag} class="b-math math-{display}">{html.escape(expr)}</{tag}>'


def _b_table(block: dict[str, Any], _ctx: _Ctx) -> str:
    cells = block.get("cells")
    if isinstance(cells, list) and cells:
        return _b_table_sparse_html(block, cells, _ctx)

    headers = block.get("headers") or []
    rows = block.get("rows") or []
    head = (
        "<thead><tr>"
        + "".join(f"<th>{html.escape(_str(h))}</th>" for h in headers)
        + "</tr></thead>"
    )
    body = "<tbody>"
    for r in rows:
        body += (
            "<tr>"
            + "".join(f"<td>{_render_inline(_str(c))}</td>" for c in r)
            + "</tr>"
        )
    body += "</tbody>"
    return f'<table class="b-table">{head}{body}</table>'


def _b_table_sparse_html(
    block: dict[str, Any],
    cells: list[dict[str, Any]],
    _ctx: _Ctx,
) -> str:
    """Render sparse-cell table to HTML; mixed-content (`blocks`) becomes
    a sequence of `<p>` / `<img>` / `<ul>` inside `<td>`."""
    if not cells:
        return ""
    max_r = max(int(c.get("r") or 0) for c in cells)
    max_c = max(int(c.get("c") or 0) for c in cells)
    cols = max_c + 1
    # Build grid + track covered slots (rowSpan/colSpan suppress neighbors).
    by_pos: dict[tuple[int, int], dict[str, Any]] = {}
    covered: set[tuple[int, int]] = set()
    for cell in cells:
        r = int(cell.get("r") or 0)
        c = int(cell.get("c") or 0)
        by_pos[(r, c)] = cell
        rs = int(cell.get("rowSpan") or 1)
        cs = int(cell.get("colSpan") or 1)
        for dr in range(rs):
            for dc in range(cs):
                if dr or dc:
                    covered.add((r + dr, c + dc))

    rows_html: list[str] = []
    for r in range(max_r + 1):
        row_html: list[str] = []
        any_header = False
        for c in range(cols):
            if (r, c) in covered:
                continue
            cell = by_pos.get((r, c))
            if cell is None:
                row_html.append("<td></td>")
                continue
            tag = "th" if cell.get("header") else "td"
            if cell.get("header"):
                any_header = True
            attrs = []
            rs = int(cell.get("rowSpan") or 1)
            cs = int(cell.get("colSpan") or 1)
            if rs > 1:
                attrs.append(f'rowspan="{rs}"')
            if cs > 1:
                attrs.append(f'colspan="{cs}"')
            if cell.get("align"):
                attrs.append(f'style="text-align: {html.escape(_str(cell["align"]))}"')
            attr_str = (" " + " ".join(attrs)) if attrs else ""
            inner = _render_cell_html(cell, _ctx)
            row_html.append(f"<{tag}{attr_str}>{inner}</{tag}>")
        if any_header:
            rows_html.append("<thead><tr>" + "".join(row_html) + "</tr></thead>")
        else:
            rows_html.append("<tr>" + "".join(row_html) + "</tr>")
    return f'<table class="b-table">{"".join(rows_html)}</table>'


def _render_cell_html(cell: dict[str, Any], _ctx: _Ctx) -> str:
    blocks = cell.get("blocks")
    if isinstance(blocks, list) and blocks:
        parts: list[str] = []
        for b in blocks:
            if not isinstance(b, dict):
                continue
            t = b.get("type")
            if t == "paragraph":
                parts.append(f"<p>{_render_inline(_str(b.get('text')))}</p>")
            elif t == "image":
                alt = html.escape(_str(b.get("caption")) or "")
                img_id = html.escape(_str(b.get("imageId")))
                parts.append(f'<img alt="{alt}" data-image-id="{img_id}">')
            elif t == "list":
                tag = "ol" if b.get("style") == "number" else "ul"
                items = b.get("items") or []
                lis = "".join(
                    f"<li>{_render_inline(_str(it))}</li>" for it in items
                )
                parts.append(f"<{tag}>{lis}</{tag}>")
        return "".join(parts)
    return _render_inline(_str(cell.get("text") or ""))


def _b_kpi_cards(block: dict[str, Any], _ctx: _Ctx) -> str:
    items = block.get("items") or []
    cards: list[str] = []
    for it in items:
        label = html.escape(_str(it.get("label")))
        value = html.escape(_str(it.get("value")))
        delta = _str(it.get("delta"))
        trend = _str(it.get("trend"))
        delta_html = (
            f'<span class="kpi-delta kpi-trend-{html.escape(trend)}">'
            f"{html.escape(delta)}</span>"
            if delta
            else ""
        )
        cards.append(
            f'<div class="kpi-card"><div class="kpi-label">{label}</div>'
            f'<div class="kpi-value">{value}</div>{delta_html}</div>'
        )
    return f'<div class="b-kpi-cards">{"".join(cards)}</div>'


def _b_chart(block: dict[str, Any], _ctx: _Ctx) -> str:
    title = _str(block.get("title"))
    data = block.get("data") or {}
    labels = data.get("labels") or []
    series = data.get("series") or []
    title_html = (
        f'<div class="chart-title">{html.escape(title)}</div>' if title else ""
    )
    head = (
        "<thead><tr><th></th>"
        + "".join(f"<th>{html.escape(_str(label))}</th>" for label in labels)
        + "</tr></thead>"
    )
    body = "<tbody>"
    for sd in series:
        name = html.escape(_str(sd.get("name")))
        values = sd.get("values") or []
        body += (
            f"<tr><th>{name}</th>"
            + "".join(f"<td>{html.escape(_str(v))}</td>" for v in values)
            + "</tr>"
        )
    body += "</tbody>"
    chart_type = html.escape(_str(block.get("chartType") or block.get("chart_type") or ""))
    return (
        f'<div class="b-chart" data-chart-type="{chart_type}">'
        f"{title_html}"
        f'<table class="chart-data">{head}{body}</table>'
        f'<p class="chart-note">차트 원본 데이터 (HTML export 는 정적 fallback).</p>'
        f"</div>"
    )


def _b_gantt(block: dict[str, Any], _ctx: _Ctx) -> str:
    tasks = block.get("tasks") or []
    head = "<thead><tr><th>이름</th><th>시작</th><th>종료</th><th>진행</th></tr></thead>"
    rows: list[str] = []
    for t in tasks:
        rows.append(
            "<tr>"
            f"<td>{html.escape(_str(t.get('name')))}</td>"
            f"<td>{html.escape(_str(t.get('start')))}</td>"
            f"<td>{html.escape(_str(t.get('end')))}</td>"
            f"<td>{html.escape(_str(t.get('progress', '')))}%</td>"
            "</tr>"
        )
    return (
        f'<table class="b-gantt">{head}<tbody>{"".join(rows)}</tbody></table>'
    )


def _b_flow(block: dict[str, Any], ctx: _Ctx) -> str:
    engine = _str(block.get("engine")) or "mermaid"
    source = _str(block.get("source"))
    if engine == "mermaid" and ctx.opts.mermaid_cdn:
        ctx.used_mermaid = True
        return f'<pre class="b-flow mermaid">{html.escape(source)}</pre>'
    return (
        f'<div class="b-flow b-flow-{html.escape(engine)}">'
        f'<div class="flow-note">[{html.escape(engine)} 다이어그램 원본 — '
        f"동적 렌더 비활성화 시 텍스트로만 보존]</div>"
        f"<pre>{html.escape(source)}</pre>"
        f"</div>"
    )


def _b_org_chart(block: dict[str, Any], _ctx: _Ctx) -> str:
    root = block.get("root") or {}

    def render_node(node: dict[str, Any]) -> str:
        label = html.escape(_str(node.get("label")))
        role = _str(node.get("role"))
        role_html = f' <span class="org-role">{html.escape(role)}</span>' if role else ""
        children = node.get("children") or []
        if not children:
            return f"<li><span>{label}{role_html}</span></li>"
        kids = "".join(render_node(c) for c in children)
        return f"<li><span>{label}{role_html}</span><ul>{kids}</ul></li>"

    return f'<div class="b-org-chart"><ul>{render_node(root)}</ul></div>'


def _b_iframe(block: dict[str, Any], _ctx: _Ctx) -> str:
    src = _str(block.get("src"))
    title = _str(block.get("title"))
    height = block.get("height") or 480
    return (
        f'<div class="b-iframe">'
        f'<iframe src="{html.escape(src)}" '
        f'title="{html.escape(title)}" '
        f'height="{int(height)}" '
        f'loading="lazy" sandbox="allow-scripts allow-same-origin"></iframe>'
        f"</div>"
    )


def _b_video(block: dict[str, Any], _ctx: _Ctx) -> str:
    url = _str(block.get("url"))
    title = _str(block.get("title"))
    provider = _str(block.get("provider")) or "intra"
    if provider in ("youtube", "vimeo"):
        # external embed is acceptable since the source was whitelisted server-side.
        return (
            f'<div class="b-video b-video-{html.escape(provider)}">'
            f'<a href="{html.escape(url)}" target="_blank" rel="noopener">'
            f'{html.escape(title or url)}</a>'
            f"</div>"
        )
    return (
        f'<div class="b-video b-video-intra">'
        f'<video controls preload="metadata" src="{html.escape(url)}"></video>'
        f'<div class="video-caption">{html.escape(title)}</div>'
        f"</div>"
    )


def _b_image(block: dict[str, Any], ctx: _Ctx) -> str:
    image_id = _str(block.get("imageId") or block.get("image_id"))
    caption = _str(block.get("caption"))
    alt = _str(block.get("alt") or caption)
    width = _str(block.get("width")) or "md"
    # `meta.align` (left|center|right|full) → CSS class on the figure. `full`
    # makes the figure stretch edge-to-edge regardless of `width`.
    meta = block.get("meta") or {}
    align = _str(meta.get("align")) if isinstance(meta, dict) else ""
    align_cls = f" b-image-align-{html.escape(align)}" if align else ""
    src = _resolve_image_src(image_id, ctx)
    if not src:
        return (
            f'<figure class="b-image b-image-{html.escape(width)}{align_cls}">'
            f'<div class="image-missing">[이미지 누락: {html.escape(image_id)}]</div>'
            f'<figcaption>{html.escape(caption)}</figcaption></figure>'
        )
    return (
        f'<figure class="b-image b-image-{html.escape(width)}{align_cls}">'
        f'<img src="{src}" alt="{html.escape(alt)}" loading="lazy">'
        + (f'<figcaption>{html.escape(caption)}</figcaption>' if caption else "")
        + "</figure>"
    )


def _b_gallery(block: dict[str, Any], ctx: _Ctx) -> str:
    items = block.get("items") or []
    layout = _str(block.get("layout")) or "grid"
    figs: list[str] = []
    for it in items:
        image_id = _str(it.get("imageId") or it.get("image_id"))
        caption = _str(it.get("caption"))
        alt = _str(it.get("alt") or caption)
        src = _resolve_image_src(image_id, ctx)
        body = (
            f'<img src="{src}" alt="{html.escape(alt)}" loading="lazy">'
            if src
            else f'<div class="image-missing">[누락: {html.escape(image_id)}]</div>'
        )
        figs.append(
            f"<figure>{body}"
            + (f"<figcaption>{html.escape(caption)}</figcaption>" if caption else "")
            + "</figure>"
        )
    return (
        f'<div class="b-gallery b-gallery-{html.escape(layout)}">'
        + "".join(figs)
        + "</div>"
    )


def _b_file(block: dict[str, Any], _ctx: _Ctx) -> str:
    name = html.escape(_str(block.get("name")))
    size = block.get("size")
    mime = html.escape(_str(block.get("mime")))
    size_str = _human_size(size) if isinstance(size, int) else ""
    return (
        f'<div class="b-file">'
        f'<span class="file-icon">📎</span>'
        f'<span class="file-name">{name}</span> '
        f'<span class="file-meta">{html.escape(size_str)} · {mime}</span>'
        f"</div>"
    )


def _b_doc_link_card(block: dict[str, Any], _ctx: _Ctx) -> str:
    slug = _str(block.get("slug"))
    show_summary = bool(block.get("showSummary") or block.get("show_summary"))
    summary_html = (
        '<p class="doc-link-summary">[요약은 빌드 시점 데이터에 따라 비어있을 수 있음]</p>'
        if show_summary
        else ""
    )
    return (
        f'<a class="b-doc-link-card" href="/docs/{html.escape(slug)}">'
        f'<span class="doc-link-slug">/{html.escape(slug)}</span>'
        f"{summary_html}</a>"
    )


def _b_glossary_ref(block: dict[str, Any], _ctx: _Ctx) -> str:
    term = html.escape(_str(block.get("term")))
    return (
        f'<span class="b-glossary-ref" title="용어">{term}</span>'
    )


def _b_columns(block: dict[str, Any], ctx: _Ctx) -> str:
    columns = block.get("columns") or []
    cols_html: list[str] = []
    for col in columns:
        inner = "".join(_render_block(b, ctx) for b in col)
        cols_html.append(f'<div class="col">{inner}</div>')
    return (
        f'<div class="b-columns" data-cols="{len(columns)}">'
        + "".join(cols_html)
        + "</div>"
    )


def _b_tabs(block: dict[str, Any], ctx: _Ctx) -> str:
    """Tabs flatten to <details> blocks for static HTML — first one is open."""
    tabs = block.get("tabs") or []
    parts: list[str] = []
    for i, tab in enumerate(tabs):
        label = html.escape(_str(tab.get("label")))
        inner = "".join(_render_block(b, ctx) for b in (tab.get("blocks") or []))
        opened = " open" if i == 0 else ""
        parts.append(
            f'<details class="tab"{opened}>'
            f"<summary>{label}</summary>{inner}</details>"
        )
    return f'<div class="b-tabs">{"".join(parts)}</div>'


def _b_accordion(block: dict[str, Any], ctx: _Ctx) -> str:
    items = block.get("items") or []
    parts: list[str] = []
    for it in items:
        label = html.escape(_str(it.get("label")))
        inner = "".join(_render_block(b, ctx) for b in (it.get("blocks") or []))
        parts.append(
            f'<details class="acc-item">'
            f"<summary>{label}</summary>{inner}</details>"
        )
    return f'<div class="b-accordion">{"".join(parts)}</div>'


def _b_data_source(block: dict[str, Any], _ctx: _Ctx) -> str:
    endpoint = html.escape(_str(block.get("endpoint")))
    render = html.escape(_str(block.get("render")))
    return (
        f'<div class="b-data-source"><strong>데이터 소스</strong> · '
        f'<code>{endpoint}</code> · render={render}'
        f'<p class="ds-note">[정적 HTML — 실시간 데이터 미반영]</p></div>'
    )


def _b_dashboard_embed(block: dict[str, Any], _ctx: _Ctx) -> str:
    provider = html.escape(_str(block.get("provider")))
    panel = html.escape(_str(block.get("panelId") or block.get("panel_id")))
    return (
        f'<div class="b-dashboard-embed">'
        f"<strong>대시보드:</strong> {provider} · panel={panel}"
        f'<p class="dash-note">[정적 HTML — 패널 미렌더]</p></div>'
    )


def _b_calculator(block: dict[str, Any], _ctx: _Ctx) -> str:
    label = html.escape(_str(block.get("label")))
    formula = html.escape(_str(block.get("formula")))
    inputs = block.get("inputs") or []
    rows = "".join(
        f"<tr><th>{html.escape(_str(i.get('label')))}</th>"
        f"<td>{html.escape(_str(i.get('default', '')))}</td></tr>"
        for i in inputs
    )
    return (
        f'<div class="b-calculator">'
        f'<div class="calc-label">{label}</div>'
        f'<div class="calc-formula">수식: <code>{formula}</code></div>'
        f"<table>{rows}</table>"
        f'<p class="calc-note">[계산기 — 정적 export, 입력값은 기본값만 표시]</p>'
        f"</div>"
    )


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


# ── Trailing sections (refs, glossary) ───────────────────────────────


def _render_references(refs: list[dict[str, Any]]) -> str:
    items: list[str] = []
    for r in refs:
        label = html.escape(_str(r.get("label")))
        url = _str(r.get("url"))
        if url:
            items.append(
                f'<li><a href="{html.escape(url)}" target="_blank" '
                f'rel="noopener">{label}</a></li>'
            )
        else:
            items.append(f"<li>{label}</li>")
    return (
        '<section class="trailing refs">'
        '<h2>참고문헌</h2>'
        f'<ol>{"".join(items)}</ol>'
        "</section>"
    )


def _render_glossary(glossary: list[dict[str, Any]]) -> str:
    items: list[str] = []
    for g in glossary:
        term = html.escape(_str(g.get("term")))
        definition = html.escape(_str(g.get("definition")))
        items.append(f"<dt>{term}</dt><dd>{definition}</dd>")
    return (
        '<section class="trailing glossary">'
        '<h2>용어</h2>'
        f'<dl>{"".join(items)}</dl>'
        "</section>"
    )


# ── Helpers ──────────────────────────────────────────────────────────


def _str(v: Any) -> str:
    if v is None:
        return ""
    if isinstance(v, bool):
        return "true" if v else "false"
    return str(v)


def _human_size(n: int) -> str:
    if n < 1024:
        return f"{n} B"
    if n < 1024 * 1024:
        return f"{n / 1024:.1f} KB"
    if n < 1024 * 1024 * 1024:
        return f"{n / (1024 * 1024):.1f} MB"
    return f"{n / (1024 * 1024 * 1024):.2f} GB"


def _render_inline(text: str) -> str:
    """단순 wiki-link 변환 + escape.

    `[[slug]]` → 같은 host 의 `/docs/<slug>` 링크. 표시 텍스트는 slug 그대로.
    `[[slug|label]]` 형태도 지원.
    """
    if not text:
        return ""
    out: list[str] = []
    i = 0
    n = len(text)
    while i < n:
        # find next `[[`
        start = text.find("[[", i)
        if start < 0:
            out.append(html.escape(text[i:]))
            break
        out.append(html.escape(text[i:start]))
        end = text.find("]]", start + 2)
        if end < 0:
            out.append(html.escape(text[start:]))
            break
        inner = text[start + 2 : end]
        if "|" in inner:
            slug, _, label = inner.partition("|")
        else:
            slug = inner
            label = inner
        slug = slug.strip()
        label = label.strip()
        out.append(
            f'<a class="wiki-link" href="/docs/{html.escape(slug)}">'
            f'{html.escape(label)}</a>'
        )
        i = end + 2
    return "".join(out)


def _resolve_image_src(image_id: str, ctx: _Ctx) -> str | None:
    if not image_id:
        return None
    resolver = ctx.opts.image_resolver
    if resolver is None:
        return None
    info = resolver(image_id)
    if not info:
        return None
    url = info.get("url")
    if not url:
        return None
    if not ctx.opts.inline_images:
        return html.escape(_str(url))
    blob = info.get("bytes")
    mime = info.get("mime") or "image/webp"
    if not blob:
        # resolver couldn't fetch bytes; fall back to URL
        return html.escape(_str(url))
    encoded = base64.b64encode(blob).decode("ascii")
    return f"data:{mime};base64,{encoded}"


# ── Inline CSS ───────────────────────────────────────────────────────


# Samsung Blue 팔레트(#1428A0 계열) + Pretendard 폴백.
_INLINE_CSS = """
:root {
  --smsg-50:  #eef1fb;
  --smsg-100: #d6deff;
  --smsg-300: #6f87d6;
  --smsg-500: #1f3aa8;
  --smsg-700: #1428a0;
  --smsg-900: #0a1657;
  --gray-50:  #f8fafc;
  --gray-100: #f1f5f9;
  --gray-200: #e2e8f0;
  --gray-300: #cbd5e1;
  --gray-500: #64748b;
  --gray-700: #334155;
  --gray-900: #0f172a;
  --warn:     #b45309;
  --danger:   #b91c1c;
  --tip:      #047857;
}
* { box-sizing: border-box; }
html { font-size: 16px; }
body {
  margin: 0; padding: 24px;
  font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, 'Segoe UI',
               'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif;
  color: var(--gray-900); background: white; line-height: 1.65;
  max-width: 960px; margin-left: auto; margin-right: auto;
}
.doc-header { border-bottom: 2px solid var(--smsg-100); padding-bottom: 12px;
              margin-bottom: 16px; }
.doc-slug   { font-family: monospace; color: var(--smsg-700);
              background: var(--smsg-50); display: inline-block;
              padding: 2px 8px; border-radius: 4px; font-size: 12px; }
.doc-title  { font-size: 32px; font-weight: 700; margin: 8px 0 4px;
              color: var(--smsg-900); }
.doc-summary{ color: var(--gray-700); margin: 0 0 8px; }
.doc-meta   { color: var(--gray-500); font-size: 13px; }
.badge      { display: inline-block; padding: 1px 6px; border-radius: 4px;
              font-size: 11px; margin-left: 6px; }
.badge-public     { background: #dcfce7; color: #14532d; }
.badge-internal   { background: var(--smsg-50); color: var(--smsg-700); }
.badge-restricted { background: #fef3c7; color: #92400e; }
.badge-tag        { background: var(--gray-100); color: var(--gray-700); }
.infobox    { float: right; width: 260px; margin: 0 0 16px 16px;
              border: 1px solid var(--smsg-100); background: var(--smsg-50);
              border-radius: 6px; }
.infobox table { width: 100%; border-collapse: collapse; font-size: 13px; }
.infobox th { text-align: left; padding: 6px 10px; background: var(--smsg-100);
              color: var(--smsg-900); width: 35%; vertical-align: top; }
.infobox td { padding: 6px 10px; vertical-align: top; }
.toc        { border: 1px solid var(--gray-200); padding: 12px 16px;
              margin: 16px 0 24px; border-radius: 6px; background: var(--gray-50); }
.toc-title  { font-size: 16px; font-weight: 600; margin: 0 0 8px;
              color: var(--smsg-700); }
.toc-list   { margin: 0; padding-left: 18px; }
.toc-l1     { margin: 2px 0; }
.toc-l1 a   { color: var(--smsg-700); text-decoration: none; font-weight: 500; }
.toc-l1 a:hover { text-decoration: underline; }
.toc-num    { color: var(--smsg-500); font-family: monospace;
              margin-right: 6px; font-size: 12px; }
.sec-l1 .sec-heading { font-size: 24px; border-bottom: 1px solid var(--smsg-100);
                       padding-bottom: 4px; margin-top: 32px; color: var(--smsg-900); }
.sec-l2 .sec-heading { font-size: 20px; margin-top: 24px; color: var(--smsg-900); }
.sec-l3 .sec-heading { font-size: 17px; margin-top: 18px; color: var(--gray-700); }
.sec-num    { color: var(--smsg-500); font-family: monospace;
              margin-right: 8px; font-size: 14px; }
.b-paragraph{ margin: 8px 0; }
.b-list     { margin: 8px 0; padding-left: 22px; }
.b-list-check { list-style: none; padding-left: 0; }
.b-quote    { border-left: 3px solid var(--smsg-300); padding: 4px 12px;
              color: var(--gray-700); margin: 12px 0; background: var(--smsg-50); }
.quote-cite { font-size: 12px; color: var(--gray-500); margin-top: 6px; }
.b-callout  { border-left: 4px solid var(--smsg-500); padding: 10px 14px;
              margin: 12px 0; border-radius: 0 4px 4px 0; }
.callout-info    { background: var(--smsg-50); border-color: var(--smsg-500); }
.callout-warn    { background: #fffbeb; border-color: var(--warn); }
.callout-danger  { background: #fef2f2; border-color: var(--danger); }
.callout-tip     { background: #ecfdf5; border-color: var(--tip); }
.callout-title   { font-weight: 600; margin-bottom: 4px; }
.b-code     { margin: 12px 0; background: var(--gray-900); border-radius: 6px;
              overflow: hidden; }
.code-filename { background: var(--gray-700); color: var(--gray-100);
                 padding: 4px 12px; font-family: monospace; font-size: 12px; }
.b-code pre { margin: 0; padding: 12px 16px; overflow-x: auto; color: var(--gray-100); }
.b-code code { font-family: 'JetBrains Mono', Menlo, Consolas, monospace;
               font-size: 13px; }
.b-table    { border-collapse: collapse; margin: 12px 0; width: 100%;
              font-size: 14px; }
.b-table th, .b-table td { border: 1px solid var(--gray-200);
                            padding: 6px 10px; text-align: left; }
.b-table th { background: var(--smsg-50); color: var(--smsg-900); }
.b-table tbody tr:nth-child(even) { background: var(--gray-50); }
.b-kpi-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
               gap: 10px; margin: 12px 0; }
.kpi-card   { border: 1px solid var(--gray-200); border-radius: 6px;
              padding: 10px; background: white; }
.kpi-label  { font-size: 12px; color: var(--gray-500); }
.kpi-value  { font-size: 22px; font-weight: 700; color: var(--smsg-700); }
.kpi-delta  { font-size: 12px; color: var(--gray-500); }
.kpi-trend-up   { color: #047857; }
.kpi-trend-down { color: #b91c1c; }
.b-chart    { margin: 12px 0; padding: 10px; border: 1px dashed var(--gray-200);
              border-radius: 6px; }
.chart-title { font-weight: 600; margin-bottom: 6px; }
.chart-data  { font-size: 12px; }
.chart-data th, .chart-data td { padding: 4px 8px; border: 1px solid var(--gray-200); }
.chart-note { font-size: 11px; color: var(--gray-500); margin: 6px 0 0; }
.b-gantt    { width: 100%; border-collapse: collapse; font-size: 13px; }
.b-gantt th, .b-gantt td { padding: 4px 8px; border: 1px solid var(--gray-200); }
.b-flow pre { background: var(--gray-50); padding: 10px; border-radius: 6px;
              overflow-x: auto; font-family: monospace; font-size: 12px; }
.b-org-chart ul { padding-left: 18px; }
.b-iframe iframe { width: 100%; border: 1px solid var(--gray-200); border-radius: 6px; }
.b-video video { max-width: 100%; border-radius: 6px; }
.b-image    { margin: 14px 0; text-align: center; }
.b-image img { max-width: 100%; height: auto; border-radius: 6px;
               border: 1px solid var(--gray-200); }
.b-image-sm img { max-width: 320px; }
.b-image-md img { max-width: 640px; }
.b-image-lg img { max-width: 920px; }
.b-image-full img { max-width: 100%; }
.b-image-align-left  { text-align: left; }
.b-image-align-center{ text-align: center; }
.b-image-align-right { text-align: right; }
.b-image-align-full  { text-align: center; }
.b-image-align-full img { max-width: 100%; }
.b-image figcaption { font-size: 12px; color: var(--gray-500); margin-top: 4px; }
.image-missing { padding: 20px; background: var(--gray-100); color: var(--gray-500);
                 border-radius: 6px; }
.b-gallery  { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
              gap: 8px; margin: 12px 0; }
.b-gallery img { width: 100%; height: auto; border-radius: 6px; }
.b-file     { padding: 8px 12px; border: 1px solid var(--gray-200);
              border-radius: 6px; margin: 8px 0; background: var(--gray-50); }
.file-name  { font-weight: 600; }
.file-meta  { color: var(--gray-500); font-size: 12px; }
.b-doc-link-card { display: block; padding: 10px 14px; border: 1px solid var(--smsg-100);
                   border-radius: 6px; margin: 8px 0; text-decoration: none;
                   color: var(--smsg-700); background: var(--smsg-50); }
.doc-link-slug { font-family: monospace; }
.b-glossary-ref { border-bottom: 1px dotted var(--smsg-500); cursor: help; }
.b-columns  { display: grid; gap: 12px; margin: 12px 0; }
.b-columns[data-cols="2"] { grid-template-columns: 1fr 1fr; }
.b-columns[data-cols="3"] { grid-template-columns: 1fr 1fr 1fr; }
.b-columns[data-cols="4"] { grid-template-columns: repeat(4, 1fr); }
.b-tabs details, .b-accordion details { border: 1px solid var(--gray-200);
  border-radius: 4px; padding: 6px 10px; margin: 4px 0; background: var(--gray-50); }
.b-tabs summary, .b-accordion summary { cursor: pointer; font-weight: 600; }
.b-data-source, .b-dashboard-embed, .b-calculator {
  padding: 10px 14px; border: 1px dashed var(--gray-300); border-radius: 6px;
  margin: 12px 0; background: var(--gray-50);
}
.calc-formula code { font-family: monospace; }
.wiki-link  { color: var(--smsg-700); text-decoration: none; border-bottom: 1px dotted var(--smsg-300); }
.wiki-link:hover { color: var(--smsg-900); border-bottom-style: solid; }
.trailing   { margin-top: 32px; border-top: 1px solid var(--gray-200);
              padding-top: 16px; }
.trailing h2 { font-size: 18px; color: var(--smsg-900); }
.trailing dl dt { font-weight: 600; margin-top: 8px; color: var(--smsg-700); }
.trailing dl dd { margin: 4px 0 0 16px; color: var(--gray-700); }
@media print {
  body { padding: 0; max-width: none; }
  .toc { page-break-after: always; }
  .sec-l1 { page-break-before: auto; }
  .b-page-break { page-break-before: always; break-before: page; }
}
"""


_KATEX_CDN_LINK = (
    '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">\n'
    '<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script>\n'
    '<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js"\n'
    '  onload="renderMathInElement(document.body, {delimiters: ['
    '{left: \\"$$\\", right: \\"$$\\", display: true},'
    '{left: \\"$\\", right: \\"$\\", display: false}]});"></script>'
)


_MERMAID_CDN_SCRIPT = (
    '<script type="module">'
    "import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs';"
    "mermaid.initialize({startOnLoad:true});"
    "</script>"
)


_HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="{lang}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<style>{styles}</style>
{head_extras}
</head>
<body>
{body}
</body>
</html>
"""
