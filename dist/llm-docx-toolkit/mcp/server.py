"""MCP server exposing the RAG toolkit + MXWhitePaper API to MCP clients.

Runs in two modes:
  * stdio (default, also what the frozen PyInstaller binary ships) — token
    comes from env `MXWP_API_TOKEN`.
  * streamable-http (`--http`, hosted by the container Python only — the
    frozen binary does not bundle the HTTP stack) — token comes from each
    request's `Authorization: Bearer …` header, falling back to env.
    Launch from the toolkit root via `python3 -m mcp --http` so `rag` is
    importable (running `server.py` directly omits the toolkit dir from
    sys.path).

RAG primitives: `query_rules` tool, `rag://chunks/{id}` resource template,
`mxwp_system_prompt` prompt. Backends load lazily and are cached so the
model only pays the bootstrap cost on the first query.

Document tools (T1): read — `list_documents` / `get_document_outline` /
`get_section` / `get_block`; write — `create_document` / `insert_block` /
`update_block` / `delete_block` / `move_block`; local — `validate_block`.

Relationship tools (semantic edges — graph-triple-mcp): read —
`get_relationships` (문서의 양방향 typed 엣지 + LLM-legible 문장); write —
`create_relationship` / `delete_relationship` / `extract_relationships`.
단순 링크가 아니라 predicate/inverse_predicate 로 '왜 연결됐는지' 를 설명한다.

Report tools (위키→분석 보고서→Word): 데이터 증강 read — `search_documents`
(전문검색) / `search_knowledge` (시스템지식) / `get_glossary_term` /
`list_glossary` / `get_backlinks`; export — `export_document` (문서를
docx/pptx/pdf/markdown 파일로 저장, raw-bytes). LLM 이 근거를 검색으로 끌어와
보고서를 쓰고 Word 로 받는 흐름을 완성한다.

Write tools require env `MXWP_API_TOKEN` (write scope) and talk to
`MXWP_API_URL` (default http://127.0.0.1:8800). Blocks are validated
locally against packages/shared/schemas/document.json *before* any HTTP
call, and ETag (If-Match) handling is automatic.

The sibling modules `api_client.py` / `schema_validate.py` are loaded by
file path (not `import mcp.…`) because this local package shares the
`mcp` name with the SDK — same dance as `__main__.py`.
"""
from __future__ import annotations

import argparse
import base64
import binascii
import importlib
import importlib.util
import json
import os
import sys
import zipfile
from pathlib import Path
from typing import Any

from mcp.server.fastmcp import FastMCP

from rag._bm25 import BM25Retriever
from rag.retriever import Chunk, Retriever


# The FastMCP instance, stashed by build_server() so per-request helpers can
# reach the active request context (http mode). None until build_server runs.
_MCP: FastMCP | None = None

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


# ── local sibling modules (mcp-SDK name clash dodge) ───────────────


def _local_module(name: str) -> Any:
    """Load mcp/<name>.py under a private alias (frozen build: bare import)."""
    alias = f"_mxwp_{name}"
    if alias in sys.modules:
        return sys.modules[alias]
    path = Path(__file__).resolve().parent / f"{name}.py"
    if path.exists():
        spec = importlib.util.spec_from_file_location(alias, path)
        assert spec is not None and spec.loader is not None
        mod = importlib.util.module_from_spec(spec)
        sys.modules[alias] = mod
        spec.loader.exec_module(mod)
        return mod
    # PyInstaller stage: api_client / schema_validate are flat hiddenimports.
    return importlib.import_module(name)


def _api() -> Any:
    return _local_module("api_client")


def _schema() -> Any:
    return _local_module("schema_validate")


def _request_bearer_token() -> str | None:
    """현재 HTTP 요청의 `Authorization: Bearer …` 에서 토큰 추출.

    stdio 모드(활성 요청 컨텍스트 없음)에서는 예외가 나므로 None 을 돌려
    env 토큰 경로로 떨어뜨린다. RA `_forward_headers` 의 stdio-안전 미러.
    """
    if _MCP is None:
        return None
    try:
        req = _MCP.get_context().request_context.request
    except Exception:
        return None
    if req is None:
        return None
    auth = req.headers.get("authorization")
    if not auth:
        return None
    scheme, _, value = auth.partition(" ")
    if scheme.lower() != "bearer" or not value.strip():
        return None
    return value.strip()


def _make_client() -> Any:
    """Tests monkeypatch this to inject a fake-transport client.

    http 모드면 요청별 Bearer 토큰을, 없으면 env MXWP_API_TOKEN 을 쓴다
    (stdio 경로는 요청 컨텍스트가 없어 항상 env 토큰 — 기존 동작 불변).
    """
    api = _api()
    token = _request_bearer_token() or os.environ.get("MXWP_API_TOKEN", "")
    return api.MxwpClient(
        os.environ.get("MXWP_API_URL", api.DEFAULT_API_URL), token
    )


def _require_token(client: Any) -> None:
    if not getattr(client, "token", ""):
        raise RuntimeError(_api().TOKEN_HELP)


def _raise_block_errors(errors: list[dict[str, str]]) -> None:
    lines = "; ".join(f"{e['path']}: {e['message']}" for e in errors)
    raise RuntimeError(
        f"block schema 검증 실패 (API 호출 안 함) — {lines}. "
        "block JSON 작성법은 query_rules / mxwp_system_prompt 참조."
    )


# ── DocumentJSON helpers (read-side) ───────────────────────────────


_HINT_LEN = 40

# 컨테이너 block 안의 중첩 blocks 위치: columns(list[list]), tabs[].blocks,
# items[].blocks (accordion), cells[].blocks (sparse table).
def _iter_blocks(blocks: list[Any]) -> Any:
    for b in blocks or []:
        if not isinstance(b, dict):
            continue
        yield b
        for col in b.get("columns") or []:
            if isinstance(col, list):
                yield from _iter_blocks(col)
        for tab in b.get("tabs") or []:
            if isinstance(tab, dict):
                yield from _iter_blocks(tab.get("blocks") or [])
        for it in b.get("items") or []:
            if isinstance(it, dict):
                yield from _iter_blocks(it.get("blocks") or [])
        for cell in b.get("cells") or []:
            if isinstance(cell, dict):
                yield from _iter_blocks(cell.get("blocks") or [])


def _walk_sections(sections: list[Any]) -> Any:
    for sec in sections or []:
        if not isinstance(sec, dict):
            continue
        yield sec
        yield from _walk_sections(sec.get("subsections") or [])


def _block_hint(b: dict[str, Any]) -> str:
    t = b.get("type")
    text: Any = ""
    if t == "code":
        text = b.get("language") or ""
    elif t == "list":
        items = b.get("items") or []
        text = items[0] if items else ""
    elif t == "table":
        text = b.get("caption") or " | ".join(
            str(h) for h in (b.get("headers") or [])[:4]
        )
    elif t == "image":
        text = b.get("caption") or b.get("alt") or ""
    elif t == "chart":
        text = b.get("title") or b.get("chartType") or ""
    else:
        for key in ("title", "caption", "label", "text", "term", "expression",
                    "field", "src", "endpoint", "name"):
            v = b.get(key)
            if isinstance(v, str) and v:
                text = v
                break
    s = str(text).replace("\n", " ").strip()
    return s[:_HINT_LEN]


def _slugify(title: str) -> str:
    """schema 의 Slug 패턴 (소문자 ASCII/숫자/하이픈/한글) 에 맞춰 변환."""
    out: list[str] = []
    for ch in title.strip().lower():
        if ch.isascii() and (ch.isalnum()) or "가" <= ch <= "힣" or ch == "-":
            out.append(ch)
        elif ch in (" ", "_", "."):
            out.append("-")
    slug = "".join(out).strip("-")
    while "--" in slug:
        slug = slug.replace("--", "-")
    return slug[:100]


# import kind ↔ 확장자 ↔ multipart content-type.
_IMPORT_KINDS: dict[str, tuple[str, str]] = {
    "docx": ("docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    "pptx": ("pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"),
    "xlsx": ("xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    "pdf": ("pdf", "application/pdf"),
}

_IMAGE_MIME: dict[str, str] = {
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "gif": "image/gif",
    "webp": "image/webp",
    "svg": "image/svg+xml",
}

# base64 업로드 캡 — base64 바이트가 모델 출력 토큰을 그대로 소모하므로
# 작은 이미지로 제한 (초과 시 upload_image_from_url / upload_image 로 유도).
_IMAGE_BASE64_MAX_BYTES = 256 * 1024


def _resolve_import_kind(path: str, kind: str) -> tuple[str, str]:
    """(kind, content_type) — kind='auto' 면 확장자로 판정."""
    if kind and kind != "auto":
        if kind not in _IMPORT_KINDS:
            raise RuntimeError(
                f"지원하지 않는 kind {kind!r} — docx/pptx/xlsx/pdf 중 하나."
            )
        return _IMPORT_KINDS[kind]
    ext = Path(path).suffix.lower().lstrip(".")
    if ext not in _IMPORT_KINDS:
        raise RuntimeError(
            f"확장자로 형식을 판정할 수 없습니다 ({path!r}). "
            "kind 를 docx/pptx/xlsx/pdf 중 하나로 지정하세요."
        )
    return _IMPORT_KINDS[ext]


def _image_mime(path: str) -> str:
    ext = Path(path).suffix.lower().lstrip(".")
    if ext not in _IMAGE_MIME:
        raise RuntimeError(
            f"지원하지 않는 이미지 확장자 ({path!r}) — "
            f"{'/'.join(_IMAGE_MIME)} 중 하나."
        )
    return _IMAGE_MIME[ext]


def _summary_message(summary: dict[str, Any]) -> str:
    """summary dict 를 Claude 가 사용자에게 설명할 한 줄로 요약."""
    counts = ", ".join(
        f"{k} {v}" for k, v in summary.items()
        if k != "warnings" and isinstance(v, int)
    )
    warns = summary.get("warnings") or []
    parts: list[str] = []
    if counts:
        parts.append(counts)
    if warns:
        parts.append(f"경고 {len(warns)}건: " + " / ".join(str(w) for w in warns))
    return "; ".join(parts) if parts else "변환 완료"


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
    global _MCP
    mcp = FastMCP("mxwp-rag")
    _MCP = mcp

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

    # ── document read tools ─────────────────────────────────────────

    @mcp.tool(
        name="list_documents",
        description=(
            "위키 문서 목록 조회. q 로 title/summary 부분 검색. "
            "→ [{slug, title, part, updated_at}]"
        ),
    )
    def list_documents(q: str = "", limit: int = 20) -> list[dict[str, Any]]:
        items = _make_client().list_documents(q=q, limit=limit)
        return [
            {
                "slug": it.get("slug"),
                "title": it.get("title"),
                "part": it.get("part_id"),
                "updated_at": it.get("updated_at"),
            }
            for it in items
        ]

    @mcp.tool(
        name="get_document_outline",
        description=(
            "문서 구조 지도 (토큰 절약용) — 섹션 트리를 평탄화해 각 block 의 "
            "id/type/한 줄 hint 만 반환. 본문 편집 전 항상 먼저 호출. "
            "→ {title, etag, sections:[{id, number, title, blocks:[{id,type,hint}]}]}"
        ),
    )
    def get_document_outline(slug: str) -> dict[str, Any]:
        data, etag = _make_client().get_document(slug)
        content = data.get("content") or {}
        sections = []
        for sec in _walk_sections(content.get("sections") or []):
            sections.append(
                {
                    "id": sec.get("id"),
                    "number": sec.get("number") or "",
                    "title": sec.get("title"),
                    "blocks": [
                        {"id": b.get("id"), "type": b.get("type"), "hint": _block_hint(b)}
                        for b in (sec.get("blocks") or [])
                        if isinstance(b, dict)
                    ],
                }
            )
        return {"title": data.get("title"), "etag": etag, "sections": sections}

    @mcp.tool(
        name="get_section",
        description=(
            "**문서 편집 앱**의 섹션 1개 블록 전체 JSON. 첫 인자는 문서 `slug` 다. "
            "AIDataHub 레코드(record_id)의 섹션이 아니다 — 그건 `get_record_sections` 를 쓴다. "
            "section_id 는 get_document_outline 에서 얻는다."
        ),
    )
    def get_section(slug: str, section_id: str) -> dict[str, Any]:
        data, _etag = _make_client().get_document(slug)
        content = data.get("content") or {}
        for sec in _walk_sections(content.get("sections") or []):
            if sec.get("id") == section_id:
                return sec
        raise RuntimeError(f"section not found: {section_id}")

    @mcp.tool(
        name="get_block",
        description="블록 1개의 전체 JSON. block_id 는 get_document_outline 에서.",
    )
    def get_block(slug: str, block_id: str) -> dict[str, Any]:
        data, _etag = _make_client().get_document(slug)
        content = data.get("content") or {}
        for sec in _walk_sections(content.get("sections") or []):
            for b in _iter_blocks(sec.get("blocks") or []):
                if b.get("id") == block_id:
                    return b
        raise RuntimeError(f"block not found: {block_id}")

    # ── document write tools (MXWP_API_TOKEN 필수) ──────────────────

    @mcp.tool(
        name="create_document",
        description=(
            "새 위키 문서 생성 (빈 '개요' 섹션 1개 포함). slug 생략 시 title 로 "
            "생성 (소문자/한글/하이픈). MXWP_API_TOKEN (write scope) 필수. "
            "→ {slug, url}"
        ),
    )
    def create_document(
        title: str, slug: str = "", part_slug: str = "", summary: str = ""
    ) -> dict[str, Any]:
        client = _make_client()
        _require_token(client)
        api = _api()
        final_slug = slug or _slugify(title)
        if not final_slug:
            raise RuntimeError(
                "slug 를 만들 수 없습니다 — slug 인자를 직접 지정하세요 "
                "(소문자 ASCII/숫자/한글/하이픈)."
            )
        metadata: dict[str, Any] = {
            "division": "MX",
            # owners 는 minItems 1 — 실제 사용자 매핑은 서버가 못 찾으면
            # warnings 로만 표시하므로 placeholder 로 안전.
            "owners": ["mcp@local"],
            "tags": [],
            "confidentiality": "internal",
        }
        if part_slug:
            metadata["part"] = part_slug
        payload: dict[str, Any] = {
            "schema_version": "1.0",
            "id": api.new_ulid(),
            "slug": final_slug,
            "title": title,
            "metadata": metadata,
            "sections": [
                {"id": api.new_ulid(), "level": 1, "title": "개요", "blocks": []}
            ],
        }
        if summary:
            payload["summary"] = summary
        data, _etag = client.create_document(payload)
        return {"slug": data.get("slug"), "url": f"/docs/{data.get('slug')}"}

    @mcp.tool(
        name="insert_block",
        description=(
            "섹션에 block 삽입 (after_block_id 생략 시 맨 뒤). block 의 id 는 "
            "생략 가능 (자동 ULID). 전송 전 로컬 schema 검증 — 실패 시 블록별 "
            "에러를 보고 고쳐 재시도. block JSON 작성법은 query_rules 로 검색. "
            "MXWP_API_TOKEN 필수. → {block_id}"
        ),
    )
    def insert_block(
        slug: str,
        section_id: str,
        block: dict[str, Any],
        after_block_id: str | None = None,
    ) -> dict[str, Any]:
        client = _make_client()
        _require_token(client)
        if isinstance(block, dict) and not block.get("id"):
            block = {**block, "id": _api().new_ulid()}
        errors = _schema().validate_block(block)
        if errors:
            _raise_block_errors(errors)
        _data, etag = client.get_document(slug)
        data, _new_etag = client.insert_block(
            slug, section_id, block, after_block_id or None, etag
        )
        return {"block_id": data.get("block_id") or block.get("id")}

    @mcp.tool(
        name="update_block",
        description=(
            "block 수정 — 부분 키만 보내면 기존 block 에 병합 (서버 PATCH 와 동일 "
            "계약). type 을 바꾸려면 완전한 block 을 보낼 것. 전송 전 병합 결과를 "
            "로컬 schema 검증. MXWP_API_TOKEN 필수. → {ok, version}"
        ),
    )
    def update_block(slug: str, block_id: str, block: dict[str, Any]) -> dict[str, Any]:
        client = _make_client()
        _require_token(client)
        doc, etag = client.get_document(slug)
        content = doc.get("content") or {}
        current: dict[str, Any] | None = None
        for sec in _walk_sections(content.get("sections") or []):
            for b in _iter_blocks(sec.get("blocks") or []):
                if b.get("id") == block_id:
                    current = b
                    break
            if current:
                break
        if current is None:
            raise RuntimeError(f"block not found: {block_id}")
        new_type = block.get("type")
        if new_type and new_type != current.get("type"):
            # type 변경 = 서버의 full-replace 분기 — 완전한 block 필요.
            candidate = {**block, "id": block_id}
        else:
            candidate = {**current, **block, "id": block_id,
                         "type": current.get("type")}
        # 서버가 미지정 optional 을 null 로 돌려줄 수 있다 (e.g. meta: null) —
        # JSON schema 는 '키 없음' 만 허용하므로 null 키는 떨군다.
        candidate = {k: v for k, v in candidate.items() if v is not None}
        errors = _schema().validate_block(candidate)
        if errors:
            _raise_block_errors(errors)
        data, _new_etag = client.patch_block(slug, block_id, candidate, etag)
        return {"ok": True, "version": data.get("version")}

    @mcp.tool(
        name="delete_block",
        description="block 삭제. MXWP_API_TOKEN 필수. → {ok}",
    )
    def delete_block(slug: str, block_id: str) -> dict[str, Any]:
        client = _make_client()
        _require_token(client)
        _data, etag = client.get_document(slug)
        client.delete_block(slug, block_id, etag)
        return {"ok": True}

    @mcp.tool(
        name="move_block",
        description=(
            "block 을 다른 (또는 같은) 섹션으로 이동. after_block_id 생략 시 "
            "맨 뒤. MXWP_API_TOKEN 필수. → {ok}"
        ),
    )
    def move_block(
        slug: str,
        block_id: str,
        target_section_id: str,
        after_block_id: str | None = None,
    ) -> dict[str, Any]:
        client = _make_client()
        _require_token(client)
        _data, etag = client.get_document(slug)
        client.move_block(
            slug, block_id, target_section_id, after_block_id or None, etag
        )
        return {"ok": True}

    @mcp.tool(
        name="validate_block",
        description=(
            "block JSON 로컬 검증 (API 호출 없음) — insert/update 전에 미리 "
            "확인할 때 사용. → {valid, errors:[{path,message}]}"
        ),
    )
    def validate_block(block: dict[str, Any]) -> dict[str, Any]:
        # insert_block 이 id 를 자동 생성하므로, 없으면 같은 조건으로 검증.
        if isinstance(block, dict) and not block.get("id"):
            block = {**block, "id": _api().new_ulid()}
        errors = _schema().validate_block(block)
        return {"valid": not errors, "errors": errors}

    # ── file / image 도구 (MXWP_API_TOKEN 필수) ─────────────────────

    @mcp.tool(
        name="import_file",
        description=(
            "로컬 파일 (docx/pptx/xlsx/pdf) 을 위젯 포함 DocumentJSON 으로 변환. "
            "kind='auto' 면 확장자로 판정. save=True (기본) 면 변환 결과를 위키 "
            "문서로 저장해 slug 반환 ('파일 주면 백서 생성'). save=False 면 저장 "
            "없이 구조 요약만 반환. message 로 분배/경고 결과 설명. "
            "MXWP_API_TOKEN 필수. → {slug?, title, summary, sections, message}"
        ),
    )
    def import_file(path: str, kind: str = "auto", save: bool = True) -> dict[str, Any]:
        client = _make_client()
        _require_token(client)
        resolved_kind, content_type = _resolve_import_kind(path, kind)
        p = Path(path)
        if not p.is_file():
            raise RuntimeError(f"파일을 찾을 수 없습니다: {path}")
        content = p.read_bytes()
        document, summary, _meta = client.import_file(
            resolved_kind,
            filename=p.name,
            content=content,
            content_type=content_type,
        )
        out: dict[str, Any] = {
            "title": document.get("title"),
            "summary": summary,
            "sections": len(document.get("sections") or []),
            "message": _summary_message(summary),
        }
        if save:
            data, _etag = client.create_document(document)
            out["slug"] = data.get("slug")
        return out

    @mcp.tool(
        name="upload_image",
        description=(
            "로컬 이미지 (png/jpg/jpeg/gif/webp/svg) 를 MinIO 에 업로드 → image_id. "
            "동일 내용이 이미 있으면 dedup (deduped=True). image_id 는 "
            "insert_image_block 에 그대로 사용. MXWP_API_TOKEN 필수. "
            "→ {image_id, image_url?, deduped}"
        ),
    )
    def upload_image(path: str) -> dict[str, Any]:
        client = _make_client()
        _require_token(client)
        p = Path(path)
        if not p.is_file():
            raise RuntimeError(f"파일을 찾을 수 없습니다: {path}")
        mime_type = _image_mime(path)
        return client.upload_bytes(
            filename=p.name, content=p.read_bytes(), mime_type=mime_type
        )

    @mcp.tool(
        name="upload_image_from_url",
        description=(
            "웹 URL 의 이미지를 서버가 직접 fetch 해 MinIO 에 저장 → image_id. "
            "바이트가 모델을 안 거치므로 크기무제한. 공개 http/https URL 전용 — "
            "사설/내부 주소는 서버가 차단. 로컬 파일은 upload_image (셸 경로) 또는 "
            "upload_image_base64 (Desktop) 사용. 동일 내용은 dedup. image_id 는 "
            "insert_image_block 에 그대로 사용. MXWP_API_TOKEN 필수. "
            "→ {image_id, image_url?, deduped}"
        ),
    )
    def upload_image_from_url(url: str) -> dict[str, Any]:
        client = _make_client()
        _require_token(client)
        return client.upload_image_from_url(url)

    @mcp.tool(
        name="upload_image_base64",
        description=(
            "로컬 이미지를 base64 로 받아 MinIO 에 업로드 → image_id. Claude Desktop "
            "처럼 로컬 경로를 못 읽는 클라이언트가 PC 의 작은 이미지를 올릴 때 사용 "
            "(data_base64 = 로컬 이미지 파일 바이트의 base64). 작은 이미지 전용 "
            "(≤256KB) — base64 가 모델 출력 토큰을 소모하므로 초과 시 거부하고 "
            "upload_image_from_url 로 안내. 동일 내용은 dedup. MXWP_API_TOKEN 필수. "
            "→ {image_id, image_url?, deduped}"
        ),
    )
    def upload_image_base64(filename: str, data_base64: str) -> dict[str, Any]:
        client = _make_client()
        _require_token(client)
        try:
            content = base64.b64decode(data_base64, validate=True)
        except (binascii.Error, ValueError) as e:
            raise RuntimeError("data_base64 가 올바른 base64 가 아닙니다.") from e
        if not content:
            raise RuntimeError("빈 이미지입니다.")
        if len(content) > _IMAGE_BASE64_MAX_BYTES:
            raise RuntimeError(
                f"이미지가 너무 큽니다 ({len(content) // 1024}KB). base64 업로드는 "
                f"{_IMAGE_BASE64_MAX_BYTES // 1024}KB 이하만 됩니다 — 큰 이미지는 "
                "웹 URL 이면 upload_image_from_url (서버가 직접 받음, 크기무제한), "
                "셸 접근 가능하면 upload_image (로컬 경로) 를 쓰세요."
            )
        mime_type = _image_mime(filename)
        return client.upload_bytes(
            filename=Path(filename).name, content=content, mime_type=mime_type
        )

    @mcp.tool(
        name="extract_pptx_images",
        description=(
            "로컬 .pptx 를 zip 으로 열어 ppt/media/ 의 그림들을 각각 MinIO 에 업로드 "
            "→ image_id 목록. 바이트가 모델을 안 거치고 직접 2-phase 업로드된다 "
            "(base64 미사용). svg/비이미지는 skip. 각 image_id 를 insert_image_block "
            "에 차례로 넣어 슬라이드 그림을 붙인다. MXWP_API_TOKEN 필수. "
            "→ {images:[{image_id, filename}], extracted, skipped}"
        ),
    )
    def extract_pptx_images(path: str) -> dict[str, Any]:
        client = _make_client()
        _require_token(client)
        p = Path(path)
        if not p.is_file():
            raise RuntimeError(f"파일을 찾을 수 없습니다: {path}")
        images: list[dict[str, Any]] = []
        skipped = 0
        with zipfile.ZipFile(p) as zf:
            for name in sorted(zf.namelist()):
                if not name.startswith("ppt/media/"):
                    continue
                ext = Path(name).suffix.lower().lstrip(".")
                if ext not in _IMAGE_MIME or ext == "svg":
                    skipped += 1
                    continue
                content = zf.read(name)
                if not content:
                    skipped += 1
                    continue
                result = client.upload_bytes(
                    filename=Path(name).name,
                    content=content,
                    mime_type=_IMAGE_MIME[ext],
                )
                images.append(
                    {"image_id": result.get("image_id"), "filename": Path(name).name}
                )
        return {"images": images, "extracted": len(images), "skipped": skipped}

    @mcp.tool(
        name="insert_image_block",
        description=(
            "upload_image 로 얻은 image_id 로 ImageBlock 을 섹션에 삽입. "
            "after_block_id 생략 시 맨 뒤. 전송 전 로컬 schema 검증. "
            "MXWP_API_TOKEN 필수. → {block_id}"
        ),
    )
    def insert_image_block(
        slug: str,
        section_id: str,
        image_id: str,
        alt: str = "",
        caption: str = "",
        after_block_id: str | None = None,
    ) -> dict[str, Any]:
        client = _make_client()
        _require_token(client)
        block: dict[str, Any] = {
            "type": "image",
            "id": _api().new_ulid(),
            "imageId": image_id,
            "alt": alt,
        }
        if caption:
            block["caption"] = caption
        errors = _schema().validate_block(block)
        if errors:
            _raise_block_errors(errors)
        _data, etag = client.get_document(slug)
        data, _new_etag = client.insert_block(
            slug, section_id, block, after_block_id or None, etag
        )
        return {"block_id": data.get("block_id") or block.get("id")}

    # ── relationship (semantic edge) tools ──────────────────────────
    # 단순 하이퍼링크가 아니라 문서 사이의 typed 의미 엣지. LLM 이 "이 문서가
    # 무엇의 전제인지 / 무엇에 인용되는지" 를 읽고, 직접 관계를 저술한다.

    @mcp.tool(
        name="get_relationships",
        description=(
            "문서의 의미 관계(양방향 typed 엣지)를 읽는다. 단순 링크가 아니라 "
            "'왜 연결됐는지'(predicate) 가 붙은 관계다. 문서를 깊이 이해할 때 "
            "get_document_outline(본문 구조)과 함께 호출하면 문맥이 풍부해진다. → "
            "{slug, outgoing:[{id,predicate,object,source,sentence}], "
            "incoming:[{id,predicate,inverse,subject,source,sentence}], summary}"
        ),
    )
    def get_relationships(slug: str) -> dict[str, Any]:
        client = _make_client()
        outgoing = [
            {
                "id": t.get("id"),
                "predicate": t.get("predicate"),
                "object": t.get("object_slug"),
                "source": t.get("source"),
                "sentence": f"{slug} --[{t.get('predicate')}]--> {t.get('object_slug')}",
            }
            for t in client.list_triples(subject=slug)
        ]
        incoming = []
        for t in client.list_triples(object=slug):
            subj = t.get("subject_slug")
            inv = t.get("inverse_predicate")
            sentence = f"{subj} --[{t.get('predicate')}]--> {slug}"
            if inv:
                sentence += f"  (역방향: {slug} {inv} {subj})"
            incoming.append(
                {
                    "id": t.get("id"),
                    "predicate": t.get("predicate"),
                    "inverse": inv,
                    "subject": subj,
                    "source": t.get("source"),
                    "sentence": sentence,
                }
            )
        return {
            "slug": slug,
            "outgoing": outgoing,
            "incoming": incoming,
            "summary": f"나가는 관계 {len(outgoing)}개, 들어오는 관계 {len(incoming)}개",
        }

    @mcp.tool(
        name="create_relationship",
        description=(
            "문서 사이에 의미 관계(typed 엣지)를 만든다: subject --predicate--> object. "
            "predicate 는 list_relationship_types 의 캐논에서 고르면 inverse 가 자동 "
            "채워지고 그래프가 일관돼진다(자유텍스트도 허용). inverse_predicate 를 직접 "
            "주면 그 값이 우선(object 쪽에서 읽는 역방향, 예: '에 인용된다'). slug 는 "
            "실재 문서여야 의미 있다(FK 강제는 안 함). → {id, subject_slug, predicate, "
            "object_slug, inverse_predicate, source}"
        ),
    )
    def create_relationship(
        subject_slug: str,
        predicate: str,
        object_slug: str,
        inverse_predicate: str = "",
    ) -> dict[str, Any]:
        client = _make_client()
        _require_token(client)
        try:
            return client.create_triple(
                subject_slug=subject_slug,
                predicate=predicate,
                object_slug=object_slug,
                inverse_predicate=inverse_predicate or None,
            )
        except Exception as e:  # noqa: BLE001 — 409 를 관계-특화 메시지로 변환
            if getattr(e, "status", 0) == 409:
                raise RuntimeError(
                    f"이미 같은 관계가 존재합니다: {subject_slug} '{predicate}' "
                    f"{object_slug}. (inverse 만 바꾸려면 삭제 후 재생성)"
                ) from e
            raise

    @mcp.tool(
        name="delete_relationship",
        description=(
            "관계(triple) 1개를 삭제한다. triple_id 는 get_relationships 결과의 id. "
            "본인이 만든 manual 관계 또는 admin 만 삭제 가능(서버가 강제). → {id, deleted}"
        ),
    )
    def delete_relationship(triple_id: str) -> dict[str, Any]:
        client = _make_client()
        _require_token(client)
        client.delete_triple(triple_id)
        return {"id": triple_id, "deleted": True}

    @mcp.tool(
        name="extract_relationships",
        description=(
            "문서 본문에서 관계를 자동 추출해 저장한다(LLM provider 있으면 실추출, "
            "없으면 mock). 기존 source='llm' 관계를 교체하고 사람이 만든 manual 관계는 "
            "보존한다. → {stored, replaced, extracted:[{predicate, object, inverse}]}"
        ),
    )
    def extract_relationships(slug: str) -> dict[str, Any]:
        client = _make_client()
        _require_token(client)
        data = client.extract_triples(slug)
        return {
            "stored": data.get("stored"),
            "replaced": data.get("replaced"),
            "extracted": [
                {
                    "predicate": t.get("predicate"),
                    "object": t.get("object_slug"),
                    "inverse": t.get("inverse_predicate"),
                }
                for t in (data.get("extracted") or [])
            ],
        }

    @mcp.tool(
        name="list_relationship_types",
        description=(
            "정제된 관계 유형 캐논 목록. create_relationship 의 predicate 를 여기서 "
            "고르면 그래프가 일관되고 inverse_predicate 가 자동 채워진다. → "
            "[{key, predicate, inverse, symmetric, description}]"
        ),
    )
    def list_relationship_types() -> list[dict[str, Any]]:
        return _make_client().list_predicate_types()

    @mcp.tool(
        name="get_related_subgraph",
        description=(
            "문서의 '지식 이웃'을 depth 홉까지 확장한 관계 서브그래프 — 직접 연결을 "
            "넘어 문서가 속한 클러스터를 한 번에 파악한다(get_relationships 의 다중홉 판). "
            "depth 1~4(기본 2). → {root, depth, nodes:[slug], edges:[{...,hop}], "
            "sentences:[LLM-legible], summary}"
        ),
    )
    def get_related_subgraph(slug: str, depth: int = 2) -> dict[str, Any]:
        client = _make_client()
        data = client.get_subgraph(slug, depth)
        edges = data.get("edges") or []
        sentences = [
            f"[{e.get('hop')}홉] {e.get('subject_slug')} --[{e.get('predicate')}]--> "
            f"{e.get('object_slug')}"
            for e in edges
        ]
        nodes = data.get("nodes") or []
        return {
            "root": data.get("root"),
            "depth": data.get("depth"),
            "nodes": nodes,
            "edges": edges,
            "sentences": sentences,
            "summary": f"{len(nodes)}개 문서, {len(edges)}개 관계 (최대 {depth}홉)",
        }

    # ── 데이터 증강 (보고서 근거: 검색 / 시스템지식 / 용어 / 백링크) ────
    # 보고서를 쓸 때 자기 지식만이 아니라 위키의 실제 데이터를 근거로 끌어온다.

    @mcp.tool(
        name="search_documents",
        description=(
            "위키 문서를 전문(full-text) 검색한다. 주제어로 관련 문서를 찾는 1차 진입점 "
            "— 결과 slug 를 get_document_outline / get_relationships 로 이어 읽는다. "
            "→ [{slug, title, snippet, highlights, updated_at, tags, author}]"
        ),
    )
    def search_documents(
        q: str, limit: int = 20, part: str = "", tag: str = "", author: str = "",
    ) -> list[dict[str, Any]]:
        return _make_client().search_documents(
            q, limit=limit, part=part or None, tag=tag or None, author=author or None,
        )

    @mcp.tool(
        name="search_knowledge",
        description=(
            "시스템 지식(docs/lat 코드지도 · 가이드 · archive)을 검색한다. 위키 본문이 "
            "아니라 플랫폼/설계 지식이 필요할 때. kind: lat|guide|doc|archive(선택). "
            "→ [{id, kind, area, doc_path, heading, snippet}]"
        ),
    )
    def search_knowledge(q: str, kind: str = "", limit: int = 20) -> list[dict[str, Any]]:
        return _make_client().search_knowledge(q, kind=kind or None, limit=limit)

    @mcp.tool(
        name="get_glossary_term",
        description=(
            "승인된 용어집에서 용어 1개의 정의를 조회한다. 보고서에서 용어를 정확한 승인 "
            "정의로 서술할 때. → {term, definition, domain, term_en, aliases, related_doc_count}"
        ),
    )
    def get_glossary_term(term: str, domain: str = "") -> dict[str, Any]:
        return _make_client().get_glossary_term(term, domain=domain or None)

    @mcp.tool(
        name="list_glossary",
        description=(
            "승인된 용어 목록/검색(q, domain 선택). 보고서 용어 근거 확보. "
            "→ {items:[{term, definition, domain, ...}], total}"
        ),
    )
    def list_glossary(q: str = "", domain: str = "", size: int = 30) -> dict[str, Any]:
        return _make_client().list_glossary(q=q or None, domain=domain or None, size=size)

    @mcp.tool(
        name="get_backlinks",
        description=(
            "이 문서를 참조하는(가리키는) 문서 목록. 주제의 영향 범위·연관 문서 근거. "
            "→ [{slug, title, sections_referenced, anchor}]"
        ),
    )
    def get_backlinks(slug: str) -> list[dict[str, Any]]:
        return _make_client().get_backlinks(slug)

    # ── export (문서 → Word/PPT/PDF/MD 파일로 저장) ────────────────────

    @mcp.tool(
        name="export_document",
        description=(
            "위키 문서를 파일로 렌더해 로컬 경로에 저장한다. format: docx(Word) | pptx | "
            "pdf | markdown. AI 가 위키를 읽고 작성한 보고서를 Word 파일로 받을 때 사용 "
            "(먼저 create_document 로 저장해 slug 확보 후 호출). 표·리스트·이미지·콜아웃·"
            "코드는 고품질, 차트/수식은 데이터 표/텍스트로 폴백. → {path, size, format, "
            "download_url}"
        ),
    )
    def export_document(slug: str, format: str = "docx", out_path: str = "") -> dict[str, Any]:
        client = _make_client()
        _require_token(client)
        out = out_path or f"{slug}.{format}"
        return client.export_document(slug, format, out)

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
    p.add_argument(
        "--http",
        action="store_true",
        help="Serve over streamable-http instead of stdio (container Python only; "
        "per-request Authorization: Bearer token). Default: stdio.",
    )
    p.add_argument(
        "--host",
        default="127.0.0.1",
        help="Bind host for --http (default: 127.0.0.1).",
    )
    p.add_argument(
        "--port",
        type=int,
        default=8765,
        help="Bind port for --http (default: 8765).",
    )
    args = p.parse_args(argv)
    _rag_dir = (args.rag_dir or _default_rag_dir()).resolve()
    _system_prompt_path = (args.system_prompt or _default_system_prompt()).resolve()
    server = build_server()
    if args.http:
        server.settings.host = args.host
        server.settings.port = args.port
        server.run(transport="streamable-http")
    else:
        server.run("stdio")


if __name__ == "__main__":
    main()
