"""index.lock — proof that the RAG index was built against a known set of
source files. Every push that touches widget definitions or import rules
MUST regenerate this lock; the build CI enforces it (see workflow + the
runtime stale check in cli.py).

Schema (JSON):
{
  "schema_version": 1,
  "generated_at": "2026-05-16T02:00:00Z",
  "source_hashes": {
    "<repo-relative path>": "<sha256>",
    ...
  },
  "widget_types": ["callout", "kpi-cards", ...],   # from _EXPORT_MARKER_TYPES
  "chunk_count": 47,
  "embedding_backend_fingerprint": "st:all-MiniLM-L6-v2:v3",
  "chunks_sha256": "<sha256 of chunks.jsonl>"
}
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


LOCK_SCHEMA_VERSION = 1


# Files whose content the RAG index reflects. ANY change here REQUIRES
# regenerating chunks + embeddings. Listed in build order (most-stable first).
#
# Glossary chunks (source="glossary") come from the live `terms` table — they
# are not file-backed so they cannot be hashed here. The `glossary` source is
# advertised in the lock's `sources` field instead (see chunker.py main()).
TRACKED_SOURCES = (
    "packages/shared/schemas/document.json",
    "apps/api/app/services/widget_markers.py",
    "apps/api/app/services/docx_import.py",
    "docs/llm-input-rules.md",
    "docs/llm-viewer-guide.md",
    "dist/llm-docx-toolkit/llm-system-prompt.md",
)


def hash_file(path: Path) -> str:
    """SHA-256 of file contents, hex-encoded. Returns 'missing' if absent."""
    if not path.exists():
        return "missing"
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def collect_source_hashes(repo_root: Path) -> dict[str, str]:
    """Hash every TRACKED_SOURCES path against repo_root. Returns
    {relative_path: sha256_hex}. Missing files map to 'missing'."""
    return {p: hash_file(repo_root / p) for p in TRACKED_SOURCES}


def write_lock(
    path: Path,
    *,
    source_hashes: dict[str, str],
    widget_types: list[str],
    chunk_count: int,
    embedding_backend_fingerprint: str,
    chunks_sha256: str,
    sources: list[str] | None = None,
) -> None:
    payload: dict[str, Any] = {
        "schema_version": LOCK_SCHEMA_VERSION,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source_hashes": source_hashes,
        "widget_types": sorted(widget_types),
        "chunk_count": chunk_count,
        "embedding_backend_fingerprint": embedding_backend_fingerprint,
        "chunks_sha256": chunks_sha256,
    }
    # Per-chunk-source label list (e.g. file paths + non-file "glossary" DB
    # source). Lets `cli.py --check` enumerate everything the index covers
    # without parsing chunks.jsonl. Only emitted when caller provides it so
    # older callers stay backward-compatible.
    if sources is not None:
        payload["sources"] = sorted(set(sources))
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def read_lock(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def diff_hashes(
    expected: dict[str, str], actual: dict[str, str]
) -> dict[str, tuple[str, str]]:
    """Return {path: (expected_hash, actual_hash)} for paths whose hash differs.
    Empty dict means lock matches reality."""
    out: dict[str, tuple[str, str]] = {}
    for p, want in expected.items():
        got = actual.get(p, "missing")
        if want != got:
            out[p] = (want, got)
    for p, got in actual.items():
        if p not in expected:
            out[p] = ("missing", got)
    return out
