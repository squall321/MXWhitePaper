"""MCP stdio server exposing the RAG toolkit to MCP clients.

One tool (`query_rules`), one resource template (`rag://chunks/{id}`), and
one prompt (`mxwp_system_prompt`). Backends load lazily and are cached so
the model only pays the bootstrap cost on the first query.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from mcp.server.fastmcp import FastMCP

from rag._bm25 import BM25Retriever
from rag.retriever import Chunk, Retriever


# Resolved on startup; refers to the directory holding chunks.jsonl + index files.
_rag_dir: Path | None = None
_chunks_cache: dict[str, Chunk] | None = None
_retriever_cache: dict[str, Retriever] = {}
_system_prompt_path: Path | None = None


def _default_rag_dir() -> Path:
    # When frozen by PyInstaller, sys._MEIPASS points at the bundle root; the
    # rag/ folder is shipped alongside the binary in either case.
    base = Path(getattr(sys, "_MEIPASS", "")) if getattr(sys, "frozen", False) else Path(__file__).resolve().parent.parent
    return base / "rag"


def _default_system_prompt() -> Path:
    base = Path(getattr(sys, "_MEIPASS", "")) if getattr(sys, "frozen", False) else Path(__file__).resolve().parent.parent
    return base / "llm-system-prompt.md"


def _load_chunks() -> dict[str, Chunk]:
    global _chunks_cache
    if _chunks_cache is not None:
        return _chunks_cache
    assert _rag_dir is not None
    path = _rag_dir / "chunks.jsonl"
    if not path.exists():
        raise RuntimeError(f"chunks.jsonl missing at {path}")
    by_id: dict[str, Chunk] = {}
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            c = Chunk.from_json_line(line)
            by_id[c.id] = c
    _chunks_cache = by_id
    return by_id


def _get_retriever(backend: str) -> Retriever:
    if backend in _retriever_cache:
        return _retriever_cache[backend]
    assert _rag_dir is not None
    if backend == "bm25":
        path = _rag_dir / "bm25.json"
        if not path.exists():
            raise RuntimeError(
                "backend 'bm25' has no index — run mxwp-rules index --backend bm25"
            )
        r: Retriever = BM25Retriever()
        r.load(_rag_dir)
    elif backend == "st":
        if not (_rag_dir / "embeddings.npz").exists():
            raise RuntimeError(
                "backend 'st' has no index — run mxwp-rules index --backend st"
            )
        from rag._st import STRetriever  # heavy import, lazy
        r = STRetriever()
        r.load(_rag_dir)
    elif backend == "openai":
        if not (_rag_dir / "embeddings.npz").exists():
            raise RuntimeError(
                "backend 'openai' has no index — run mxwp-rules index --backend openai"
            )
        from rag._openai import OpenAIRetriever  # heavy import, lazy
        r = OpenAIRetriever()
        r.load(_rag_dir)
    else:
        raise ValueError(f"unknown backend {backend!r}; expected one of: st, bm25, openai")
    _retriever_cache[backend] = r
    return r


# ── server build ───────────────────────────────────────────────────


def build_server() -> FastMCP:
    """Construct the FastMCP server with tool/resource/prompt registered.

    Factored out so tests can instantiate without touching argparse / stdio.
    """
    mcp = FastMCP("mxwp-rag")

    @mcp.tool(
        name="query_rules",
        description=(
            "Search MXWhitePaper docx writing rules. Returns top-k chunks "
            "(id, heading, score, text) for a natural-language query."
        ),
    )
    def query_rules(query: str, k: int = 5, backend: str = "bm25") -> list[dict[str, Any]]:
        r = _get_retriever(backend)
        hits = r.query(query, k=k)
        return [
            {
                "id": h.chunk.id,
                "heading": h.chunk.heading,
                "score": h.score,
                "text": h.chunk.text,
            }
            for h in hits
        ]

    @mcp.resource(
        "rag://chunks/{chunk_id}",
        description="Full text + metadata of a single RAG chunk by id.",
        mime_type="application/json",
    )
    def read_chunk(chunk_id: str) -> str:
        chunks = _load_chunks()
        if chunk_id not in chunks:
            raise RuntimeError(f"chunk not found: {chunk_id}")
        c = chunks[chunk_id]
        return json.dumps(
            {
                "id": c.id,
                "source": c.source,
                "heading": c.heading,
                "text": c.text,
                "metadata": c.metadata,
            },
            ensure_ascii=False,
        )

    @mcp.prompt(
        name="mxwp_system_prompt",
        description="System prompt for LLMs producing MXWhitePaper-compatible docx files.",
    )
    def mxwp_system_prompt() -> str:
        assert _system_prompt_path is not None
        if not _system_prompt_path.exists():
            raise RuntimeError(f"system prompt missing at {_system_prompt_path}")
        return _system_prompt_path.read_text(encoding="utf-8")

    return mcp


# ── entry point ────────────────────────────────────────────────────


def main(argv: list[str] | None = None) -> None:
    global _rag_dir, _system_prompt_path
    p = argparse.ArgumentParser(prog="mxwp-mcp")
    p.add_argument("--version", action="version", version="mxwp-mcp 1.0.0")
    p.add_argument(
        "--rag-dir",
        type=Path,
        default=None,
        help="Directory holding chunks.jsonl + index files (default: ./rag next to binary).",
    )
    p.add_argument(
        "--system-prompt",
        type=Path,
        default=None,
        help="Path to llm-system-prompt.md (default: sibling to binary).",
    )
    args = p.parse_args(argv)
    _rag_dir = (args.rag_dir or _default_rag_dir()).resolve()
    _system_prompt_path = (args.system_prompt or _default_system_prompt()).resolve()
    server = build_server()
    server.run("stdio")


if __name__ == "__main__":
    main()
