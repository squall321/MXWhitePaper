"""Unit tests for chunker._chunks_from_relationships (관계 → RAG 지식).

glossary 와 동일하게 DB fetch 를 monkeypatch 해 chunk 구성만 검증. DB/dump
둘 다 없으면 skip, dump/DB 있으면 관계 1건 → chunk 1개 (양방향 문장 포함).
"""
from __future__ import annotations

import json

from rag import chunker as ck


def test_relationships_skipped_without_source(monkeypatch, tmp_path) -> None:
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("MXWP_DATABASE_URL", raising=False)
    monkeypatch.setattr(ck, "_RELATIONSHIPS_DUMP_PATH", tmp_path / "relationships.json")
    assert ck._chunks_from_relationships() == []


def test_relationships_built_from_dump(monkeypatch, tmp_path) -> None:
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("MXWP_DATABASE_URL", raising=False)
    dump = tmp_path / "relationships.json"
    dump.write_text(json.dumps({
        "generated_at": "2026-07-03T00:00:00+00:00",
        "rows": [
            {"subject_slug": "month-end-closing", "predicate": "전제로 한다",
             "object_slug": "onboarding-guide", "inverse_predicate": "의 전제가 된다",
             "source": "manual"},
            {"subject_slug": "a", "predicate": "인용한다", "object_slug": "b",
             "inverse_predicate": None, "source": "llm"},
        ],
    }, ensure_ascii=False), encoding="utf-8")
    monkeypatch.setattr(ck, "_RELATIONSHIPS_DUMP_PATH", dump)

    chunks = ck._chunks_from_relationships()
    assert len(chunks) == 2
    by_id = {c.id: c for c in chunks}
    c1 = by_id["relationship:month-end-closing--전제로-한다--onboarding-guide--manual"]
    assert c1.source == "relationships"
    assert "month-end-closing 는(은) onboarding-guide 를(을) '전제로 한다'" in c1.text
    assert "역방향: onboarding-guide 는(은) month-end-closing 를(을) '의 전제가 된다'" in c1.text
    assert c1.metadata["predicate"] == "전제로 한다"
    # inverse 없으면 역방향 줄 없음
    c2 = by_id["relationship:a--인용한다--b--llm"]
    assert "역방향" not in c2.text


def test_relationships_skipped_when_db_unreachable(monkeypatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgresql://nobody@127.0.0.1:1/none")

    def _boom(_dsn: str) -> list[dict]:
        raise ConnectionError("nope")

    monkeypatch.setattr(ck, "_fetch_relationship_rows", _boom)
    assert ck._chunks_from_relationships() == []


def test_relationships_included_in_build_chunks(monkeypatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgresql://fake")
    monkeypatch.setattr(
        ck, "_fetch_relationship_rows",
        lambda _dsn: [{"subject_slug": "x", "predicate": "의존한다",
                       "object_slug": "y", "inverse_predicate": "의 기반이 된다",
                       "source": "manual"}],
    )
    repo_root = ck._autodetect_repo_root()
    sources = {c.source for c in ck.build_chunks(repo_root)}
    assert "relationships" in sources


def test_relationships_skipped_rows_missing_fields(monkeypatch, tmp_path) -> None:
    # subject/predicate/object 중 하나라도 비면 그 행은 skip (crash 아님).
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("MXWP_DATABASE_URL", raising=False)
    dump = tmp_path / "relationships.json"
    dump.write_text(json.dumps({"rows": [
        {"subject_slug": "a", "predicate": "", "object_slug": "b"},
        {"subject_slug": "a", "object_slug": "b"},
    ]}, ensure_ascii=False), encoding="utf-8")
    monkeypatch.setattr(ck, "_RELATIONSHIPS_DUMP_PATH", dump)
    assert ck._chunks_from_relationships() == []
