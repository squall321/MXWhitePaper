"""Retriever interface — every backend (ST, OpenAI, BM25) implements this.

A *chunk* is a self-contained snippet (a rule excerpt, a widget schema slice,
an example fragment). At query time the retriever returns the K chunks
closest to the user's question, with scores.

Backends are pluggable so users can pick the trade-off they prefer:
  - st     : default. all-MiniLM-L6-v2 (~80MB lazy-downloaded), runs locally.
  - openai : OpenAI text-embedding-3-small API. Needs OPENAI_API_KEY.
  - bm25   : pure-Python keyword. No model, no network, fastest cold-start.

Each backend reads the SAME chunks.jsonl produced by chunker.py — the only
difference is how the query gets matched against chunks.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any


# ── data model ─────────────────────────────────────────────────────


@dataclass(frozen=True)
class Chunk:
    """One retrievable record. Stored as a JSON line in chunks.jsonl."""

    id: str                              # stable, deterministic; e.g. "rules#3.1-callout"
    source: str                          # "llm-input-rules.md" / "widget_markers.py" / "document.json" / "system-prompt.md" / "example:good"
    heading: str                         # human-readable section path; e.g. "3.1 callout"
    text: str                            # the chunk body — what gets embedded / scored
    metadata: dict[str, Any] = field(default_factory=dict)
                                         # free-form: widget_type, line_range, anchor, ...

    def to_json_line(self) -> str:
        import json
        return json.dumps(
            {
                "id": self.id,
                "source": self.source,
                "heading": self.heading,
                "text": self.text,
                "metadata": self.metadata,
            },
            ensure_ascii=False,
        )

    @classmethod
    def from_json_line(cls, line: str) -> "Chunk":
        import json
        d = json.loads(line)
        return cls(
            id=d["id"],
            source=d["source"],
            heading=d["heading"],
            text=d["text"],
            metadata=d.get("metadata") or {},
        )


@dataclass(frozen=True)
class Hit:
    """A retrieval result: chunk + similarity / relevance score."""
    chunk: Chunk
    score: float                         # higher = more relevant; backend-specific scale


# ── backend interface ──────────────────────────────────────────────


class Retriever(ABC):
    """A backend pre-computes whatever index it needs over a list of chunks,
    then answers `query(text, k)` repeatedly."""

    name: str = "retriever"
    fingerprint: str = "retriever:base"
    """Stable identifier for the backend + model version. Stored in
    index.lock so a backend swap forces a rebuild."""

    @abstractmethod
    def index(self, chunks: list[Chunk]) -> None:
        """Build whatever data structure the backend needs. Called once at
        build time (CLI 'index' subcommand) and persisted next to chunks.jsonl
        as the backend sees fit (numpy npz, json, etc.)."""

    @abstractmethod
    def load(self, index_dir: "Any") -> None:
        """Restore from disk into memory for query time. `index_dir` is a
        pathlib.Path pointing at the rag/ folder (or wherever the binary
        bundled it under sys._MEIPASS)."""

    @abstractmethod
    def query(self, text: str, k: int = 5) -> list[Hit]:
        """Return top-k hits sorted by descending score."""
