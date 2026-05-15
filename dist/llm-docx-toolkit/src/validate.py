"""mxwp-validator — standalone CLI to validate a .docx for MXWhitePaper import.

What it does, in order:

1. Parse the .docx through the *real* MXWhitePaper docx_import pipeline
   (the same code the server runs), with a stubbed-out settings module.
2. Run the widget marker + autodetect post-passes — so callouts, charts,
   gantts, etc. are reconstructed exactly like a live import.
3. Validate the resulting DocumentJSON against the v1.0 schema.
4. Emit a JSON file with the reconstructed document, the import summary
   (warnings, captured images, etc.), and any schema violations.
5. Print a human-readable report listing each widget that survived, each
   warning, each schema error.

Exit codes:
  0 — schema valid, no errors. May still have warnings.
  1 — schema validation failed (document would be REJECTED by the server).
  2 — docx parsing crashed (file is malformed beyond best-effort recovery).
  3 — usage / I/O error.
"""
from __future__ import annotations

import argparse
import io
import json
import sys
import zipfile
from pathlib import Path
from typing import Any

# Local toolkit modules (sibling files under PyInstaller's resource dir).
# The PyInstaller spec adds the src/ folder to sys.path so these imports
# work whether we're running from source or from the frozen binary.
import docx_import as _docx_import  # type: ignore[import-not-found]


SCHEMA_FILENAME = "document.schema.json"


# ── pretty-print helpers ────────────────────────────────────────────


_OK = "\033[32m✓\033[0m"
_WARN = "\033[33m!\033[0m"
_ERR = "\033[31m✗\033[0m"


def _supports_color() -> bool:
    return sys.stdout.isatty()


def _ok(s: str) -> str:
    return f"{_OK} {s}" if _supports_color() else f"[OK] {s}"


def _warn(s: str) -> str:
    return f"{_WARN} {s}" if _supports_color() else f"[!] {s}"


def _err(s: str) -> str:
    return f"{_ERR} {s}" if _supports_color() else f"[X] {s}"


# ── schema validation ───────────────────────────────────────────────


def _load_schema() -> dict[str, Any]:
    # Try PyInstaller's _MEIPASS first (where --add-data lands), then the
    # script's sibling folder for from-source runs, then the repo's
    # canonical path (developer running from a checkout).
    candidates: list[Path] = []
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        candidates.append(Path(meipass) / SCHEMA_FILENAME)
        # PyInstaller may also stash it as `document.json` under add-data root.
        candidates.append(Path(meipass) / "document.json")
    here = Path(__file__).resolve().parent
    candidates.append(here / SCHEMA_FILENAME)
    candidates.append(here / "document.json")
    # Developer-checkout fallback.
    repo_schema = here.parent.parent.parent / "packages" / "shared" / "schemas" / "document.json"
    candidates.append(repo_schema)
    for p in candidates:
        if p.exists():
            return json.loads(p.read_text(encoding="utf-8"))
    raise RuntimeError(
        f"schema file not found in any of: {[str(p) for p in candidates]}"
    )


def _validate_against_schema(doc: dict[str, Any], schema: dict[str, Any]) -> list[str]:
    """Validate without pulling in heavyweight pydantic. Uses `jsonschema`
    if available, falls back to a minimal structural check otherwise."""
    try:
        import jsonschema  # type: ignore[import-not-found]
    except ImportError:
        return _structural_check(doc)
    validator = jsonschema.Draft202012Validator(schema)
    errors: list[str] = []
    for err in validator.iter_errors(doc):
        path = "/".join(str(p) for p in err.absolute_path) or "(root)"
        errors.append(f"{path}: {err.message}")
    return errors


def _structural_check(doc: dict[str, Any]) -> list[str]:
    """Fallback when jsonschema isn't bundled. Catches the obvious gaps."""
    errors: list[str] = []
    for key in ("schema_version", "id", "slug", "title", "metadata", "sections"):
        if key not in doc:
            errors.append(f"(root): missing required field '{key}'")
    if doc.get("schema_version") != "1.0":
        errors.append(f"schema_version: expected '1.0', got {doc.get('schema_version')!r}")
    return errors


# ── widget inventory & rule checks ──────────────────────────────────


_AUTODETECTABLE = {"callout", "kpi-cards", "gantt", "gallery"}


def _walk_blocks(sections: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for s in sections or []:
        for b in s.get("blocks") or []:
            if isinstance(b, dict):
                out.append(b)
        out.extend(_walk_blocks(s.get("subsections") or []))
    return out


def _count_widgets(blocks: list[dict[str, Any]]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for b in blocks:
        t = b.get("type")
        if isinstance(t, str):
            counts[t] = counts.get(t, 0) + 1
    return counts


# ── CLI ─────────────────────────────────────────────────────────────


def _looks_like_docx(buf: bytes) -> bool:
    if buf[:4] != b"PK\x03\x04":
        return False
    try:
        with zipfile.ZipFile(io.BytesIO(buf)) as zf:
            return "word/document.xml" in zf.namelist()
    except zipfile.BadZipFile:
        return False


def _import_docx(buf: bytes, slug: str) -> dict[str, Any]:
    """Run the import pipeline with no image uploader and a placeholder
    owner — the toolkit doesn't have a real DB."""
    return _docx_import.docx_to_document(
        buf,
        slug=slug,
        title="",
        owner_user_id="01TEST00000000000000000000",
    )


def cmd_validate(args: argparse.Namespace) -> int:
    in_path = Path(args.input).expanduser()
    if not in_path.exists():
        print(_err(f"input file not found: {in_path}"), file=sys.stderr)
        return 3
    buf = in_path.read_bytes()
    if not _looks_like_docx(buf):
        print(_err("file is not a valid .docx (missing PK zip magic / word/document.xml)"), file=sys.stderr)
        return 2

    try:
        result = _import_docx(buf, slug=in_path.stem or "doc")
    except Exception as exc:
        print(_err(f"docx parsing crashed: {exc}"), file=sys.stderr)
        return 2

    doc = result["document"]
    summary = result["summary"]
    warnings = list(getattr(summary, "warnings", []) or [])

    schema_errors: list[str]
    try:
        schema = _load_schema()
        schema_errors = _validate_against_schema(doc, schema)
    except Exception as exc:
        print(_err(f"schema load/validate failed: {exc}"), file=sys.stderr)
        return 3

    # Build the JSON output.
    blocks = _walk_blocks(doc.get("sections") or [])
    widget_counts = _count_widgets(blocks)
    auto_detected = [w for w in warnings if w.startswith("auto-detected")]
    placeholder_warns = [w for w in warnings if "placeholder" in w.lower()]
    other_warns = [w for w in warnings if w not in auto_detected and w not in placeholder_warns]

    out_payload: dict[str, Any] = {
        "input": str(in_path),
        "schema_valid": len(schema_errors) == 0,
        "schema_errors": schema_errors,
        "widget_counts": widget_counts,
        "section_count": len(doc.get("sections") or []),
        "block_count": len(blocks),
        "warnings": {
            "auto_detected": auto_detected,
            "placeholders": placeholder_warns,
            "other": other_warns,
        },
        "document": doc,
    }

    out_path = Path(args.output).expanduser() if args.output else in_path.with_suffix(".json")
    out_path.write_text(json.dumps(out_payload, ensure_ascii=False, indent=2), encoding="utf-8")

    # Human-readable summary.
    print()
    print(f"input        : {in_path}")
    print(f"output JSON  : {out_path}")
    print(f"sections     : {len(doc.get('sections') or [])}")
    print(f"blocks total : {len(blocks)}")
    print()

    if widget_counts:
        print("Widget inventory (block type → count):")
        for t in sorted(widget_counts):
            c = widget_counts[t]
            marker = _ok if t in _AUTODETECTABLE or t.startswith("Widget") else " "
            print(f"  {t:<24} {c:>3}")
    else:
        print(_warn("no blocks recovered — is the docx empty?"))
    print()

    if auto_detected:
        print(f"Autodetected widgets ({len(auto_detected)}):")
        for w in auto_detected:
            print(f"  {_ok(w)}")
        print()
    if placeholder_warns:
        print(f"Placeholders emitted ({len(placeholder_warns)}):")
        for w in placeholder_warns:
            print(f"  {_warn(w)}")
        print()
    if other_warns:
        print(f"Other warnings ({len(other_warns)}):")
        for w in other_warns:
            print(f"  {_warn(w)}")
        print()

    if schema_errors:
        print(_err(f"Schema validation FAILED ({len(schema_errors)} errors):"))
        for e in schema_errors:
            print(f"  {e}")
        print()
        print(_err("⛔ Document would be REJECTED by the MXWhitePaper server."))
        return 1

    print(_ok("Schema valid. Document is import-ready."))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        prog="mxwp-validator",
        description="Validate a .docx for MXWhitePaper import (offline, no server).",
    )
    parser.add_argument("input", help="Path to .docx file")
    parser.add_argument(
        "-o", "--output", default=None,
        help="Path to write the JSON dump (default: <input>.json next to the input)"
    )
    parser.add_argument(
        "--version", action="version", version="mxwp-validator 1.0.0",
    )
    args = parser.parse_args()
    args.func = cmd_validate  # single subcommand for now
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
