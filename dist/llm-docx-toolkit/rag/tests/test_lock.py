"""Tests for the index.lock schema, drift detection, and the chunker
``--check`` mode that wires them together."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from rag._lock import (
    LOCK_SCHEMA_VERSION,
    diff_hashes,
    read_lock,
    write_lock,
)


_CHUNKER = Path(__file__).resolve().parents[1] / "chunker.py"


def test_write_then_read_lock_roundtrip(tmp_path: Path) -> None:
    lock_path = tmp_path / "index.lock"
    write_lock(
        lock_path,
        source_hashes={"a.py": "aa", "b.json": "bb"},
        widget_types=["callout", "kpi-cards"],
        chunk_count=42,
        embedding_backend_fingerprint="st:test:v1",
        chunks_sha256="cc",
    )
    payload = read_lock(lock_path)
    assert payload is not None
    assert payload["schema_version"] == LOCK_SCHEMA_VERSION
    assert payload["source_hashes"] == {"a.py": "aa", "b.json": "bb"}
    assert payload["widget_types"] == ["callout", "kpi-cards"]
    assert payload["chunk_count"] == 42
    assert payload["embedding_backend_fingerprint"] == "st:test:v1"
    assert payload["chunks_sha256"] == "cc"
    assert "generated_at" in payload


def test_diff_hashes_empty_when_match() -> None:
    same = {"a.py": "11", "b.json": "22"}
    assert diff_hashes(same, dict(same)) == {}


def test_diff_hashes_reports_added_removed_changed() -> None:
    old = {"a.py": "11", "removed.py": "33"}
    new = {"a.py": "99", "added.py": "44"}
    out = diff_hashes(old, new)
    assert out["a.py"] == ("11", "99")            # changed
    assert out["removed.py"] == ("33", "missing")  # removed
    assert out["added.py"] == ("missing", "44")   # added


def _run_chunker(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(_CHUNKER), *args],
        capture_output=True,
        text=True,
    )


def test_chunker_check_mode_returns_0_on_match() -> None:
    # Regenerate first so the lock matches the live repo.
    gen = _run_chunker()
    assert gen.returncode == 0, gen.stderr
    chk = _run_chunker("--check")
    assert chk.returncode == 0, f"stdout={chk.stdout}\nstderr={chk.stderr}"


def test_chunker_check_mode_returns_1_on_drift(tmp_path: Path) -> None:
    # Regenerate so we have a real lock + chunks file in their canonical spot.
    gen = _run_chunker()
    assert gen.returncode == 0, gen.stderr

    rag_dir = Path(__file__).resolve().parents[1]
    lock_path = rag_dir / "index.lock"
    backup = lock_path.read_text(encoding="utf-8")

    try:
        # Tamper: invalidate every source hash.
        payload = json.loads(backup)
        payload["source_hashes"] = {
            k: "0" * 64 for k in payload["source_hashes"]
        }
        lock_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

        chk = _run_chunker("--check")
        assert chk.returncode == 1
        assert "stale" in chk.stderr.lower() or "✗" in chk.stderr
    finally:
        lock_path.write_text(backup, encoding="utf-8")
