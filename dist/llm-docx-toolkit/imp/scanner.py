"""Folder scan → ordered list of WorkItem.

Pairing rule: for each `<stem>.docx`, look for a sibling `<stem>.json`.
If the json carries a `slug` field, that wins; otherwise the slug is
derived from the stem via the same `_slugify` rules as the server
(`apps/api/app/routers/imports.py:_derive_slug`).

We deliberately do NOT validate the docx here — that's the server's job
(POST /imports/docx). The CLI only enforces a cheap pre-flight: PK zip
magic + word/document.xml. Anything heavier would duplicate the
mxwp-validator binary's logic.
"""
from __future__ import annotations

import json
import re
import zipfile
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

from .config import Config


@dataclass(frozen=True)
class WorkItem:
    docx: Path
    json: Path | None
    slug: str
    title: str


# ─── slug ─────────────────────────────────────────────────────────────


_SLUG_NON_ALLOWED = re.compile(r"[^a-z0-9가-힣\-]+")
_SLUG_COLLAPSE = re.compile(r"-+")


def _slugify(name: str) -> str:
    """File name (with or without extension) → URL-safe slug.

    Mirrors `apps/api/app/routers/imports.py:_derive_slug` so a client-side
    pre-check matches the server's eventual placement. Korean syllables
    (가-힣) are preserved; everything else is collapsed to '-'.
    """
    base = name.rsplit(".", 1)[0]
    base = base.lower().strip()
    base = _SLUG_NON_ALLOWED.sub("-", base)
    base = _SLUG_COLLAPSE.sub("-", base).strip("-")
    if not base:
        base = "imported"
    return base[:100]


# ─── pairing ──────────────────────────────────────────────────────────


def _read_json_meta(path: Path) -> dict[str, object]:
    """Best-effort JSON read. Returns {} on parse / read error so a
    malformed sidecar can't poison the whole run — uploader will fall
    back to defaults."""
    try:
        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError):
        return {}
    if not isinstance(data, dict):
        return {}
    return data


def _matches_excludes(path: Path, patterns: list[str]) -> bool:
    """`fnmatch`-style globs are matched against the file's name (not the
    full path) so users can write `*.tmp.docx` without worrying about
    directory components."""
    if not patterns:
        return False
    from fnmatch import fnmatch

    name = path.name
    return any(fnmatch(name, pat) for pat in patterns)


def _looks_like_docx(path: Path) -> bool:
    """PK zip magic + word/document.xml. Lighter than fully validating
    via mxwp-validator but catches the "renamed .pdf to .docx" case."""
    try:
        with path.open("rb") as f:
            head = f.read(4)
            if head != b"PK\x03\x04":
                return False
            # Re-open for zipfile (it needs to seek from 0).
        with zipfile.ZipFile(path) as zf:
            return "word/document.xml" in zf.namelist()
    except (OSError, zipfile.BadZipFile):
        return False


def _make_item(docx: Path) -> WorkItem | None:
    json_path = docx.with_suffix(".json")
    meta = _read_json_meta(json_path) if json_path.exists() else {}
    json_for_item: Path | None = json_path if json_path.exists() else None

    raw_slug = meta.get("slug")
    slug = raw_slug if isinstance(raw_slug, str) and raw_slug else _slugify(docx.stem)

    raw_title = meta.get("title")
    title = raw_title if isinstance(raw_title, str) and raw_title else docx.stem

    return WorkItem(docx=docx, json=json_for_item, slug=slug, title=title)


# ─── public ───────────────────────────────────────────────────────────


class ScanError(RuntimeError):
    """Raised when the source path is unusable. CLI maps to exit 2."""


def scan(cfg: Config) -> Iterator[WorkItem]:
    """Yield WorkItems for every matching .docx under `cfg.source_path`.

    Ordering is stable (sorted by path) so reruns / `--resume` see the
    same sequence — important for `mxwp-import.failed.txt` to line up
    with `mxwp-import.log` line numbers.
    """
    src = cfg.source_path
    if not src.exists():
        raise ScanError(f"source path does not exist: {src}")
    if not src.is_dir():
        raise ScanError(f"source path is not a directory: {src}")

    matches = sorted(src.rglob(cfg.pattern))
    count = 0
    for docx in matches:
        if not docx.is_file():
            continue
        if _matches_excludes(docx, cfg.exclude_patterns):
            continue
        # `_looks_like_docx` rejects the obvious renamed-PDF case; the
        # server's full validator catches structural OOXML issues later.
        if not _looks_like_docx(docx):
            continue
        item = _make_item(docx)
        if item is None:
            continue
        yield item
        count += 1
        if cfg.limit and count >= cfg.limit:
            return


# Exposed for tests so they can call `_slugify` without poking at private
# names from import paths.
__all__ = ["ScanError", "WorkItem", "_slugify", "scan"]
