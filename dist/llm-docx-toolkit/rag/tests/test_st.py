"""Tests for the sentence-transformer retrieval backend.

The first test run in a clean environment will download the
multilingual-e5-small model (~120 MB) into ~/.cache/huggingface — that
cost is accepted in CI. The tests below are marked `slow` so suites that
want to skip the download can do so via `-m "not slow"`.

These tests use Korean queries on purpose: the toolkit's rule corpus is
Korean-first, and the default model is multilingual specifically so
queries like "차트" / "표 헤더" land on the right chunk.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from rag._st import STRetriever
from rag.retriever import Chunk


pytestmark = pytest.mark.slow


def _mk(id_: str, text: str, heading: str) -> Chunk:
    return Chunk(id=id_, source="test", heading=heading, text=text, metadata={})


def test_st_retriever_fingerprint_includes_model_name() -> None:
    assert STRetriever().fingerprint == "st:multilingual-e5-small:v1"


def test_st_retriever_indexes_and_queries_korean() -> None:
    chunks = [
        _mk("callout", "callout 만들기 — 색 박스 + 이모지", heading="callout"),
        _mk("chart", "chart 데이터 표 — labels + series", heading="chart"),
        _mk("gallery", "gallery 이미지 3장 이상 연속", heading="gallery"),
    ]
    r = STRetriever()
    r.index(chunks)
    # multilingual-e5-small ranks Korean correctly — the whole point of
    # picking this model over the English-only MiniLM.
    hits = r.query("차트", k=3)
    assert hits, "query returned no hits"
    assert hits[0].chunk.id == "chart", [h.chunk.id for h in hits]
    scores = [h.score for h in hits]
    assert scores == sorted(scores, reverse=True)


def test_st_retriever_save_load_roundtrip(tmp_path: Path) -> None:
    chunks = [
        _mk("callout", "callout 만들기 — 색 박스 + 이모지", heading="callout"),
        _mk("chart", "chart 데이터 표 — labels + series", heading="chart"),
        _mk("gallery", "gallery 이미지 3장 이상 연속", heading="gallery"),
    ]
    r1 = STRetriever()
    r1.index(chunks)
    r1.save(tmp_path)

    r2 = STRetriever()
    r2.load(tmp_path)

    h1 = r1.query("차트", k=3)
    h2 = r2.query("차트", k=3)
    assert [h.chunk.id for h in h1] == [h.chunk.id for h in h2]
    assert h1[0].chunk.id == h2[0].chunk.id == "chart"
    for a, b in zip(h1, h2):
        assert abs(a.score - b.score) < 1e-5


def test_st_query_with_empty_text_returns_empty_or_low_scores() -> None:
    chunks = [
        _mk("callout", "callout 만들기", heading="callout"),
        _mk("chart", "chart 데이터 표", heading="chart"),
    ]
    r = STRetriever()
    r.index(chunks)
    hits = r.query("", k=3)
    # Either no hits returned or every score is in the cosine [-1, 1] range.
    # Important: the call must not crash.
    assert isinstance(hits, list)
    for h in hits:
        assert -1.0001 <= h.score <= 1.0001
