"""Tests for the BM25 keyword retrieval backend."""
from __future__ import annotations

from pathlib import Path

from rag._bm25 import BM25Retriever, tokenise
from rag.retriever import Chunk


def _mk(id_: str, text: str, heading: str = "") -> Chunk:
    return Chunk(id=id_, source="test", heading=heading, text=text, metadata={})


def test_tokenise_mixes_korean_and_ascii() -> None:
    assert tokenise("callout 색 표") == ["callout", "색", "표"]
    # Per-spec example with mixed runs.
    assert tokenise("callout 색 표 만들기") == [
        "callout",
        "색",
        "표",
        "만",
        "들",
        "기",
    ]


def test_index_and_query_returns_sorted_hits() -> None:
    chunks = [
        _mk("a", "callout callout callout block usage", heading="callout"),
        _mk("b", "table layout sample", heading="table"),
        _mk("c", "completely unrelated content here", heading="misc"),
    ]
    r = BM25Retriever()
    r.index(chunks)
    hits = r.query("callout block", k=3)
    assert len(hits) == 3
    # The chunk that mentions "callout" + "block" should rank first.
    assert hits[0].chunk.id == "a"
    # Sorted in descending score order.
    scores = [h.score for h in hits]
    assert scores == sorted(scores, reverse=True)


def test_save_load_roundtrip(tmp_path: Path) -> None:
    chunks = [
        _mk("a", "callout callout block alpha", heading="alpha"),
        _mk("b", "tabs widget bravo content", heading="tabs"),
        _mk("c", "kpi cards charlie metrics", heading="kpi"),
    ]
    r1 = BM25Retriever()
    r1.index(chunks)
    out = tmp_path / "bm25.json"
    r1.save(out)

    r2 = BM25Retriever()
    r2.load(tmp_path)

    h1 = r1.query("callout block", k=3)
    h2 = r2.query("callout block", k=3)
    assert [h.chunk.id for h in h1] == [h.chunk.id for h in h2]
    for a, b in zip(h1, h2):
        assert abs(a.score - b.score) < 1e-9


def test_query_with_k_caps_results() -> None:
    chunks = [
        _mk(f"chunk{i}", f"shared keyword unique{i}", heading=f"h{i}")
        for i in range(5)
    ]
    r = BM25Retriever()
    r.index(chunks)
    hits = r.query("shared keyword", k=2)
    assert len(hits) == 2


def test_score_zero_for_unrelated_query() -> None:
    chunks = [
        _mk("a", "callout block alpha", heading="alpha"),
        _mk("b", "tabs widget bravo", heading="tabs"),
    ]
    r = BM25Retriever()
    r.index(chunks)
    hits = r.query("xyzzy plover frobnitz", k=5)
    # Either no hits (because no query term matched any doc) or all-zero scores.
    assert all(h.score == 0.0 for h in hits)


def test_korean_query_matches_korean_chunks() -> None:
    chunks = [
        _mk("warn", "주의 사항 을 잘 지켜야 합니다", heading="warning"),
        _mk("info", "callout 위젯 사용 예시", heading="callout"),
        _mk("misc", "table layout 설명", heading="table"),
    ]
    r = BM25Retriever()
    r.index(chunks)
    hits = r.query("주의", k=3)
    assert hits, "expected at least one hit for Korean query"
    assert hits[0].chunk.id == "warn"
