"""Tests for the OpenAI embedding retrieval backend.

The default test path mocks `_embed_batch` so no network is touched. A
single live test is gated behind both `OPENAI_API_KEY` AND
`MXWP_TOOLKIT_RUN_LIVE_OPENAI=1` so CI never accidentally bills the user.
"""
from __future__ import annotations

import os
from pathlib import Path
from unittest.mock import patch

import numpy as np
import pytest

from rag._openai import OpenAIRetriever
from rag.retriever import Chunk


def _mk(id_: str, text: str, heading: str) -> Chunk:
    return Chunk(id=id_, source="test", heading=heading, text=text, metadata={})


# ── offline / mocked ──────────────────────────────────────────────────


def test_openai_retriever_fingerprint_includes_model_name() -> None:
    r = OpenAIRetriever()
    assert r.fingerprint == "openai:text-embedding-3-small:v1"
    assert r.MODEL_NAME == "text-embedding-3-small"
    assert r.EMBEDDING_DIM == 1536


def test_openai_retriever_missing_api_key_defers_error_to_call(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    # Constructor must succeed — the import-time path must not crash when
    # OPENAI is not configured (some users only ever use the ST backend).
    r = OpenAIRetriever()
    chunk = _mk("a", "hello", heading="alpha")
    with pytest.raises(RuntimeError, match="OPENAI_API_KEY"):
        r.index([chunk])


def _fake_vectors(texts: list[str]) -> np.ndarray:
    """Deterministic L2-normalised vectors keyed off the text content.

    Each unique text gets a one-hot-ish vector in EMBEDDING_DIM space so
    the dot product is large only when query text == indexed text.
    """
    dim = OpenAIRetriever.EMBEDDING_DIM
    rows = []
    for t in texts:
        v = np.zeros(dim, dtype=np.float32)
        # Spread the hash across a few coordinates so different texts are
        # distinguishable without colliding on a single bucket.
        h = abs(hash(t))
        v[h % dim] = 1.0
        v[(h // dim) % dim] += 0.5
        norm = np.linalg.norm(v)
        if norm == 0:
            norm = 1.0
        rows.append(v / norm)
    return np.asarray(rows, dtype=np.float32)


def test_openai_retriever_save_load_roundtrip_with_mock(tmp_path: Path) -> None:
    chunks = [
        _mk("callout", "callout 만들기 — 색 박스 + 이모지", heading="callout"),
        _mk("chart", "chart 데이터 표 — labels + series", heading="chart"),
        _mk("gallery", "gallery 이미지 3장 이상 연속", heading="gallery"),
    ]
    indexed_texts = [f"{c.heading}\n{c.text}" for c in chunks]

    # Build the index with the mock — no real OpenAI client is touched.
    with patch.object(OpenAIRetriever, "_embed_batch", side_effect=_fake_vectors):
        r1 = OpenAIRetriever(api_key="sk-test-not-used")
        r1.index(chunks)
        r1.save(tmp_path)

        r2 = OpenAIRetriever(api_key="sk-test-not-used")
        r2.load(tmp_path)

        # Query text matches the chart chunk's indexed form exactly so the
        # deterministic fake vector lands the chart row at the top.
        chart_query_text = indexed_texts[1]
        h1 = r1.query(chart_query_text, k=3)
        h2 = r2.query(chart_query_text, k=3)

    assert [h.chunk.id for h in h1] == [h.chunk.id for h in h2]
    assert h1[0].chunk.id == "chart"
    assert h2[0].chunk.id == "chart"
    for a, b in zip(h1, h2):
        assert abs(a.score - b.score) < 1e-5


# ── live API (opt-in) ─────────────────────────────────────────────────


@pytest.mark.skipif(
    not (
        os.getenv("OPENAI_API_KEY")
        and os.getenv("MXWP_TOOLKIT_RUN_LIVE_OPENAI") == "1"
    ),
    reason="set OPENAI_API_KEY and MXWP_TOOLKIT_RUN_LIVE_OPENAI=1 to run",
)
def test_openai_retriever_live_query_returns_chart() -> None:
    chunks = [
        _mk("callout", "callout 만들기 — 색 박스 + 이모지", heading="callout"),
        _mk("chart", "chart 데이터 표 — labels + series", heading="chart"),
        _mk("gallery", "gallery 이미지 3장 이상 연속", heading="gallery"),
    ]
    r = OpenAIRetriever()
    r.index(chunks)
    hits = r.query("차트", k=3)
    assert hits, "live query returned no hits"
    assert hits[0].chunk.id == "chart", [h.chunk.id for h in hits]
