"""coverage_check.py — verify every Block union type in document.json is
covered by the LLM-facing docs. CI fails when a new block type lands in the
schema without documentation.

Checks:
  - docs/llm-viewer-guide.md   → every type const must appear (block table)
  - docs/llm-input-rules.md    → widget blocks only; basic blocks handled by
                                 §1/§2 are whitelisted via NON_WIDGET

Exit codes: 0 = all covered, 1 = missing coverage, 2 = schema/doc unreadable.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

SCHEMA_RELPATH = "packages/shared/schemas/document.json"
DOCS = ("docs/llm-viewer-guide.md", "docs/llm-input-rules.md")

# Basic (non-widget) blocks. llm-input-rules.md §3 covers widget markers only;
# these are documented by its §1/§2 (문서 구조 / 일반 블록) and are exempt
# from the input-rules coverage requirement.
NON_WIDGET = frozenset({
    "paragraph",
    "heading-4",
    "list",
    "quote",
    "code",
    "math",
    "image",
    "table",
    "spreadsheet",
    "spacer",
    "bibliography",
    "figure-index",
    "form",
    "quiz",
    "calculator",
    "data-source",
    "dashboard-embed",
})


def _autodetect_repo_root() -> Path:
    """Climb from this file: rag/ → llm-docx-toolkit/ → dist/ → repo root."""
    return Path(__file__).resolve().parents[3]


def extract_block_types(schema_path: Path) -> list[str]:
    """Walk the Block union: each $ref → $defs entry → properties.type.const."""
    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    defs = schema.get("$defs") or {}
    union = (defs.get("Block") or {}).get("oneOf") or []
    types: list[str] = []
    for entry in union:
        ref = entry.get("$ref", "")
        def_name = ref.rsplit("/", 1)[-1]
        block = defs.get(def_name) or {}
        const = ((block.get("properties") or {}).get("type") or {}).get("const")
        if isinstance(const, str):
            types.append(const)
    return types


def _token_re(type_const: str) -> re.Pattern[str]:
    """Whole-token match: 'table' must not be satisfied by 'pivot-table',
    'list' must not be satisfied by 'checklist'. Hyphen counts as a word
    char so hyphenated consts stay atomic."""
    return re.compile(
        rf"(?<![A-Za-z0-9-]){re.escape(type_const)}(?![A-Za-z0-9-])"
    )


def missing_types(doc_text: str, types: list[str]) -> list[str]:
    return [t for t in types if not _token_re(t).search(doc_text)]


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="coverage_check.py", description=__doc__)
    p.add_argument("--quiet", action="store_true",
                   help="Skip the per-type matrix; print only the summary lines.")
    args = p.parse_args(argv)

    repo_root = _autodetect_repo_root()
    schema_path = repo_root / SCHEMA_RELPATH
    if not schema_path.exists():
        print(f"✗ schema not found: {schema_path}", file=sys.stderr)
        return 2

    types = extract_block_types(schema_path)
    if not types:
        print(f"✗ no Block union types extracted from {schema_path} — "
              "schema shape changed?", file=sys.stderr)
        return 2

    doc_texts: dict[str, str] = {}
    for rel in DOCS:
        path = repo_root / rel
        if not path.exists():
            print(f"✗ doc not found: {path}", file=sys.stderr)
            return 2
        doc_texts[rel] = path.read_text(encoding="utf-8")

    viewer_rel, rules_rel = DOCS
    viewer_missing = missing_types(doc_texts[viewer_rel], types)
    widget_types = [t for t in types if t not in NON_WIDGET]
    rules_missing = missing_types(doc_texts[rules_rel], widget_types)

    if not args.quiet:
        viewer_miss = set(viewer_missing)
        rules_miss = set(rules_missing)
        width = max(len(t) for t in types)
        print(f"{'block type'.ljust(width)}  viewer-guide  input-rules")
        for t in types:
            v = "✗" if t in viewer_miss else "✓"
            if t in NON_WIDGET:
                r = "—"
            else:
                r = "✗" if t in rules_miss else "✓"
            print(f"{t.ljust(width)}  {v}             {r}")
        print()

    ok = True
    if viewer_missing:
        ok = False
        print(f"✗ {viewer_rel} missing: {', '.join(viewer_missing)}")
    if rules_missing:
        ok = False
        print(f"✗ {rules_rel} missing: {', '.join(rules_missing)}")
    if ok:
        print(f"✓ {len(types)} blocks × {len(DOCS)} docs covered")
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
