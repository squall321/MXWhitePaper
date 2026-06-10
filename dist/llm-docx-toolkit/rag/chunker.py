"""chunker.py — slice MXWhitePaper widget rules / schema / examples into
``chunks.jsonl`` for the RAG retriever.

Inputs (TRACKED_SOURCES, see _lock.py):
  - docs/llm-input-rules.md               → rule prose, mistake table, checklist
  - apps/api/app/services/widget_markers.py → per-widget converter docstrings
  - packages/shared/schemas/document.json  → required/optional fields per widget
  - dist/llm-docx-toolkit/llm-system-prompt.md → optional, skip if missing (G7)
  - dist/llm-docx-toolkit/examples/build_examples.py → fixture block lists
  - docs/archive/*/_INDEX.md (ARCHIVE_INDEX_GLOB)  → per-cycle decision rows

Output ordering is deterministic: chunks are sorted by ``id`` so the
JSONL hash is reproducible (used by ``_lock.py`` drift detection).
"""
from __future__ import annotations

import argparse
import ast
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any

# The retriever module sits next to this one.
try:
    from .retriever import Chunk
    from ._lock import (
        ARCHIVE_INDEX_GLOB,
        collect_source_hashes,
        diff_hashes,
        hash_file,
        read_lock,
        write_lock,
    )
except ImportError:  # script execution: `python chunker.py`
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from retriever import Chunk  # type: ignore[no-redef]
    from _lock import (  # type: ignore[no-redef]
        ARCHIVE_INDEX_GLOB,
        collect_source_hashes,
        diff_hashes,
        hash_file,
        read_lock,
        write_lock,
    )


# ── slug helper ────────────────────────────────────────────────────────

_NON_SLUG = re.compile(r"[^a-z0-9가-힣\-]+")
_DASHES = re.compile(r"-{2,}")
_WS = re.compile(r"\s+")


def _slugify(s: str) -> str:
    """ASCII-or-Korean lowercase slug. Whitespace → ``-``; punctuation stripped.
    Korean is preserved (the codebase mixes en/ko headings)."""
    out = s.strip().lower()
    out = re.sub(r"\s+", "-", out)
    out = _NON_SLUG.sub("", out)
    out = _DASHES.sub("-", out).strip("-")
    return out or "x"


def _normalize_text(s: str) -> str:
    """Collapse whitespace runs (incl. trailing markdown punctuation in
    headings). Korean glyphs are left alone."""
    return _WS.sub(" ", s).strip()


# ── 1. llm-input-rules.md ─────────────────────────────────────────────

# Match `## 3.1 callout (...)` or `### 1.2 메타데이터` etc.
_HEADING_RE = re.compile(r"^(#{2,3})\s+(.+?)\s*$")
# Match a leading "<num>." or "<num>.<num>" prefix. The trailing dot on
# top-level numbers ("0.", "1.", "5.") is optional; deeper levels ("3.1",
# "3.10") never carry a trailing dot in the source.
_NUM_PREFIX_RE = re.compile(r"^([0-9]+(?:\.[0-9]+)*)\.?\s+(.+)$")

# Cap chunk text length; longer sections are split into <id>-cont, -cont2, ...
_MAX_CHARS = 800


def _split_long(text: str, max_chars: int = _MAX_CHARS) -> list[str]:
    """Split text into pieces of at most ``max_chars`` chars, breaking at
    paragraph (blank-line) boundaries when possible."""
    text = text.strip()
    if len(text) <= max_chars:
        return [text]
    out: list[str] = []
    paragraphs = text.split("\n\n")
    buf: list[str] = []
    cur_len = 0
    for p in paragraphs:
        p_len = len(p)
        if cur_len + p_len + 2 > max_chars and buf:
            out.append("\n\n".join(buf).strip())
            buf = [p]
            cur_len = p_len
        else:
            buf.append(p)
            cur_len += p_len + 2
    if buf:
        out.append("\n\n".join(buf).strip())
    # Hard fallback: any single paragraph over the cap.
    final: list[str] = []
    for piece in out:
        if len(piece) <= max_chars:
            final.append(piece)
        else:
            for k in range(0, len(piece), max_chars):
                final.append(piece[k : k + max_chars])
    return final


def _chunks_from_rules(repo_root: Path) -> list[Chunk]:
    path = repo_root / "docs" / "llm-input-rules.md"
    if not path.exists():
        return []
    src = path.read_text(encoding="utf-8")
    lines = src.splitlines()

    # Walk: collect (level, raw_heading, body_lines) for every H2/H3.
    sections: list[tuple[int, str, list[str]]] = []
    cur: tuple[int, str, list[str]] | None = None
    for ln in lines:
        m = _HEADING_RE.match(ln)
        if m:
            if cur is not None:
                sections.append(cur)
            level = len(m.group(1))
            cur = (level, m.group(2).strip(), [])
        else:
            if cur is not None:
                cur[2].append(ln)
    if cur is not None:
        sections.append(cur)

    out: list[Chunk] = []
    for level, raw_head, body in sections:
        heading = _normalize_text(raw_head)
        body_text = "\n".join(body).strip()

        # Quickref: section "0. ..."
        nm = _NUM_PREFIX_RE.match(heading)
        if nm and nm.group(1) == "0":
            text = body_text
            for piece_idx, piece in enumerate(_split_long(text)):
                cid = "rules#quickref" + (f"-cont{piece_idx}" if piece_idx else "")
                out.append(Chunk(
                    id=cid,
                    source="llm-input-rules.md",
                    heading=heading,
                    text=piece,
                    metadata={"section": "quickref"},
                ))
            continue

        # Mistakes table: section "5. 자주 하는 실수 (해결법)".
        if nm and nm.group(1) == "5":
            for i, chunk in enumerate(_split_mistake_rows(heading, body_text)):
                out.append(chunk)
            # Skip the default emit for this section — the rows are the chunks.
            continue

        # Checklist: section "7. 빠른 체크리스트 ...".
        if nm and nm.group(1) == "7":
            for piece_idx, piece in enumerate(_split_long(body_text)):
                cid = "rules#checklist" + (f"-cont{piece_idx}" if piece_idx else "")
                out.append(Chunk(
                    id=cid,
                    source="llm-input-rules.md",
                    heading=heading,
                    text=piece,
                    metadata={"section": "checklist"},
                ))
            continue

        if not body_text:
            continue

        # Default: dotted-numbered section (e.g. "3.1 callout (...)") becomes
        # a chunk keyed by the number + slugified rest. Ungated headings get a
        # plain slug.
        if nm:
            number = nm.group(1)
            rest = nm.group(2)
            slug = _slugify(rest)
            base_id = f"rules#{number}-{slug}"
        else:
            base_id = f"rules#{_slugify(heading)}"

        for piece_idx, piece in enumerate(_split_long(body_text)):
            cid = base_id + (f"-cont{piece_idx}" if piece_idx else "")
            out.append(Chunk(
                id=cid,
                source="llm-input-rules.md",
                heading=heading,
                text=piece,
                metadata={"section_level": level},
            ))
    return out


_MISTAKE_ROW_RE = re.compile(r"^\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*$")


def _split_mistake_rows(heading: str, body: str) -> list[Chunk]:
    """Each row of the 3-column markdown mistake table becomes a chunk."""
    chunks: list[Chunk] = []
    n = 0
    for ln in body.splitlines():
        m = _MISTAKE_ROW_RE.match(ln.strip())
        if not m:
            continue
        a, b, c = (x.strip() for x in m.groups())
        # Skip the header row "실수|결과|해결" and the divider "---|---|---".
        if a in {"실수", "Mistake"} or set(a) <= {"-", ":"}:
            continue
        n += 1
        text = f"실수: {a}\n결과: {b}\n해결: {c}"
        chunks.append(Chunk(
            id=f"rules#mistake-{n}",
            source="llm-input-rules.md",
            heading=heading,
            text=text,
            metadata={"section": "mistakes", "row": n},
        ))
    return chunks


# ── 2. widget_markers.py ──────────────────────────────────────────────

# Schema-type → converter-function suffix. Built so we can grab each
# converter's docstring deterministically from the AST.
_SCHEMA_TO_CONVERTER: dict[str, str] = {
    "callout": "_convert_callout",
    "kpi-cards": "_convert_kpi_cards",
    "chart": "_convert_chart",
    "gantt": "_convert_gantt",
    "flow": "_convert_flow",
    "org-chart": "_convert_org_chart",
    "gallery": "_convert_gallery",
    "columns": "_convert_columns",
    "tabs": "_convert_tabs",
    "accordion": "_convert_accordion",
    "iframe": "_convert_iframe",
    "video": "_convert_video",
    "file": "_convert_file",
    "pdf": "_convert_pdf",
    "whiteboard": "_convert_whiteboard",
    "image-annotation": "_convert_image_annotation",
    "doc-link-card": "_convert_doc_link",
    "glossary-ref": "_convert_glossary",
}

# Schema-type → friendly marker key the importer uses (matches
# _SCHEMA_TYPE_TO_MARKER_KEY in widget_markers.py).
_MARKER_KEY: dict[str, str] = {
    "doc-link-card": "doc-link",
    "glossary-ref": "glossary",
}

# Variant grammar per widget — mirrors emit_marker_text logic.
_MARKER_VARIANT_HINT: dict[str, str] = {
    "chart": "line|bar|pie|area|radar|scatter",
    "gallery": "carousel (omit for grid)",
    "columns": "2|3|4",
    "callout": "info|warn|danger|tip",
}


def _converter_docstrings(repo_root: Path) -> dict[str, str]:
    """Parse widget_markers.py with ast and return {func_name: docstring}."""
    path = repo_root / "apps" / "api" / "app" / "services" / "widget_markers.py"
    src = path.read_text(encoding="utf-8")
    tree = ast.parse(src)
    out: dict[str, str] = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name.startswith("_convert_"):
            doc = ast.get_docstring(node) or ""
            out[node.name] = doc
    return out


def _chunks_from_widget_markers(repo_root: Path) -> list[Chunk]:
    docs = _converter_docstrings(repo_root)
    out: list[Chunk] = []
    for schema_type, fn_name in _SCHEMA_TO_CONVERTER.items():
        marker_key = _MARKER_KEY.get(schema_type, schema_type)
        variant_hint = _MARKER_VARIANT_HINT.get(schema_type)
        if variant_hint:
            marker_form = f"Marker form: `Widget: {marker_key} ({variant_hint})`"
        else:
            marker_form = f"Marker form: `Widget: {marker_key}`"

        doc = docs.get(fn_name, "").strip()
        if doc:
            text = f"{doc}\n\n{marker_form}"
        else:
            text = marker_form
        out.append(Chunk(
            id=f"widget#{schema_type}",
            source="widget_markers.py",
            heading=f"widget: {schema_type}",
            text=text,
            metadata={"widget_type": schema_type, "converter": fn_name},
        ))
    return out


# ── 3. document.json ──────────────────────────────────────────────────

# Schema $defs key → schema type-const. Order matches _SCHEMA_TO_CONVERTER.
_SCHEMA_DEFS: dict[str, str] = {
    "CalloutBlock": "callout",
    "KpiCardsBlock": "kpi-cards",
    "ChartBlock": "chart",
    "GanttBlock": "gantt",
    "FlowBlock": "flow",
    "OrgChartBlock": "org-chart",
    "GalleryBlock": "gallery",
    "ColumnsBlock": "columns",
    "TabsBlock": "tabs",
    "AccordionBlock": "accordion",
    "IframeBlock": "iframe",
    "VideoBlock": "video",
    "FileBlock": "file",
    "PdfBlock": "pdf",
    "WhiteboardBlock": "whiteboard",
    "ImageAnnotationBlock": "image-annotation",
    "DocLinkCardBlock": "doc-link-card",
    "GlossaryRefBlock": "glossary-ref",
}


def _format_field(name: str, spec: dict[str, Any]) -> str:
    """Render one property as ``name (type|enum)`` for chunk text."""
    if "const" in spec:
        return f'{name} ("{spec["const"]}")'
    if "enum" in spec:
        return f"{name} ({'|'.join(str(v) for v in spec['enum'])})"
    if "$ref" in spec:
        ref = spec["$ref"].rsplit("/", 1)[-1]
        return f"{name} ({ref})"
    t = spec.get("type")
    if isinstance(t, list):
        t = "|".join(t)
    if t == "array":
        items = spec.get("items") or {}
        if "$ref" in items:
            inner = items["$ref"].rsplit("/", 1)[-1]
        elif "type" in items:
            inner = items["type"]
        else:
            inner = "object"
        return f"{name} (array<{inner}>)"
    if t == "object":
        return f"{name} (object)"
    if t:
        return f"{name} ({t})"
    return name


def _chunks_from_schema(repo_root: Path) -> list[Chunk]:
    path = repo_root / "packages" / "shared" / "schemas" / "document.json"
    schema = json.loads(path.read_text(encoding="utf-8"))
    defs = schema.get("$defs") or {}
    out: list[Chunk] = []
    for def_name, type_const in _SCHEMA_DEFS.items():
        block = defs.get(def_name)
        if not isinstance(block, dict):
            continue
        required = list(block.get("required") or [])
        props = block.get("properties") or {}
        required_set = set(required)

        req_lines = [_format_field(n, props.get(n) or {}) for n in required]
        opt_lines = [
            _format_field(n, props.get(n) or {})
            for n in props.keys()
            if n not in required_set
        ]
        text_parts = [f"Required: {', '.join(req_lines) if req_lines else '(none)'}"]
        if opt_lines:
            text_parts.append(f"Optional: {', '.join(opt_lines)}")
        desc = block.get("description")
        if isinstance(desc, str) and desc.strip():
            text_parts.append(f"Note: {_normalize_text(desc)}")
        text = "\n".join(text_parts)

        out.append(Chunk(
            id=f"schema#{type_const}",
            source="document.json",
            heading=f"schema: {type_const}",
            text=text,
            metadata={
                "widget_type": type_const,
                "schema_path": f"$defs/{def_name}",
            },
        ))
    return out


# ── 4. llm-system-prompt.md (optional — G7 produces this) ─────────────

_H2_RE = re.compile(r"^##\s+(.+?)\s*$")


def _chunks_from_system_prompt(repo_root: Path, *, verbose: bool = False) -> list[Chunk]:
    path = repo_root / "dist" / "llm-docx-toolkit" / "llm-system-prompt.md"
    if not path.exists():
        if verbose:
            print(f"  llm-system-prompt.md missing at {path} — skipping")
        return []
    src = path.read_text(encoding="utf-8")
    lines = src.splitlines()
    sections: list[tuple[str, list[str]]] = []
    cur: tuple[str, list[str]] | None = None
    for ln in lines:
        m = _H2_RE.match(ln)
        if m:
            if cur is not None:
                sections.append(cur)
            cur = (m.group(1).strip(), [])
        else:
            if cur is not None:
                cur[1].append(ln)
    if cur is not None:
        sections.append(cur)

    out: list[Chunk] = []
    for heading, body in sections:
        body_text = "\n".join(body).strip()
        if not body_text:
            continue
        slug = _slugify(heading)
        for piece_idx, piece in enumerate(_split_long(body_text)):
            cid = f"prompt#{slug}" + (f"-cont{piece_idx}" if piece_idx else "")
            out.append(Chunk(
                id=cid,
                source="llm-system-prompt.md",
                heading=heading,
                text=piece,
                metadata={},
            ))
    return out


# ── 4b. llm-viewer-guide.md ───────────────────────────────────────────


def _chunks_from_viewer_guide(repo_root: Path) -> list[Chunk]:
    """H2-walk over the viewer guide. Mirrors `_chunks_from_system_prompt`
    intentionally — the guide is short, hand-written, and benefits from
    one-chunk-per-chapter retrieval. Numbered headings (`## 0. ...`) keep
    their number in the chunk id so retrieval ordering is stable."""
    path = repo_root / "docs" / "llm-viewer-guide.md"
    if not path.exists():
        return []
    src = path.read_text(encoding="utf-8")
    lines = src.splitlines()
    sections: list[tuple[str, list[str]]] = []
    cur: tuple[str, list[str]] | None = None
    for ln in lines:
        m = _H2_RE.match(ln)
        if m:
            if cur is not None:
                sections.append(cur)
            cur = (m.group(1).strip(), [])
        else:
            if cur is not None:
                cur[1].append(ln)
    if cur is not None:
        sections.append(cur)

    out: list[Chunk] = []
    for heading, body in sections:
        body_text = "\n".join(body).strip()
        if not body_text:
            continue
        nm = _NUM_PREFIX_RE.match(_normalize_text(heading))
        if nm:
            base = f"viewer#{nm.group(1)}-{_slugify(nm.group(2))}"
        else:
            base = f"viewer#{_slugify(heading)}"
        for piece_idx, piece in enumerate(_split_long(body_text)):
            cid = base + (f"-cont{piece_idx}" if piece_idx else "")
            out.append(Chunk(
                id=cid,
                source="llm-viewer-guide.md",
                heading=heading,
                text=piece,
                metadata={"section": "viewer"},
            ))
    return out


# ── 4c. archive indexes (docs/archive/<YYYY-MM>/_INDEX.md) ────────────

# Cells split on unescaped pipes only — long feature cells contain literal
# `\|` sequences (e.g. "drillLabel \| null").
_UNESCAPED_PIPE_RE = re.compile(r"(?<!\\)\|")


def _chunks_from_archive(repo_root: Path) -> list[Chunk]:
    """One chunk per data row of each monthly archive index table
    (ARCHIVE_INDEX_GLOB). Cell 1 is a dense per-cycle decision summary
    ("why did we do X") — the whole cell is the chunk text; the feature
    name (first token before '(') is the heading + id slug."""
    out: list[Chunk] = []
    seen_ids: set[str] = set()
    for path in sorted(repo_root.glob(ARCHIVE_INDEX_GLOB)):
        month = path.parent.name
        for ln in path.read_text(encoding="utf-8").splitlines():
            ln = ln.strip()
            if not ln.startswith("|"):
                continue
            cells = _UNESCAPED_PIPE_RE.split(ln)[1:-1]
            if len(cells) < 4:
                continue
            # Anchor on the last 3 columns (match / date / path) — feature
            # cells occasionally contain a raw `|` (e.g. "(string | {...})"),
            # so everything before them is rejoined as cell 1.
            feature_cell = "|".join(cells[:-3]).strip()
            match_cell = cells[-3].strip()
            date_cell = cells[-2].strip()
            if not feature_cell:
                continue
            # Skip the header row ("| feature |" / "| Feature |") and the
            # divider row ("| --- |" / "| :---: |").
            if feature_cell.lower().startswith("feature"):
                continue
            if set(feature_cell) <= {"-", ":"}:
                continue
            name_part = feature_cell.split("(", 1)[0].strip()
            if not name_part:
                continue
            feature = name_part.split()[0]
            base_id = f"archive#{month}-{_slugify(feature)}"
            if base_id in seen_ids:  # same feature twice within a month
                n = 2
                while f"{base_id}-{n}" in seen_ids:
                    n += 1
                base_id = f"{base_id}-{n}"
            seen_ids.add(base_id)
            text = feature_cell.replace("\\|", "|")
            for piece_idx, piece in enumerate(_split_long(text)):
                cid = base_id + (f"-cont{piece_idx}" if piece_idx else "")
                out.append(Chunk(
                    id=cid,
                    source="archive",
                    heading=feature,
                    text=piece,
                    metadata={
                        "month": month,
                        "match": match_cell,
                        "date": date_cell,
                    },
                ))
    return out


# ── 5. examples (build_examples.py fixtures) ──────────────────────────

# We intentionally don't import build_examples.py — it touches the real
# docx_export pipeline and pulls in app.services.* modules. Instead we
# parse the AST and pull literal block dicts from the three top-level
# fixture functions. This keeps the chunker stdlib-only.

_EXAMPLE_FUNCS: dict[str, str] = {
    "good": "good_example",
    "all": "all_widgets_example",
    "bad": "bad_example",
}


def _is_string_call_id(node: ast.AST) -> bool:
    """Recognise the ``_u()`` placeholder so we can render it as ``<id>``
    without evaluating it."""
    return (
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id == "_u"
        and not node.args
        and not node.keywords
    )


def _literal(node: ast.AST) -> Any:
    """Best-effort literal eval that tolerates the ``_u()`` placeholder."""
    if _is_string_call_id(node):
        return "<id>"
    if isinstance(node, ast.Constant):
        return node.value
    if isinstance(node, (ast.List, ast.Tuple)):
        return [_literal(e) for e in node.elts]
    if isinstance(node, ast.Dict):
        return {_literal(k): _literal(v) for k, v in zip(node.keys, node.values)}
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub):
        v = _literal(node.operand)
        return -v if isinstance(v, (int, float)) else None
    return None


def _block_summary(block: dict[str, Any]) -> str:
    """One-line textual summary of a block fixture (chunk text body)."""
    t = block.get("type", "?")
    if t == "callout":
        return f"callout {block.get('variant', 'info')}: {block.get('text', '')}"
    if t == "kpi-cards":
        items = block.get("items") or []
        labels = ", ".join(str((i or {}).get("label", "")) for i in items)
        return f"kpi-cards items=[{labels}]"
    if t == "chart":
        data = block.get("data") or {}
        labels = data.get("labels") or []
        series = data.get("series") or []
        snames = "+".join(str((s or {}).get("name", "")) for s in series)
        ltext = ".." .join([str(labels[0]) if labels else "", str(labels[-1]) if labels else ""])
        return (
            f"chart {block.get('chartType', '?')}, "
            f"labels={ltext} ({len(labels)} pts), series={snames}"
        )
    if t == "gantt":
        tasks = block.get("tasks") or []
        names = ", ".join(str(tk.get("name", "")) for tk in tasks)
        return f"gantt tasks=[{names}]"
    if t == "flow":
        src = (block.get("source") or "").splitlines()[0]
        return f"flow {block.get('engine', 'mermaid')} source first-line: {src}"
    if t == "org-chart":
        root = block.get("root") or {}
        return f"org-chart root.label={root.get('label', '')}"
    if t == "iframe":
        return f"iframe src={block.get('src', '')}"
    if t == "video":
        return f"video provider={block.get('provider', '?')} url={block.get('url', '')}"
    if t == "file":
        return f"file name={block.get('name', '')}"
    if t == "pdf":
        return f"pdf title={block.get('title', '')}"
    if t == "doc-link-card":
        return f"doc-link-card slug={block.get('slug', '')}"
    if t == "glossary-ref":
        return f"glossary-ref term={block.get('term', '')}"
    if t == "tabs":
        labels = ", ".join(str((tab or {}).get("label", "")) for tab in (block.get("tabs") or []))
        return f"tabs labels=[{labels}]"
    if t == "accordion":
        labels = ", ".join(str((it or {}).get("label", "")) for it in (block.get("items") or []))
        return f"accordion items=[{labels}]"
    if t == "columns":
        cols = block.get("columns") or []
        return f"columns count={len(cols)}"
    if t == "gallery":
        items = block.get("items") or []
        return f"gallery layout={block.get('layout', 'grid')} count={len(items)}"
    if t == "image-annotation":
        anns = block.get("annotations") or []
        return f"image-annotation annotations={len(anns)}"
    if t == "whiteboard":
        elems = block.get("elements") or []
        vb = block.get("viewbox") or {}
        return f"whiteboard viewbox={vb.get('w', '?')}x{vb.get('h', '?')} elements={len(elems)}"
    if t == "paragraph":
        return f"paragraph: {block.get('text', '')}"
    return f"{t}: {json.dumps(block, ensure_ascii=False)[:120]}"


def _gather_blocks_from_func(
    tree: ast.Module, func_name: str, all_funcs: dict[str, ast.FunctionDef]
) -> list[dict[str, Any]]:
    """Resolve a fixture function's returned block list. Handles the
    ``all_widgets_example`` case which delegates to ``good_example``."""
    fn = all_funcs.get(func_name)
    if fn is None:
        return []

    # First gather any block-list literals from this function.
    blocks: list[dict[str, Any]] = []
    has_extension = False

    # Walk: look for either `return _doc(..., [LIST])` or
    # `blocks.extend([LIST])` after a delegation call.
    for node in ast.walk(fn):
        # Handle `blocks.extend([...])`.
        if (
            isinstance(node, ast.Expr)
            and isinstance(node.value, ast.Call)
            and isinstance(node.value.func, ast.Attribute)
            and node.value.func.attr == "extend"
            and node.value.args
            and isinstance(node.value.args[0], ast.List)
        ):
            for el in node.value.args[0].elts:
                lit = _literal(el)
                if isinstance(lit, dict):
                    blocks.append(lit)
            has_extension = True

    # Handle the inheritance pattern: blocks = good_example()["sections"][0]["blocks"]
    for node in ast.walk(fn):
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id == "blocks":
                    # Look inside the value for a Call node referring to a
                    # known fixture (e.g. good_example()).
                    for inner in ast.walk(node.value):
                        if (
                            isinstance(inner, ast.Call)
                            and isinstance(inner.func, ast.Name)
                            and inner.func.id in all_funcs
                            and inner.func.id != func_name
                        ):
                            blocks = _gather_blocks_from_func(tree, inner.func.id, all_funcs) + blocks

    # If no extension/inheritance pattern, walk the return _doc(..., [...]) call.
    if not blocks or not has_extension:
        for node in ast.walk(fn):
            if isinstance(node, ast.Return) and isinstance(node.value, ast.Call):
                call = node.value
                # Look for a list literal among args.
                for arg in call.args:
                    if isinstance(arg, ast.List):
                        for el in arg.elts:
                            lit = _literal(el)
                            if isinstance(lit, dict):
                                blocks.append(lit)
                        # Stop after the first list.
                        return blocks

    return blocks


def _chunks_from_examples(repo_root: Path) -> list[Chunk]:
    path = repo_root / "dist" / "llm-docx-toolkit" / "examples" / "build_examples.py"
    if not path.exists():
        return []
    src = path.read_text(encoding="utf-8")
    tree = ast.parse(src)
    funcs: dict[str, ast.FunctionDef] = {
        n.name: n for n in tree.body if isinstance(n, ast.FunctionDef)
    }

    out: list[Chunk] = []
    for tag, fn_name in _EXAMPLE_FUNCS.items():
        blocks = _gather_blocks_from_func(tree, fn_name, funcs)
        # Index counter per (tag, type) so multiple instances stay distinct.
        type_counter: dict[str, int] = {}
        for blk in blocks:
            if not isinstance(blk, dict):
                continue
            wtype = blk.get("type")
            if not isinstance(wtype, str):
                continue
            n = type_counter.get(wtype, 0)
            type_counter[wtype] = n + 1
            suffix = f"-{n}" if n else ""
            cid = f"example:{tag}#{wtype}{suffix}"
            text = f"Example ({tag}): {_block_summary(blk)}"
            out.append(Chunk(
                id=cid,
                source=f"example:{tag}",
                heading=f"example {tag}: {wtype}",
                text=text,
                metadata={"example": tag, "widget_type": wtype},
            ))
    return out


# ── 6. glossary (DB-backed — approved terms) ──────────────────────────


def _glossary_database_url() -> str | None:
    """Resolve a *sync* asyncpg-compatible URL for the chunker. We accept the
    same env var apps/api uses (`DATABASE_URL`) but strip the SQLAlchemy
    dialect prefix because asyncpg.connect speaks plain DSN."""
    import os

    raw = os.environ.get("DATABASE_URL") or os.environ.get("MXWP_DATABASE_URL")
    if not raw:
        return None
    # postgresql+asyncpg://user:pw@host:port/db  →  postgresql://user:pw@host:port/db
    if raw.startswith("postgresql+asyncpg://"):
        return "postgresql://" + raw[len("postgresql+asyncpg://"):]
    if raw.startswith("postgres+asyncpg://"):
        return "postgres://" + raw[len("postgres+asyncpg://"):]
    return raw


def _fetch_glossary_rows(dsn: str) -> list[dict[str, Any]]:
    """Pull approved terms from `terms` joined to `term_domains` for the
    domain display name. Returns plain dicts (no driver objects) so the
    caller can stay sync-friendly."""
    import asyncio

    import asyncpg  # type: ignore[import-not-found]

    async def _go() -> list[dict[str, Any]]:
        conn = await asyncpg.connect(dsn)
        try:
            # term_en / aliases were added in 0048; columns may be absent on
            # older deployments. We guard so a stale DB doesn't crash the
            # chunker — it just yields fewer chunks.
            cols = await conn.fetch(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name = 'terms'"
            )
            colset = {r["column_name"] for r in cols}
            if not {"status", "domain", "aliases"}.issubset(colset):
                return []
            term_en_sql = "t.term_en" if "term_en" in colset else "NULL"
            rows = await conn.fetch(
                f"""
                SELECT
                  t.term,
                  t.definition,
                  t.domain,
                  COALESCE(d.name, t.domain) AS domain_name,
                  t.subdomain,
                  {term_en_sql} AS term_en,
                  t.aliases
                FROM terms t
                LEFT JOIN term_domains d ON d.slug = t.domain
                WHERE t.status = 'approved'
                ORDER BY COALESCE(t.domain, ''), t.term
                """
            )
            return [dict(r) for r in rows]
        finally:
            await conn.close()

    try:
        return asyncio.run(_go())
    except RuntimeError:
        # If a loop is already running (rare for the CLI), fall back to
        # creating a fresh loop. This keeps the function importable from
        # async contexts as well.
        loop = asyncio.new_event_loop()
        try:
            return loop.run_until_complete(_go())
        finally:
            loop.close()


def _chunks_from_glossary(*, verbose: bool = False) -> list[Chunk]:
    """Produce one chunk per approved term in the DB. Skips silently when
    DATABASE_URL is unset or the DB is unreachable — the chunker still
    succeeds for file-based sources, mirroring how the optional
    llm-system-prompt source behaves."""
    dsn = _glossary_database_url()
    if not dsn:
        if verbose:
            print("  glossary: DATABASE_URL not set — skipping")
        return []
    try:
        rows = _fetch_glossary_rows(dsn)
    except Exception as e:  # noqa: BLE001 — DB unreachable is non-fatal here
        if verbose:
            print(f"  glossary: skipped ({type(e).__name__}: {e})")
        return []

    out: list[Chunk] = []
    for r in rows:
        term = r["term"]
        domain = r.get("domain") or "general"
        domain_name = r.get("domain_name") or domain
        definition = r.get("definition") or ""
        term_en = r.get("term_en")
        aliases = r.get("aliases") or []
        subdomain = r.get("subdomain")

        lines = [f"용어: {term}"]
        if term_en:
            lines.append(f"영문: {term_en}")
        if subdomain:
            lines.append(f"분야: {domain_name} / {subdomain}")
        else:
            lines.append(f"분야: {domain_name}")
        lines.append(f"정의: {definition}")
        if aliases:
            lines.append(f"동의어: {', '.join(aliases)}")
        text = "\n".join(lines)

        out.append(Chunk(
            id=f"glossary:{domain}:{_slugify(term)}",
            source="glossary",
            heading=f"glossary: {term} ({domain})",
            text=text,
            metadata={
                "term": term,
                "domain": domain,
                "subdomain": subdomain,
                "term_en": term_en,
                "aliases": list(aliases),
            },
        ))
    return out


# ── public API ────────────────────────────────────────────────────────


def build_chunks(repo_root: Path) -> list[Chunk]:
    """Walk all TRACKED_SOURCES under ``repo_root`` and return the chunk
    list, sorted by id for deterministic JSONL hashing."""
    chunks: list[Chunk] = []
    chunks.extend(_chunks_from_rules(repo_root))
    chunks.extend(_chunks_from_widget_markers(repo_root))
    chunks.extend(_chunks_from_schema(repo_root))
    chunks.extend(_chunks_from_system_prompt(repo_root))
    chunks.extend(_chunks_from_viewer_guide(repo_root))
    chunks.extend(_chunks_from_archive(repo_root))
    chunks.extend(_chunks_from_examples(repo_root))
    chunks.extend(_chunks_from_glossary())
    chunks.sort(key=lambda c: c.id)
    return chunks


def write_chunks_jsonl(chunks: list[Chunk], out_path: Path) -> str:
    """Write chunks to JSONL (one chunk per line, UTF-8). Returns the
    SHA-256 hex of the file."""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    h = hashlib.sha256()
    with out_path.open("wb") as f:
        for c in chunks:
            line = (c.to_json_line() + "\n").encode("utf-8")
            f.write(line)
            h.update(line)
    return h.hexdigest()


# ── CLI ────────────────────────────────────────────────────────────────


def _autodetect_repo_root() -> Path:
    """Climb from this file: rag/ → llm-docx-toolkit/ → dist/ → repo root."""
    return Path(__file__).resolve().parents[3]


def _extract_export_marker_types(repo_root: Path) -> list[str]:
    """AST-parse widget_markers.py and eval the ``_EXPORT_MARKER_TYPES`` set
    literal. We use ast (not import) so the chunker stays stdlib-only and
    doesn't need the rest of apps/api on sys.path."""
    path = repo_root / "apps" / "api" / "app" / "services" / "widget_markers.py"
    if not path.exists():
        return []
    tree = ast.parse(path.read_text(encoding="utf-8"))
    for node in tree.body:
        if not isinstance(node, ast.AnnAssign) and not isinstance(node, ast.Assign):
            continue
        targets = [node.target] if isinstance(node, ast.AnnAssign) else node.targets
        for tgt in targets:
            if isinstance(tgt, ast.Name) and tgt.id == "_EXPORT_MARKER_TYPES":
                value = node.value
                # The source is `frozenset({"a", "b", ...})` — unwrap the call.
                if (
                    isinstance(value, ast.Call)
                    and isinstance(value.func, ast.Name)
                    and value.func.id == "frozenset"
                    and value.args
                    and isinstance(value.args[0], ast.Set)
                ):
                    elems = value.args[0].elts
                elif isinstance(value, ast.Set):
                    elems = value.elts
                else:
                    continue
                out: list[str] = []
                for el in elems:
                    if isinstance(el, ast.Constant) and isinstance(el.value, str):
                        out.append(el.value)
                return out
    return []


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="chunker.py", description=__doc__)
    p.add_argument("--repo", type=Path, default=None,
                   help="Repo root (default: auto-detected from this file's path)")
    p.add_argument("--out", type=Path, default=None,
                   help="Output JSONL path (default: ./chunks.jsonl next to chunker.py)")
    p.add_argument(
        "--check", action="store_true",
        help="Don't regenerate. Read existing index.lock and exit 1 if any "
             "tracked source hash drifted vs the live repo.",
    )
    args = p.parse_args(argv)

    repo_root = args.repo or _autodetect_repo_root()
    out_path = args.out or (Path(__file__).resolve().parent / "chunks.jsonl")
    lock_path = out_path.parent / "index.lock"

    if args.check:
        return _check_lock(repo_root, out_path, lock_path)

    chunks = build_chunks(repo_root)
    sha = write_chunks_jsonl(chunks, out_path)

    # Lock only covers chunk-set integrity. The embedding step (st/openai/bm25)
    # writes its own backend-specific files alongside; the embedding fingerprint
    # is therefore a constant placeholder here. Embedding tools may rewrite
    # this lock with their real fingerprint after they run.
    write_lock(
        lock_path,
        source_hashes=collect_source_hashes(repo_root),
        widget_types=_extract_export_marker_types(repo_root),
        chunk_count=len(chunks),
        embedding_backend_fingerprint="chunks-only:v1",
        chunks_sha256=sha,
        sources=sorted({c.source for c in chunks}),
    )

    by_source: dict[str, int] = {}
    for c in chunks:
        by_source[c.source] = by_source.get(c.source, 0) + 1

    rules_n = by_source.get("llm-input-rules.md", 0)
    widgets_n = by_source.get("widget_markers.py", 0)
    schema_n = by_source.get("document.json", 0)
    prompt_n = by_source.get("llm-system-prompt.md", 0)
    viewer_n = by_source.get("llm-viewer-guide.md", 0)
    archive_n = by_source.get("archive", 0)
    glossary_n = by_source.get("glossary", 0)
    examples_n = sum(v for k, v in by_source.items() if k.startswith("example:"))

    prompt_path = repo_root / "dist" / "llm-docx-toolkit" / "llm-system-prompt.md"
    prompt_label = (
        f"{prompt_n}" if prompt_path.exists() else "skipped — file missing"
    )
    if _glossary_database_url():
        glossary_label = f"{glossary_n}"
    else:
        glossary_label = "skipped — DATABASE_URL unset"

    print(f"wrote {len(chunks)} chunks to {out_path} (sha={sha})")
    print(f"wrote lock     to {lock_path}")
    print("== chunker.py result ==")
    print(f"total chunks: {len(chunks)}")
    print("by source:")
    print(f"  llm-input-rules.md: {rules_n}")
    print(f"  widget_markers.py: {widgets_n}")
    print(f"  document.json: {schema_n}")
    print(f"  llm-system-prompt.md: {prompt_label}")
    print(f"  llm-viewer-guide.md: {viewer_n}")
    print(f"  archive: {archive_n}")
    print(f"  glossary (DB): {glossary_label}")
    print(f"  examples: {examples_n}")
    print(f"sha256: {sha}")
    return 0


def _check_lock(repo_root: Path, chunks_path: Path, lock_path: Path) -> int:
    """--check mode: compare lock vs live repo + chunks file. 0 = match,
    1 = drift (printing the offending paths to stderr)."""
    lock = read_lock(lock_path)
    if lock is None:
        print(f"✗ no readable index.lock at {lock_path}", file=sys.stderr)
        return 1
    expected_sources = lock.get("source_hashes") or {}
    actual_sources = collect_source_hashes(repo_root)
    drift = diff_hashes(expected_sources, actual_sources)

    chunks_drift: tuple[str, str] | None = None
    if chunks_path.exists():
        expected_chunks = lock.get("chunks_sha256")
        actual_chunks = hash_file(chunks_path)
        if expected_chunks and expected_chunks != actual_chunks:
            chunks_drift = (expected_chunks, actual_chunks)

    if not drift and chunks_drift is None:
        return 0

    print("✗ RAG index.lock is stale:", file=sys.stderr)
    for path, (want, got) in sorted(drift.items()):
        print(f"    {path}: lock={want[:8]}... live={got[:8]}...", file=sys.stderr)
    if chunks_drift is not None:
        want, got = chunks_drift
        print(
            f"    chunks.jsonl: lock={want[:8]}... live={got[:8]}...",
            file=sys.stderr,
        )
    print("    Run: python dist/llm-docx-toolkit/rag/chunker.py", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
