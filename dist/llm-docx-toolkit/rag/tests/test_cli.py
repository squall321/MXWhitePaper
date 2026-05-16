"""Tests for the mxwp-rules CLI (rag.cli)."""
from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest

from rag import cli as rag_cli
from rag._bm25 import BM25Retriever
from rag._lock import hash_file, read_lock, write_lock
from rag.retriever import Chunk


_RAG_DIR = Path(__file__).resolve().parents[1]


def _mk(id_: str, text: str, heading: str = "") -> Chunk:
    return Chunk(id=id_, source="test", heading=heading, text=text, metadata={})


def _build_bm25_fixture(rag_dir: Path, chunks: list[Chunk]) -> str:
    """Write chunks.jsonl + bm25.json + a matching index.lock under rag_dir.
    Returns the chunks.jsonl sha256."""
    rag_dir.mkdir(parents=True, exist_ok=True)
    chunks_path = rag_dir / "chunks.jsonl"
    with chunks_path.open("w", encoding="utf-8") as f:
        for c in chunks:
            f.write(c.to_json_line() + "\n")
    sha = hash_file(chunks_path)

    r = BM25Retriever()
    r.index(chunks)
    r.save(rag_dir / "bm25.json")

    write_lock(
        rag_dir / "index.lock",
        source_hashes={},
        widget_types=[],
        chunk_count=len(chunks),
        embedding_backend_fingerprint="bm25:v1",
        chunks_sha256=sha,
    )
    return sha


# ── query subcommand ──────────────────────────────────────────────────


def test_query_bm25_returns_chart_first(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    chunks = [
        _mk("rules#chart", "차트 차트 차트 chart widget usage", heading="차트"),
        _mk("rules#table", "테이블 layout sample", heading="table"),
        _mk("rules#callout", "callout block info text", heading="callout"),
    ]
    _build_bm25_fixture(tmp_path, chunks)

    code = rag_cli.main(["query", "--backend", "bm25", "--rag-dir", str(tmp_path), "차트"])
    assert code == 0
    out = capsys.readouterr().out
    # First data line (after header + divider) should reference the chart chunk.
    lines = [ln for ln in out.splitlines() if ln.strip()]
    # Header, divider, then ranked rows.
    assert "rules#chart" in lines[2]


def test_query_exits_nonzero_on_chunks_sha_drift(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    chunks = [
        _mk("a", "alpha content", heading="alpha"),
        _mk("b", "bravo content", heading="bravo"),
    ]
    _build_bm25_fixture(tmp_path, chunks)

    # Tamper with chunks.jsonl after the lock was written.
    (tmp_path / "chunks.jsonl").write_text(
        (tmp_path / "chunks.jsonl").read_text(encoding="utf-8") + "\n",
        encoding="utf-8",
    )

    code = rag_cli.main(["query", "--backend", "bm25", "--rag-dir", str(tmp_path), "alpha"])
    assert code != 0
    err = capsys.readouterr().err
    assert "mismatch" in err.lower()


def test_query_json_flag_emits_valid_json(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    chunks = [
        _mk("a", "alpha content widget", heading="alpha"),
        _mk("b", "bravo content sample", heading="bravo"),
    ]
    _build_bm25_fixture(tmp_path, chunks)

    code = rag_cli.main([
        "query", "--backend", "bm25", "--rag-dir", str(tmp_path),
        "-k", "2", "--json", "alpha",
    ])
    assert code == 0
    out = capsys.readouterr().out
    payload = json.loads(out)
    assert isinstance(payload, list)
    assert payload and payload[0]["id"] == "a"
    # Required fields per spec.
    for h in payload:
        assert {"score", "id", "source", "heading", "text", "metadata"} <= h.keys()


# ── index subcommand ──────────────────────────────────────────────────


def test_index_bm25_rebuild_produces_consistent_lock(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    # `index --rebuild` always uses the live repo via chunker._autodetect_repo_root;
    # we only need a writable rag_dir. Run it into tmp_path.
    code = rag_cli.main([
        "index", "--backend", "bm25", "--rebuild", "--rag-dir", str(tmp_path),
    ])
    assert code == 0
    assert (tmp_path / "chunks.jsonl").exists()
    assert (tmp_path / "bm25.json").exists()
    lock = read_lock(tmp_path / "index.lock")
    assert lock is not None
    assert lock["chunks_sha256"] == hash_file(tmp_path / "chunks.jsonl")
    assert lock["embedding_backend_fingerprint"] == "bm25:v1"


# ── check subcommand ──────────────────────────────────────────────────


def test_check_passes_on_fresh_index(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    # Build a fresh index in tmp_path against the real repo (so source_hashes match).
    build_code = rag_cli.main([
        "index", "--backend", "bm25", "--rebuild", "--rag-dir", str(tmp_path),
    ])
    assert build_code == 0
    capsys.readouterr()  # drain

    code = rag_cli.main(["check", "--rag-dir", str(tmp_path)])
    assert code == 0


def test_check_fails_after_chunks_mutation(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    rag_cli.main(["index", "--backend", "bm25", "--rebuild", "--rag-dir", str(tmp_path)])
    capsys.readouterr()

    # Mutate chunks.jsonl — drift vs lock's chunks_sha256.
    p = tmp_path / "chunks.jsonl"
    p.write_text(p.read_text(encoding="utf-8") + "\n", encoding="utf-8")

    code = rag_cli.main(["check", "--rag-dir", str(tmp_path)])
    assert code != 0
    err = capsys.readouterr().err
    assert "DRIFT" in err or "drift" in err.lower()
