"""Variable substitution helpers for DocumentJSON exports.

Token grammar (matches the FE renderer in `Inline.tsx`):
    {{name}}            → variables[name]
    {{name|fallback}}   → variables[name] if defined, else literal `fallback`

Name = alphanumeric + underscore + hyphen. Unknown variables WITHOUT a fallback
remain as-is so the user can spot what's missing in the rendered output.

Code blocks are deliberately skipped — `walk_doc_substitute` does NOT touch
the `code` field on `code` blocks (matching the FE rule "skip <pre><code>").
"""
from __future__ import annotations

import copy
import re
from typing import Any

# Keep this regex in lock-step with `VAR_NAME_RE` in `apps/web/.../Inline.tsx`.
_TOKEN_RE = re.compile(r"\{\{([A-Za-z0-9_-]+)(?:\|([^}]*))?\}\}")


def substitute(text: str, variables: dict[str, str] | None) -> str:
    """Replace `{{var}}` tokens in `text` using `variables`.

    Resolution: variables[name] > literal fallback > original token. Returns
    the input unchanged when no token matches (so callers can pass it through
    unconditionally without an extra is-empty check).
    """
    if not text or not isinstance(text, str):
        return text
    if not variables:
        # Still resolve `{{name|fallback}}` defaults — a doc with zero variables
        # should still render fallbacks. Skip the whole pass when text has no
        # `{{` for the common case.
        if "{{" not in text:
            return text

    def repl(m: re.Match[str]) -> str:
        name = m.group(1)
        fallback = m.group(2)
        if variables and name in variables:
            return variables[name]
        if fallback is not None:
            return fallback
        return m.group(0)

    return _TOKEN_RE.sub(repl, text)


# ── Document walker ─────────────────────────────────────────────────


def walk_doc_substitute(
    doc: dict[str, Any], variables: dict[str, str] | None
) -> dict[str, Any]:
    """Return a deep-copy of `doc` with every text-bearing field substituted.

    Block coverage:
      - paragraph.text, heading-4.title, quote.text, quote.cite
      - callout.title, callout.text
      - list.items (string OR {text, depth} legacy shape)
      - table.headers, table.rows[*]
      - columns/tabs/accordion → recurse into nested blocks
      - kpi-cards.items[*].label / value (string only)

    Skipped (intentional):
      - code blocks (`code.code` + `code.filename`)
      - math expressions (LaTeX braces would be mangled)
      - chart / gantt / flow / dashboard data structures
      - section.title (titles travel with sections; a doc author can put
        `{{var}}` inside a heading-4 block instead)

    `variables` may be None — in that case fallbacks still resolve so a doc
    with `{{name|기본}}` and no variables map renders `기본`.
    """
    if not doc:
        return doc
    out = copy.deepcopy(doc)
    for sec in out.get("sections") or []:
        _walk_section(sec, variables)
    return out


def _walk_section(sec: dict[str, Any], variables: dict[str, str] | None) -> None:
    if not isinstance(sec, dict):
        return
    if isinstance(sec.get("title"), str):
        sec["title"] = substitute(sec["title"], variables)
    for b in sec.get("blocks") or []:
        _walk_block(b, variables)
    for sub in sec.get("subsections") or []:
        _walk_section(sub, variables)


def _walk_block(block: dict[str, Any], variables: dict[str, str] | None) -> None:
    if not isinstance(block, dict):
        return
    btype = block.get("type")
    if btype == "code":
        # Code blocks preserve their literal `{{var}}` text (intentional).
        return
    if isinstance(block.get("text"), str):
        block["text"] = substitute(block["text"], variables)
    if isinstance(block.get("title"), str):
        block["title"] = substitute(block["title"], variables)
    if isinstance(block.get("cite"), str):
        block["cite"] = substitute(block["cite"], variables)
    if btype == "list":
        items = block.get("items") or []
        new_items: list[Any] = []
        for it in items:
            if isinstance(it, str):
                new_items.append(substitute(it, variables))
            elif isinstance(it, dict) and isinstance(it.get("text"), str):
                it["text"] = substitute(it["text"], variables)
                new_items.append(it)
            else:
                new_items.append(it)
        block["items"] = new_items
    elif btype == "table":
        headers = block.get("headers") or []
        block["headers"] = [
            substitute(h, variables) if isinstance(h, str) else h for h in headers
        ]
        rows = block.get("rows") or []
        block["rows"] = [
            [substitute(c, variables) if isinstance(c, str) else c for c in r]
            for r in rows
        ]
    elif btype == "kpi-cards":
        for it in block.get("items") or []:
            if isinstance(it, dict):
                if isinstance(it.get("label"), str):
                    it["label"] = substitute(it["label"], variables)
                if isinstance(it.get("value"), str):
                    it["value"] = substitute(it["value"], variables)
    elif btype == "columns":
        for col in block.get("columns") or []:
            for sub in col or []:
                _walk_block(sub, variables)
    elif btype == "tabs":
        for t in block.get("tabs") or []:
            for sub in (t or {}).get("blocks") or []:
                _walk_block(sub, variables)
    elif btype == "accordion":
        for it in block.get("items") or []:
            for sub in (it or {}).get("blocks") or []:
                _walk_block(sub, variables)
