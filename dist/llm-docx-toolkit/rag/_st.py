"""Sentence-transformer retrieval backend (default).

Encodes each chunk's `heading + '\\n' + text` with
`intfloat/multilingual-e5-small` (384-dim, ~120MB lazy-downloaded from
HuggingFace on first use) and serves cosine-similarity top-k against
L2-normalised vectors.

Why multilingual-e5-small and not all-MiniLM-L6-v2? Our rules + system
prompt are Korean-first; the English-only MiniLM ranks `"차트"` queries
roughly at random against a Korean rules corpus. Multilingual-e5-small
is the same 384-dim, ~1.5x the disk size, but actually retrieves the
right chunk for Korean queries — verified end-to-end.

Storage (sibling files under the rag/ folder):
  - embeddings.npz  : numpy compressed archive, {'embeddings': float32 N×384,
                      'ids': object array of chunk ids}
  - embeddings.jsonl: one Chunk JSON per line, same order as `ids`, used to
                      reconstruct full Chunk payloads at query time.
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path
from typing import Optional

import numpy as np

from .retriever import Chunk, Hit, Retriever


_MODEL_DOWNLOAD_HEURISTIC_SECONDS = 5.0


def _model_is_cached(model_name: str) -> bool:
    """Best-effort: does HF hub already have this model snapshot locally?"""
    try:
        from huggingface_hub import scan_cache_dir
    except Exception:
        return False
    try:
        info = scan_cache_dir()
    except Exception:
        return False
    target = model_name.lower()
    for repo in info.repos:
        if repo.repo_id.lower() == target:
            return True
    return False


class STRetriever(Retriever):
    name = "st"
    fingerprint = "st:multilingual-e5-small:v1"
    MODEL_NAME = "intfloat/multilingual-e5-small"
    EMBEDDING_DIM = 384

    def __init__(self, model_name: str | None = None) -> None:
        self._model_name = model_name or self.MODEL_NAME
        self._model = None  # type: ignore[assignment]
        self._matrix: Optional[np.ndarray] = None
        self._chunks: list[Chunk] = []
        self._ids: list[str] = []

    # ── lazy model load ──────────────────────────────────────────────

    def _ensure_model(self) -> None:
        if self._model is not None:
            return
        try:
            from sentence_transformers import SentenceTransformer  # heavy import
        except ImportError as exc:
            raise RuntimeError(
                "The 'st' (sentence-transformer) backend is not installed.\n"
                "This is the LITE build of mxwp-rules — torch and "
                "sentence-transformers were stripped to keep the binary "
                "under 100 MB.\n"
                "Options:\n"
                "  1) Use --backend bm25 instead (no extra install needed).\n"
                "  2) Install the deps and run from source:\n"
                "       pip install sentence-transformers numpy\n"
                "       python -m rag query --backend st '<query>'\n"
                "  3) Download the FULL toolkit (see HANDOFF.md §full build)."
            ) from exc

        cached = _model_is_cached(self._model_name)
        if not cached:
            short = self._model_name.split("/")[-1]
            print(
                f"[mxwp-rules] First run — downloading {short} (~80 MB) "
                "to ~/.cache/huggingface ...",
                file=sys.stderr,
                flush=True,
            )
        t0 = time.monotonic()
        self._model = SentenceTransformer(self._model_name)
        elapsed = time.monotonic() - t0
        if cached is False and elapsed < _MODEL_DOWNLOAD_HEURISTIC_SECONDS:
            # scan_cache_dir lied (or huggingface_hub absent) but the load
            # was fast — the model was already there. Stay quiet.
            pass

    # ── index / save / load / query ──────────────────────────────────

    def index(self, chunks: list[Chunk]) -> None:
        self._ensure_model()
        self._chunks = list(chunks)
        self._ids = [c.id for c in self._chunks]
        if not self._chunks:
            self._matrix = np.zeros((0, self.EMBEDDING_DIM), dtype=np.float32)
            return
        # E5 prompt convention: passages must be prefixed with "passage: "
        # and queries with "query: ". Skipping the prefix drops recall by
        # ~10-20% per the model card.
        texts = [f"passage: {c.heading}\n{c.text}" for c in self._chunks]
        vecs = self._model.encode(  # type: ignore[union-attr]
            texts,
            normalize_embeddings=True,
            convert_to_numpy=True,
        )
        self._matrix = np.asarray(vecs, dtype=np.float32)

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

    def load(self, index_dir: Path) -> None:
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
        self._ensure_model()
        # E5: query side gets "query: " prefix (see index() comment).
        q = self._model.encode(  # type: ignore[union-attr]
            [f"query: {text}"],
            normalize_embeddings=True,
            convert_to_numpy=True,
        )[0]
        q = np.asarray(q, dtype=np.float32)
        scores = self._matrix @ q  # cosine — both sides are L2-normalised
        k = min(k, scores.shape[0])
        if k <= 0:
            return []
        top_idx = np.argsort(-scores)[:k]
        return [
            Hit(chunk=self._chunks[int(i)], score=float(scores[int(i)]))
            for i in top_idx
        ]
