"""Tests for the MCP stdio server.

These avoid `import mcp.server` because the local package directory is also
named `mcp`, which collides with the installed MCP SDK. Instead we load
`server.py` via importlib under a private alias.
"""
from __future__ import annotations

import asyncio
import importlib.util
import json
import sys
from pathlib import Path

import pytest

# Project layout: …/llm-docx-toolkit/{mcp,rag}.
_HERE = Path(__file__).resolve()
_TOOLKIT = _HERE.parents[2]
_SERVER_PY = _HERE.parents[1] / "server.py"


def _load_server_module():
    """Load mcp/server.py as `_mxwp_mcp_server` to dodge the SDK name clash."""
    spec = importlib.util.spec_from_file_location(
        "_mxwp_mcp_server", _SERVER_PY
    )
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="module")
def rag_dir_with_bm25(tmp_path_factory) -> Path:
    """Copy chunks.jsonl into a tmp dir, then build bm25.json there."""
    from rag._bm25 import BM25Retriever
    from rag.retriever import Chunk

    src_chunks = _TOOLKIT / "rag" / "chunks.jsonl"
    assert src_chunks.exists(), f"missing fixture source: {src_chunks}"
    rag_dir = tmp_path_factory.mktemp("rag")
    (rag_dir / "chunks.jsonl").write_bytes(src_chunks.read_bytes())

    chunks: list[Chunk] = []
    with src_chunks.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                chunks.append(Chunk.from_json_line(line))
    r = BM25Retriever()
    r.index(chunks)
    r.save(rag_dir / "bm25.json")
    return rag_dir


@pytest.fixture
def server_mod(rag_dir_with_bm25):
    mod = _load_server_module()
    mod._rag_dir = rag_dir_with_bm25
    mod._system_prompt_path = _TOOLKIT / "llm-system-prompt.md"
    # Reset caches so each test gets a clean lookup.
    mod._chunks_cache = None
    mod._retriever_cache = {}
    return mod


# ── primitives registered ───────────────────────────────────────────


def test_registers_tools_resource_template_and_prompt(server_mod) -> None:
    s = server_mod.build_server()
    tools = asyncio.run(s.list_tools())
    templates = asyncio.run(s.list_resource_templates())
    prompts = asyncio.run(s.list_prompts())
    assert [t.name for t in tools] == [
        "query_rules",
        "list_documents",
        "get_document_outline",
        "get_section",
        "get_block",
        "create_document",
        "insert_block",
        "update_block",
        "delete_block",
        "move_block",
        "validate_block",
    ]
    assert len(templates) == 1
    assert templates[0].uriTemplate == "rag://chunks/{chunk_id}"
    assert [p.name for p in prompts] == ["mxwp_system_prompt"]


# ── tool call: bm25 query for Korean term ───────────────────────────


def test_query_rules_chart_query_ranks_chart_first(server_mod) -> None:
    s = server_mod.build_server()
    result = asyncio.run(
        s.call_tool("query_rules", {"query": "차트", "k": 5, "backend": "bm25"})
    )
    # FastMCP returns a tuple (content_blocks, structured_dict) when
    # structured_output is inferable, else just content_blocks. Normalise.
    if isinstance(result, tuple):
        _content, structured = result
        hits = structured.get("result") if isinstance(structured, dict) else None
        if hits is None:
            hits = structured
    else:
        hits = result
    assert isinstance(hits, list) and hits, f"no hits returned: {result!r}"
    # The top hit must be chart-related — either the English id contains
    # "chart", or the heading contains the Korean "차트".
    top = hits[0]
    assert "chart" in top["id"] or "차트" in top["heading"], (
        f"expected chart-ranked first, got {top!r}"
    )


# ── resource read ───────────────────────────────────────────────────


def test_read_chunk_resource_returns_chunk_text(server_mod) -> None:
    s = server_mod.build_server()
    # Pick a known id from chunks.jsonl.
    chunks_file = server_mod._rag_dir / "chunks.jsonl"
    first_line = chunks_file.read_text(encoding="utf-8").splitlines()[0]
    known_id = json.loads(first_line)["id"]
    known_text = json.loads(first_line)["text"]

    contents = list(asyncio.run(s.read_resource(f"rag://chunks/{known_id}")))
    assert contents, "no content returned"
    payload = json.loads(contents[0].content)
    assert payload["id"] == known_id
    assert payload["text"] == known_text


# ── prompt read ─────────────────────────────────────────────────────


def test_read_mxwp_system_prompt(server_mod) -> None:
    s = server_mod.build_server()
    result = asyncio.run(s.get_prompt("mxwp_system_prompt", {}))
    # GetPromptResult has .messages; each message has .content with text.
    messages = result.messages
    assert messages, "prompt produced no messages"
    text_parts = []
    for m in messages:
        content = m.content
        if hasattr(content, "text"):
            text_parts.append(content.text)
    full = "\n".join(text_parts)
    expected = (_TOOLKIT / "llm-system-prompt.md").read_text(encoding="utf-8")
    assert expected.strip()[:40] in full, "prompt body did not match llm-system-prompt.md"


# ── error: backend without index ────────────────────────────────────


def test_missing_index_returns_helpful_error(server_mod, tmp_path) -> None:
    from mcp.server.fastmcp.exceptions import ToolError

    server_mod._rag_dir = tmp_path  # empty
    server_mod._chunks_cache = None
    server_mod._retriever_cache = {}
    s = server_mod.build_server()
    with pytest.raises(ToolError) as exc:
        asyncio.run(
            s.call_tool("query_rules", {"query": "x", "k": 1, "backend": "bm25"})
        )
    assert "no index" in str(exc.value) and "bm25" in str(exc.value)
