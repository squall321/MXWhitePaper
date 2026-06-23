"""MCP stdio server exposing the RAG toolkit + MXWhitePaper API to MCP clients.

RAG primitives: `query_rules` tool, `rag://chunks/{id}` resource template,
`mxwp_system_prompt` prompt. Backends load lazily and are cached so the
model only pays the bootstrap cost on the first query.

Document tools (T1): read — `list_documents` / `get_document_outline` /
`get_section` / `get_block`; write — `create_document` / `insert_block` /
`update_block` / `delete_block` / `move_block`; local — `validate_block`.
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
import sys
import zipfile
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


def _make_client() -> Any:
    """Tests monkeypatch this to inject a fake-transport client."""
    return _api().MxwpClient.from_env()


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
        description="섹션 1개의 블록 전체 JSON. section_id 는 get_document_outline 에서.",
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
