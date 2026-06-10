"""Unit tests for chunker._chunks_from_glossary.

We don't spin up Postgres for these — the DB fetch is monkeypatched so the
test exercises chunk construction only (id format, source label, content
shape, alias serialization). The DB integration path (DATABASE_URL +
asyncpg) is covered separately by the API test suite.
"""
from __future__ import annotations

import json
import os
from unittest import mock

from rag import chunker as ck


def test_glossary_skipped_without_database_url(monkeypatch, tmp_path) -> None:
    # Drop the env var, even if the host has one set, and point the dump
    # path at a nonexistent file so the fallback doesn't kick in.
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("MXWP_DATABASE_URL", raising=False)
    monkeypatch.setattr(ck, "_GLOSSARY_DUMP_PATH", tmp_path / "glossary.json")
    chunks = ck._chunks_from_glossary()
    assert chunks == []


def test_glossary_built_from_dump_without_database_url(monkeypatch, tmp_path) -> None:
    """No DATABASE_URL + glossary.json present → chunks come from the dump."""
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("MXWP_DATABASE_URL", raising=False)
    dump = tmp_path / "glossary.json"
    dump.write_text(json.dumps({
        "generated_at": "2026-06-10T00:00:00+00:00",
        "rows": [{
            "term": "GaN",
            "definition": "질화갈륨 반도체.",
            "domain": "semiconductor",
            "domain_name": "반도체",
            "subdomain": None,
            "term_en": None,
            "aliases": [],
        }],
    }, ensure_ascii=False), encoding="utf-8")
    monkeypatch.setattr(ck, "_GLOSSARY_DUMP_PATH", dump)
    chunks = ck._chunks_from_glossary()
    assert len(chunks) == 1
    assert chunks[0].id == "glossary:semiconductor:gan"
    assert chunks[0].source == "glossary"


def test_glossary_skipped_when_db_unreachable(monkeypatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgresql://nobody@127.0.0.1:1/none")

    def _boom(_dsn: str) -> list[dict]:
        raise ConnectionError("nope")

    monkeypatch.setattr(ck, "_fetch_glossary_rows", _boom)
    # Must return [] without raising — chunker has to survive DB outages.
    chunks = ck._chunks_from_glossary()
    assert chunks == []


def test_glossary_chunks_built_from_mocked_rows(monkeypatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgresql://fake")
    fake_rows = [
        {
            "term": "트랜스포머",
            "definition": "어텐션 메커니즘 기반 모델.",
            "domain": "ml",
            "domain_name": "Machine Learning",
            "subdomain": "nlp",
            "term_en": "Transformer",
            "aliases": ["어텐션-모델", "attention-model"],
        },
        {
            "term": "GaN",
            "definition": "질화갈륨 반도체.",
            "domain": "semiconductor",
            "domain_name": "반도체",
            "subdomain": None,
            "term_en": None,
            "aliases": [],
        },
    ]
    monkeypatch.setattr(ck, "_fetch_glossary_rows", lambda _dsn: fake_rows)
    chunks = ck._chunks_from_glossary()
    assert len(chunks) == 2

    by_id = {c.id: c for c in chunks}
    transformer = by_id["glossary:ml:트랜스포머"]
    assert transformer.source == "glossary"
    assert "용어: 트랜스포머" in transformer.text
    assert "영문: Transformer" in transformer.text
    assert "분야: Machine Learning / nlp" in transformer.text
    assert "정의: 어텐션 메커니즘 기반 모델." in transformer.text
    assert "동의어: 어텐션-모델, attention-model" in transformer.text
    assert transformer.metadata["aliases"] == ["어텐션-모델", "attention-model"]
    assert transformer.metadata["term_en"] == "Transformer"

    gan = by_id["glossary:semiconductor:gan"]
    assert "영문" not in gan.text  # term_en is None
    assert "동의어" not in gan.text  # aliases empty
    assert gan.metadata["aliases"] == []


def test_build_chunks_does_not_break_when_glossary_skipped(monkeypatch, tmp_path) -> None:
    """Regression guard: file-based sources keep producing chunks even
    when glossary is skipped (no DATABASE_URL, no dump)."""
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("MXWP_DATABASE_URL", raising=False)
    monkeypatch.setattr(ck, "_GLOSSARY_DUMP_PATH", tmp_path / "glossary.json")
    repo_root = ck._autodetect_repo_root()
    chunks = ck.build_chunks(repo_root)
    # File sources (rules / widgets / schema) yield plenty of chunks.
    assert len(chunks) > 0
    sources = {c.source for c in chunks}
    # No glossary chunks emitted in this run, but file sources present.
    assert "glossary" not in sources
    assert "llm-input-rules.md" in sources or "document.json" in sources


def test_glossary_chunks_are_included_in_build_chunks(monkeypatch) -> None:
    """build_chunks() must merge glossary chunks with file-based ones."""
    monkeypatch.setenv("DATABASE_URL", "postgresql://fake")
    monkeypatch.setattr(
        ck,
        "_fetch_glossary_rows",
        lambda _dsn: [{
            "term": "Test",
            "definition": "test def",
            "domain": "general",
            "domain_name": "일반",
            "subdomain": None,
            "term_en": None,
            "aliases": [],
        }],
    )
    repo_root = ck._autodetect_repo_root()
    chunks = ck.build_chunks(repo_root)
    sources = {c.source for c in chunks}
    assert "glossary" in sources
