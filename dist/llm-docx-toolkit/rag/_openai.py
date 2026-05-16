"""OpenAI embedding retrieval backend.

Embeds each chunk's `heading + '\\n' + text` with OpenAI's
`text-embedding-3-small` (1536-dim) by default — opt-in via
`--backend openai`. Vectors are L2-normalised so cosine = dot product,
identical retrieval math to `_st.py`. The on-disk format is also identical
(embeddings.npz + embeddings.jsonl) so a future tool that only needs to
load vectors does not have to special-case the producer; the `fingerprint`
string is what distinguishes an OpenAI-built index from a ST-built one
when `_lock.py` decides whether a rebuild is required.

The `openai` SDK is intentionally NOT a core dependency (see
requirements.txt) — import is lazy so users on the default ST backend
never need it installed.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any, Optional

import numpy as np

from .retriever import Chunk, Hit, Retriever


BATCH_SIZE = 100  # OpenAI accepts up to 2048; smaller for clearer error attribution.


class OpenAIRetriever(Retriever):
    name = "openai"
    fingerprint = "openai:text-embedding-3-small:v1"
    MODEL_NAME = "text-embedding-3-small"
    EMBEDDING_DIM = 1536

    def __init__(
        self,
        model_name: str | None = None,
        api_key: str | None = None,
    ) -> None:
        # Defer the missing-key error until the first index/query call so
        # `from rag._openai import OpenAIRetriever` works even when OPENAI
        # is not configured (e.g. CI on a different backend).
        self._model_name = model_name or self.MODEL_NAME
        self._api_key = api_key  # may be None; resolved on first call
        self._client = None  # type: ignore[assignment]
        self._announced = False
        self._matrix: Optional[np.ndarray] = None
        self._chunks: list[Chunk] = []
        self._ids: list[str] = []

    # ── lazy client construction ─────────────────────────────────────

    def _ensure_client(self):  # type: ignore[no-untyped-def]
        if self._client is not None:
            return self._client
        api_key = self._api_key or os.environ.get("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError(
                "OPENAI_API_KEY missing — pass api_key=... or set env var"
            )
        from openai import OpenAI  # heavy / optional import

        self._client = OpenAI(api_key=api_key)
        return self._client

    def _embed_batch(self, texts: list[str]) -> np.ndarray:
        client = self._ensure_client()
        out: list[list[float]] = []
        total = (len(texts) + BATCH_SIZE - 1) // BATCH_SIZE
        if not self._announced:
            print(
                f"[mxwp-rules] Calling OpenAI embeddings API "
                f"(model={self._model_name}, batches={total})...",
                file=sys.stderr,
                flush=True,
            )
            self._announced = True
        for i in range(0, len(texts), BATCH_SIZE):
            batch = texts[i : i + BATCH_SIZE]
            batch_idx = (i // BATCH_SIZE) + 1
            try:
                resp = client.embeddings.create(
                    model=self._model_name, input=batch
                )
            except Exception as e:
                raise RuntimeError(
                    f"OpenAI embeddings call failed at batch {batch_idx}/{total}: {e}"
                ) from e
            out.extend(d.embedding for d in resp.data)
        arr = np.asarray(out, dtype=np.float32)
        # L2-normalise so cosine = dot product (matches _st.py math).
        norms = np.linalg.norm(arr, axis=1, keepdims=True)
        norms[norms == 0] = 1.0
        return arr / norms

    # ── index / save / load / query ──────────────────────────────────

    def index(self, chunks: list[Chunk]) -> None:
        self._chunks = list(chunks)
        self._ids = [c.id for c in self._chunks]
        if not self._chunks:
            self._matrix = np.zeros((0, self.EMBEDDING_DIM), dtype=np.float32)
            return
        texts = [f"{c.heading}\n{c.text}" for c in self._chunks]
        self._matrix = self._embed_batch(texts)

    def save(self, path: Path) -> None:
        path = Path(path)
        path.mkdir(parents=True, exist_ok=True)
        if self._matrix is None:
            raise RuntimeError("index() must be called before save()")
        npz_path = path / "embeddings.npz"
        jsonl_path = path / "embeddings.jsonl"
        np.savez_compressed(
            npz_path,
            embeddings=self._matrix.astype(np.float32),
            ids=np.array(self._ids, dtype=object),
        )
        with jsonl_path.open("w", encoding="utf-8") as f:
            for c in self._chunks:
                f.write(c.to_json_line() + "\n")

    def load(self, index_dir: Any) -> None:
        index_dir = Path(index_dir)
        npz_path = index_dir / "embeddings.npz"
        jsonl_path = index_dir / "embeddings.jsonl"
        with np.load(npz_path, allow_pickle=True) as data:
            self._matrix = np.asarray(data["embeddings"], dtype=np.float32)
            self._ids = [str(x) for x in data["ids"].tolist()]
        chunks: list[Chunk] = []
        with jsonl_path.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                chunks.append(Chunk.from_json_line(line))
        self._chunks = chunks
        if len(self._chunks) != len(self._ids):
            raise RuntimeError(
                f"embeddings.jsonl ({len(self._chunks)}) and embeddings.npz "
                f"ids ({len(self._ids)}) disagree on chunk count"
            )

    def query(self, text: str, k: int = 5) -> list[Hit]:
        if self._matrix is None or self._matrix.shape[0] == 0:
            return []
        q = self._embed_batch([text])[0]
        scores = self._matrix @ q  # cosine — both sides L2-normalised
        k = min(k, scores.shape[0])
        if k <= 0:
            return []
        top_idx = np.argsort(-scores)[:k]
        return [
            Hit(chunk=self._chunks[int(i)], score=float(scores[int(i)]))
            for i in top_idx
        ]
