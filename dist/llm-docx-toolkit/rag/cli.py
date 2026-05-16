"""mxwp-rules — CLI for the RAG toolkit.

Three subcommands:
  query  — Run a query against an on-disk index and print top-k hits.
  index  — Build (and optionally rebuild chunks first) an on-disk index.
  check  — Verify index.lock matches the live source files + chunks.jsonl.

Every subcommand returns an int exit code so ``sys.exit(main())`` works.
"""
from __future__ import annotations

import argparse
import io
import json
import os
import sys
from pathlib import Path
from typing import Any

# Windows console default is cp1252; force UTF-8 so glyphs in our human
# report (check marks, arrows) don't crash with UnicodeEncodeError.
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

# Late-binding so `python rag/cli.py` and `python -m rag` both work.
try:
    from .retriever import Chunk, Hit, Retriever
    from ._lock import (
        collect_source_hashes,
        diff_hashes,
        hash_file,
        read_lock,
        write_lock,
    )
    from . import chunker as _chunker
except ImportError:
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from retriever import Chunk, Hit, Retriever  # type: ignore[no-redef]
    from _lock import (  # type: ignore[no-redef]
        collect_source_hashes,
        diff_hashes,
        hash_file,
        read_lock,
        write_lock,
    )
    import chunker as _chunker  # type: ignore[no-redef]


# ── color helpers (mirrors src/validate.py) ─────────────────────────

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


# ── backend factory ─────────────────────────────────────────────────

_BACKENDS = ("st", "bm25", "openai")


def _make_backend(name: str) -> Retriever:
    # Lazy: only import the heavy modules for the chosen backend.
    if name == "bm25":
        from ._bm25 import BM25Retriever  # noqa: WPS433
        return BM25Retriever()
    if name == "st":
        from ._st import STRetriever  # noqa: WPS433
        return STRetriever()
    if name == "openai":
        from ._openai import OpenAIRetriever  # noqa: WPS433
        return OpenAIRetriever()
    raise ValueError(f"unknown backend: {name}")


def _load_chunks(rag_dir: Path) -> list[Chunk]:
    path = rag_dir / "chunks.jsonl"
    chunks: list[Chunk] = []
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            chunks.append(Chunk.from_json_line(line))
    return chunks


def _chunks_sha_matches_lock(rag_dir: Path) -> tuple[bool, str | None, str | None]:
    """Return (matches, expected, actual). matches=True when no chunks file
    or no lock entry to compare against (callers decide)."""
    lock = read_lock(rag_dir / "index.lock")
    if lock is None:
        return True, None, None
    expected = lock.get("chunks_sha256")
    if not expected:
        return True, None, None
    actual = hash_file(rag_dir / "chunks.jsonl")
    return expected == actual, expected, actual


# ── subcommand: query ───────────────────────────────────────────────


def _format_hits_table(hits: list[Hit]) -> str:
    if not hits:
        return "(no hits)"
    rows: list[tuple[str, str, str, str]] = [("#", "score", "id", "heading")]
    for i, h in enumerate(hits, 1):
        rows.append((str(i), f"{h.score:.4f}", h.chunk.id, h.chunk.heading))
    widths = [max(len(r[c]) for r in rows) for c in range(4)]
    lines: list[str] = []
    for ri, r in enumerate(rows):
        lines.append("  ".join(r[c].ljust(widths[c]) for c in range(4)))
        if ri == 0:
            lines.append("  ".join("-" * widths[c] for c in range(4)))
    return "\n".join(lines)


def _hits_to_json(hits: list[Hit]) -> str:
    payload = [
        {
            "score": h.score,
            "id": h.chunk.id,
            "source": h.chunk.source,
            "heading": h.chunk.heading,
            "text": h.chunk.text,
            "metadata": h.chunk.metadata,
        }
        for h in hits
    ]
    return json.dumps(payload, ensure_ascii=False, indent=2)


def cmd_query(args: argparse.Namespace) -> int:
    rag_dir = Path(args.rag_dir).resolve()

    # Layer 4 sync enforcement: refuse to serve queries from a tampered
    # chunks.jsonl. Backends were built against a specific hash; if the
    # text drifted we cannot trust the IDs returned by the retriever.
    ok, expected, actual = _chunks_sha_matches_lock(rag_dir)
    if not ok:
        print(
            _err(
                f"chunks.jsonl sha mismatch vs index.lock "
                f"(lock={expected[:8] if expected else '?'}... "
                f"actual={actual[:8] if actual else '?'}...). "
                f"Rebuild required: python -m rag index --backend {args.backend} --rebuild"
            ),
            file=sys.stderr,
        )
        return 1

    backend = _make_backend(args.backend)
    backend.load(rag_dir)
    hits = backend.query(args.text, k=args.k)

    if args.json:
        print(_hits_to_json(hits))
    else:
        print(_format_hits_table(hits))
    return 0


# ── subcommand: index ───────────────────────────────────────────────


def _maybe_rebuild_chunks(rag_dir: Path) -> tuple[list[Chunk], str]:
    """Rebuild chunks.jsonl from source. Returns (chunks, sha256)."""
    repo_root = _chunker._autodetect_repo_root()
    chunks = _chunker.build_chunks(repo_root)
    sha = _chunker.write_chunks_jsonl(chunks, rag_dir / "chunks.jsonl")
    return chunks, sha


def _build_one(
    backend_name: str, chunks: list[Chunk], rag_dir: Path
) -> str:
    """Build + save a single backend. Returns its fingerprint."""
    backend = _make_backend(backend_name)
    backend.index(chunks)
    if backend_name == "bm25":
        backend.save(rag_dir / "bm25.json")
    else:
        backend.save(rag_dir)
    return type(backend).fingerprint


def cmd_index(args: argparse.Namespace) -> int:
    rag_dir = Path(args.rag_dir).resolve()
    rag_dir.mkdir(parents=True, exist_ok=True)

    if args.rebuild:
        print(_ok(f"rebuilding chunks.jsonl in {rag_dir}"))
        chunks, chunks_sha = _maybe_rebuild_chunks(rag_dir)
    else:
        chunks_path = rag_dir / "chunks.jsonl"
        if not chunks_path.exists():
            print(_err(f"chunks.jsonl missing at {chunks_path} — pass --rebuild"),
                  file=sys.stderr)
            return 1
        chunks = _load_chunks(rag_dir)
        chunks_sha = hash_file(chunks_path)

    targets: list[str]
    if args.backend == "all":
        targets = ["st", "bm25"]
        if os.environ.get("OPENAI_API_KEY"):
            targets.append("openai")
        else:
            print(_warn("OPENAI_API_KEY not set — skipping openai backend"))
    else:
        targets = [args.backend]

    last_fingerprint = ""
    for name in targets:
        print(_ok(f"indexing backend: {name} ({len(chunks)} chunks)"))
        last_fingerprint = _build_one(name, chunks, rag_dir)
        print(_ok(f"  -> saved ({last_fingerprint})"))

    # write_lock only takes one fingerprint; record the last-built backend's.
    # When `--backend all`, that's openai (or bm25 if openai was skipped).
    repo_root = _chunker._autodetect_repo_root()
    write_lock(
        rag_dir / "index.lock",
        source_hashes=collect_source_hashes(repo_root),
        widget_types=_chunker._extract_export_marker_types(repo_root),
        chunk_count=len(chunks),
        embedding_backend_fingerprint=last_fingerprint or "chunks-only:v1",
        chunks_sha256=chunks_sha,
    )
    print(_ok(f"updated index.lock (fingerprint={last_fingerprint})"))
    return 0


# ── subcommand: check ───────────────────────────────────────────────


def cmd_check(args: argparse.Namespace) -> int:
    rag_dir = Path(args.rag_dir).resolve()
    lock_path = rag_dir / "index.lock"
    chunks_path = rag_dir / "chunks.jsonl"

    lock = read_lock(lock_path)
    if lock is None:
        print(_err(f"no readable index.lock at {lock_path}"), file=sys.stderr)
        return 1

    repo_root = _chunker._autodetect_repo_root()
    expected_sources = lock.get("source_hashes") or {}
    actual_sources = collect_source_hashes(repo_root)
    drift = diff_hashes(expected_sources, actual_sources)

    chunks_drift: tuple[str, str] | None = None
    if chunks_path.exists():
        expected_chunks = lock.get("chunks_sha256")
        actual_chunks = hash_file(chunks_path)
        if expected_chunks and expected_chunks != actual_chunks:
            chunks_drift = (expected_chunks, actual_chunks)
    else:
        print(_err(f"chunks.jsonl missing at {chunks_path}"), file=sys.stderr)
        return 1

    if not drift and chunks_drift is None:
        print(_ok("OK — index.lock matches live sources + chunks.jsonl"))
        return 0

    for path, (want, got) in sorted(drift.items()):
        print(_err(f"DRIFT in {path}: {want[:8]}... -> {got[:8]}..."), file=sys.stderr)
    if chunks_drift is not None:
        want, got = chunks_drift
        print(_err(f"DRIFT in chunks.jsonl: {want[:8]}... -> {got[:8]}..."),
              file=sys.stderr)
    return 1


# ── argparse plumbing ───────────────────────────────────────────────


def _default_rag_dir() -> Path:
    return Path(__file__).resolve().parent


def _add_rag_dir(p: argparse.ArgumentParser) -> None:
    p.add_argument(
        "--rag-dir",
        default=str(_default_rag_dir()),
        help="Directory containing chunks.jsonl + index.lock "
             "(default: this script's folder)",
    )


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="mxwp-rules",
        description="RAG toolkit for MXWhitePaper widget rules.",
    )
    p.add_argument("--version", action="version", version="mxwp-rules 1.0.0")
    sub = p.add_subparsers(dest="cmd", required=True)

    pq = sub.add_parser("query", help="run a query against an on-disk index")
    pq.add_argument("text", help="query text")
    pq.add_argument("--backend", choices=_BACKENDS, default="st")
    pq.add_argument("-k", type=int, default=5)
    pq.add_argument("--json", action="store_true", help="emit hits as JSON")
    _add_rag_dir(pq)
    pq.set_defaults(func=cmd_query)

    pi = sub.add_parser("index", help="build the on-disk index for a backend")
    pi.add_argument(
        "--backend", choices=(*_BACKENDS, "all"), default="st",
    )
    pi.add_argument(
        "--rebuild", action="store_true",
        help="regenerate chunks.jsonl from source before indexing",
    )
    _add_rag_dir(pi)
    pi.set_defaults(func=cmd_index)

    pc = sub.add_parser("check", help="verify index.lock matches live state")
    _add_rag_dir(pc)
    pc.set_defaults(func=cmd_check)
    return p


def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    sys.exit(main())
