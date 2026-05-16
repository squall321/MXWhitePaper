"""BM25 keyword retrieval backend.

Pure-Python Okapi BM25 over `text + heading`. No model, no network — fastest
cold-start of the three backends. Tokenisation is intentionally cheap:
ASCII-Latin runs of 2+ chars stay together, CJK characters are one token each.
That coarse Korean handling is enough for short technical rules text.

Persistence is a single JSON blob (`bm25.json`) that bundles the original
chunks plus per-doc term frequencies, so query() reconstructs Hits without
re-reading chunks.jsonl.
"""
from __future__ import annotations

import json
import math
import re
from pathlib import Path
from typing import Any

from .retriever import Chunk, Hit, Retriever


# ── tokenisation ───────────────────────────────────────────────────

# ASCII letters/digits run, length >= 2.
_ASCII_RUN = re.compile(r"[A-Za-z0-9]{2,}")
# CJK character: Hiragana/Katakana (U+3040–U+30FF), CJK Unified (U+4E00–U+9FFF),
# Hangul Syllables (U+AC00–U+D7AF). Per spec these are emitted one-per-char.
_CJK_CHAR = re.compile(r"[぀-ヿ一-鿿가-힯]")


def tokenise(text: str) -> list[str]:
    """Lowercased ASCII runs (>=2 chars) + per-character CJK tokens.

    Mixed input like "callout 색 표 만들기" → ["callout", "색", "표", "만", "들", "기"].
    """
    if not text:
        return []
    lowered = text.lower()
    tokens: list[tuple[int, str]] = []
    for m in _ASCII_RUN.finditer(lowered):
        tokens.append((m.start(), m.group(0)))
    for m in _CJK_CHAR.finditer(lowered):
        tokens.append((m.start(), m.group(0)))
    tokens.sort(key=lambda t: t[0])
    return [t for _, t in tokens]


# ── backend ────────────────────────────────────────────────────────


class BM25Retriever(Retriever):
    name = "bm25"
    fingerprint = "bm25:v1"

    def __init__(self, k1: float = 1.5, b: float = 0.75) -> None:
        self.k1 = k1
        self.b = b
        # Populated by index() or load().
        self._chunks: list[Chunk] = []
        self._tfs: list[dict[str, int]] = []
        self._lens: list[int] = []
        self._df: dict[str, int] = {}
        self._avg_len: float = 0.0
        self._n: int = 0

    # ── build ─────────────────────────────────────────────────────

    def index(self, chunks: list[Chunk]) -> None:
        self._chunks = list(chunks)
        self._tfs = []
        self._lens = []
        self._df = {}
        for c in self._chunks:
            tokens = tokenise(f"{c.text} {c.heading}")
            tf: dict[str, int] = {}
            for t in tokens:
                tf[t] = tf.get(t, 0) + 1
            self._tfs.append(tf)
            self._lens.append(len(tokens))
            for t in tf:
                self._df[t] = self._df.get(t, 0) + 1
        self._n = len(self._chunks)
        self._avg_len = (sum(self._lens) / self._n) if self._n else 0.0

    # ── persistence ───────────────────────────────────────────────

    def save(self, path: Path) -> None:
        path = Path(path)
        payload = {
            "version": 1,
            "k1": self.k1,
            "b": self.b,
            "avg_len": self._avg_len,
            "chunks": [
                {
                    "id": c.id,
                    "tokens_count": self._lens[i],
                    "tf": self._tfs[i],
                    "chunk": json.loads(c.to_json_line()),
                }
                for i, c in enumerate(self._chunks)
            ],
            "df": self._df,
        }
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(payload, ensure_ascii=False), encoding="utf-8"
        )

    def load(self, index_dir: Any) -> None:
        index_dir = Path(index_dir)
        # Allow callers to pass either the directory or the JSON file.
        path = index_dir if index_dir.is_file() else index_dir / "bm25.json"
        data = json.loads(path.read_text(encoding="utf-8"))
        self.k1 = float(data.get("k1", self.k1))
        self.b = float(data.get("b", self.b))
        self._avg_len = float(data.get("avg_len", 0.0))
        self._chunks = []
        self._tfs = []
        self._lens = []
        for entry in data.get("chunks", []):
            chunk_payload = entry["chunk"]
            self._chunks.append(
                Chunk(
                    id=chunk_payload["id"],
                    source=chunk_payload["source"],
                    heading=chunk_payload["heading"],
                    text=chunk_payload["text"],
                    metadata=chunk_payload.get("metadata") or {},
                )
            )
            self._tfs.append(dict(entry["tf"]))
            self._lens.append(int(entry["tokens_count"]))
        self._df = dict(data.get("df", {}))
        self._n = len(self._chunks)

    # ── query ─────────────────────────────────────────────────────

    def query(self, text: str, k: int = 5) -> list[Hit]:
        if self._n == 0 or k <= 0:
            return []
        q_tokens = tokenise(text)
        if not q_tokens:
            return []
        # Dedupe query tokens — Okapi BM25 sums per *unique* query term.
        unique_q = list(dict.fromkeys(q_tokens))
        idf = {t: self._idf(t) for t in unique_q}
        scores: list[tuple[int, float]] = []
        for i, tf in enumerate(self._tfs):
            s = 0.0
            dl = self._lens[i]
            denom_norm = self.k1 * (1 - self.b + self.b * (dl / self._avg_len if self._avg_len else 0.0))
            for t in unique_q:
                f = tf.get(t)
                if not f:
                    continue
                s += idf[t] * (f * (self.k1 + 1)) / (f + denom_norm)
            scores.append((i, s))
        scores.sort(key=lambda x: x[1], reverse=True)
        top = scores[:k]
        return [Hit(chunk=self._chunks[i], score=s) for i, s in top]

    # ── internals ─────────────────────────────────────────────────

    def _idf(self, term: str) -> float:
        df = self._df.get(term, 0)
        # Standard Okapi BM25 idf with +1 inside the log to keep scores non-negative.
        return math.log((self._n - df + 0.5) / (df + 0.5) + 1)
