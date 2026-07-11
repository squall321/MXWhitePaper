# 대화형 채팅 에이전트 — 도구 4종 + LLM 루프 + mock 폴백, SSE 이벤트 스트림.
"""agentic 채팅 코어.

사용자와 대화하며 (1) 코퍼스를 검색·인용하고 (2) 대화 내용을 DocumentJSON
백서로 생성/증분한다. LLM 은 OpenAI 호환(vLLM) — `llm_client` 로 호출하며,
미설정/도달 실패 시 `_run_mock` 으로 폴백해 실 LLM 없이도 도구 흐름이
end-to-end 동작한다 (플레이북 §8).

라우터는 `run(...)` async generator 가 yield 하는 SSE 프레임을 그대로 흘린다.
이벤트 타입: tool_call · tool_result · token · error · done.
"""
from __future__ import annotations

import json
import logging
import re
import secrets
import time
from typing import Any, AsyncIterator

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.search import meili_indexer
from app.services import document_service, llm_client

logger = logging.getLogger(__name__)

_MAX_ROUNDS = 6  # 도구 호출 라운드 상한 (무한 루프 방지)
_CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


# ── ULID / slug 유틸 ─────────────────────────────────────────────────
def _ulid() -> str:
    ts = int(time.time() * 1000)
    head = []
    for _ in range(10):
        head.append(_CROCKFORD[ts & 31]); ts >>= 5
    tail = "".join(secrets.choice(_CROCKFORD) for _ in range(16))
    return "".join(reversed(head)) + tail


def _slugify(title: str) -> str:
    """ASCII kebab. 한글 등으로 비어버리면 chat-doc 접두."""
    s = re.sub(r"[^a-zA-Z0-9]+", "-", title.strip().lower()).strip("-")
    return s[:60] or "chat-doc"


def _normalize_sections(sections: Any) -> list[dict[str, Any]]:
    """LLM 이 sections 를 dict/문자열/누락으로 줘도 list[dict] 로 정규화.

    조립부(_build_documentjson)가 str 이나 dict 를 순회하다 AttributeError 로
    죽는 것을 막는다. 단일 dict 는 리스트로 감싸고, 문자열 원소는 한 섹션으로,
    그 외 형태는 스킵한다.
    """
    if isinstance(sections, dict):
        sections = [sections]
    elif not isinstance(sections, list):
        return []
    out: list[dict[str, Any]] = []
    for sec in sections:
        if isinstance(sec, str):
            sec = {"heading": "내용", "paragraphs": [sec]}
        if isinstance(sec, dict):
            out.append(sec)
    return out


def _normalize_paragraphs(paragraphs: Any) -> list[str]:
    """문단이 단일 문자열이면 글자 단위 분해를 막고 한 문단으로 감싼다."""
    if isinstance(paragraphs, str):
        return [paragraphs]
    if isinstance(paragraphs, list):
        return [str(p) for p in paragraphs]
    return []


# ── DocumentJSON 조립 ────────────────────────────────────────────────
def _build_documentjson(
    *, slug: str, title: str, summary: str, sections: list[dict[str, Any]],
    owner_email: str | None,
) -> dict[str, Any]:
    cfg = get_settings()
    secs: list[dict[str, Any]] = []
    for sec in _normalize_sections(sections):
        heading = str(sec.get("heading") or sec.get("title") or "내용")
        blocks = [
            {"type": "paragraph", "id": _ulid(), "text": str(p)}
            for p in _normalize_paragraphs(sec.get("paragraphs"))
            if str(p).strip()
        ]
        if not blocks:
            blocks = [{"type": "paragraph", "id": _ulid(), "text": ""}]
        secs.append({"id": _ulid(), "level": 1, "title": heading, "blocks": blocks})
    if not secs:
        secs = [{"id": _ulid(), "level": 1, "title": "내용",
                 "blocks": [{"type": "paragraph", "id": _ulid(), "text": summary or title}]}]
    return {
        "schema_version": "1.0",
        "id": _ulid(),
        "slug": slug,
        "title": title[:200] or "제목 없음",
        "metadata": {
            "division": cfg.import_default_division,
            "owners": [owner_email] if owner_email else [],
            "tags": ["chat"],
            "confidentiality": cfg.import_default_confidentiality,
        },
        "summary": (summary or "")[:1000],
        "sections": secs,
    }


# ── 도구 실행부 (서비스 레이어 직접 호출) ────────────────────────────
async def _tool_search_corpus(
    s: AsyncSession, ctx: dict, args: dict
) -> dict[str, Any]:
    query = str(args.get("query") or "").strip()
    limit = min(int(args.get("limit") or 5), 20)
    if not query:
        return {"results": [], "count": 0}
    try:
        res = meili_indexer.search(
            q=query, limit=limit, offset=0, filters={},
            raw_filter_exprs=meili_indexer.role_filter_exprs(ctx.get("role")),
        )
    except Exception as exc:  # noqa: BLE001 — 검색 인덱스 장애 시 빈 결과.
        logger.warning("chat search_corpus 실패: %s", exc)
        return {"results": [], "count": 0, "error": str(exc)}
    hits = res.get("hits", []) if isinstance(res, dict) else []
    results = [
        {
            "slug": h.get("slug"),
            "title": h.get("title"),
            "snippet": (h.get("summary") or h.get("snippet") or "")[:280],
        }
        for h in hits if h.get("slug")
    ]
    return {"results": results, "count": len(results)}


async def _tool_get_document(
    s: AsyncSession, ctx: dict, args: dict
) -> dict[str, Any]:
    slug = str(args.get("slug") or "").strip()
    try:
        row = (await s.execute(
            text("SELECT title, summary, content_json FROM documents WHERE slug = :slug"),
            {"slug": slug},
        )).first()
    except Exception as exc:  # noqa: BLE001 — 조회 실패 시 세션 정리 후 error.
        await s.rollback()
        return {"error": f"문서 조회 실패: {str(exc)[:200]}"}
    if not row:
        return {"error": f"문서를 찾을 수 없습니다: {slug}"}
    content = row[2] if isinstance(row[2], dict) else {}
    titles = [
        str(sec.get("title"))
        for sec in (content.get("sections") or [])
        if isinstance(sec, dict) and sec.get("title")
    ]
    return {"slug": slug, "title": row[0], "summary": row[1], "section_titles": titles}


async def _tool_create_document(
    s: AsyncSession, ctx: dict, args: dict
) -> dict[str, Any]:
    title = str(args.get("title") or "").strip()
    if not title:
        return {"error": "title 이 필요합니다"}
    summary = str(args.get("summary") or "")
    sections = args.get("sections") or []
    base = _slugify(title)
    # slug 충돌 시 짧은 접미로 재시도.
    for attempt in range(4):
        slug = base if attempt == 0 else f"{base}-{secrets.token_hex(2)}"
        try:
            # 조립도 try 안에서 — LLM 이 준 비정형 sections 로 죽어도 error 로 전달.
            doc = _build_documentjson(
                slug=slug, title=title, summary=summary, sections=sections,
                owner_email=ctx.get("actor_email"),
            )
            created, _warn = await document_service.create_document(
                s, payload=doc, owner_id=ctx["actor_id"],
            )
            return {"slug": created["slug"], "title": created["title"],
                    "url_path": f"/docs/{created['slug']}"}
        except Exception as exc:  # noqa: BLE001
            msg = str(exc).lower()
            await s.rollback()
            if "slug" in msg and ("unique" in msg or "already" in msg or "중복" in msg or "exist" in msg or "duplicate" in msg):
                continue  # slug 충돌 — 접미 붙여 재시도
            # slug 충돌이 아닌데 문서가 이미 있으면 = 커밋 성공 후 부수효과
            # (meili/webhook) 실패 → 생성은 완료된 것이므로 성공으로 취급.
            committed = (await s.execute(
                text("SELECT slug, title FROM documents WHERE slug = :slug"),
                {"slug": slug},
            )).first()
            if committed:
                logger.warning(
                    "chat create_document 커밋 후 부수효과 실패(문서는 생성됨): %s", exc
                )
                return {"slug": committed[0], "title": committed[1],
                        "url_path": f"/docs/{committed[0]}"}
            return {"error": f"문서 생성 실패: {str(exc)[:200]}"}
    return {"error": "slug 충돌로 문서 생성 실패"}


async def _tool_append_section(
    s: AsyncSession, ctx: dict, args: dict
) -> dict[str, Any]:
    slug = str(args.get("slug") or "").strip()
    heading = str(args.get("heading") or "내용")
    paragraphs = args.get("paragraphs")
    try:
        row = (await s.execute(
            text("SELECT id, version, content_json FROM documents WHERE slug = :slug"),
            {"slug": slug},
        )).first()
    except Exception as exc:  # noqa: BLE001 — 조회 실패 시 세션 정리 후 error.
        await s.rollback()
        return {"error": f"문서 조회 실패: {str(exc)[:200]}"}
    if not row:
        return {"error": f"문서를 찾을 수 없습니다: {slug}"}
    doc_id, version, content = row[0], row[1], (row[2] if isinstance(row[2], dict) else {})
    content.setdefault("sections", [])
    blocks = [
        {"type": "paragraph", "id": _ulid(), "text": str(p)}
        for p in _normalize_paragraphs(paragraphs) if str(p).strip()
    ] or [{"type": "paragraph", "id": _ulid(), "text": ""}]
    content["sections"].append(
        {"id": _ulid(), "level": 1, "title": heading, "blocks": blocks}
    )
    if_match = document_service.make_etag(str(doc_id), int(version))
    try:
        await document_service.replace_document(
            s, slug=slug, payload=content, if_match=if_match,
            actor_id=ctx["actor_id"], change_log="chat append",
        )
    except Exception as exc:  # noqa: BLE001
        await s.rollback()
        return {"error": f"섹션 추가 실패: {str(exc)[:200]}"}
    return {"slug": slug, "heading": heading,
            "section_count": len(content["sections"]), "url_path": f"/docs/{slug}"}


_TOOLS = {
    "search_corpus": _tool_search_corpus,
    "get_document": _tool_get_document,
    "create_document": _tool_create_document,
    "append_section": _tool_append_section,
}

# OpenAI 호환 tool 스펙 (vLLM 에 전달).
_TOOL_SPECS = [
    {"type": "function", "function": {
        "name": "search_corpus",
        "description": "MX 백서 위키(코퍼스)를 전문 검색해 관련 문서를 찾는다. 답변에 근거를 인용할 때 먼저 호출한다.",
        "parameters": {"type": "object", "properties": {
            "query": {"type": "string", "description": "검색어"},
            "limit": {"type": "integer", "description": "최대 결과 수 (기본 5)"},
        }, "required": ["query"]},
    }},
    {"type": "function", "function": {
        "name": "get_document",
        "description": "slug 로 특정 백서의 요약과 섹션 제목을 읽는다. 증분(append) 전에 현재 구성을 확인할 때 쓴다.",
        "parameters": {"type": "object", "properties": {
            "slug": {"type": "string"},
        }, "required": ["slug"]},
    }},
    {"type": "function", "function": {
        "name": "create_document",
        "description": "대화 내용을 새 백서 문서로 만든다. 산문·설명은 한국어로, 전문용어/키워드/수식은 원문 보존. 만들기 전 사용자에게 제목·범위를 확인하는 것이 좋다.",
        "parameters": {"type": "object", "properties": {
            "title": {"type": "string", "description": "문서 제목(한국어 가능)"},
            "summary": {"type": "string", "description": "1~2문장 요약"},
            "sections": {"type": "array", "description": "섹션 목록", "items": {
                "type": "object", "properties": {
                    "heading": {"type": "string"},
                    "paragraphs": {"type": "array", "items": {"type": "string"}},
                }, "required": ["heading", "paragraphs"]}},
        }, "required": ["title", "sections"]},
    }},
    {"type": "function", "function": {
        "name": "append_section",
        "description": "기존 백서(slug)에 새 섹션을 덧붙인다.",
        "parameters": {"type": "object", "properties": {
            "slug": {"type": "string"},
            "heading": {"type": "string"},
            "paragraphs": {"type": "array", "items": {"type": "string"}},
        }, "required": ["slug", "heading", "paragraphs"]},
    }},
]

_SYSTEM_PROMPT = (
    "너는 MX 백서 위키의 저작 도우미다. 사용자와 한국어로 대화하며 두 가지를 한다: "
    "(1) 코퍼스(기존 백서)를 search_corpus 로 검색해 근거와 함께 답한다. "
    "(2) 대화 내용을 create_document / append_section 도구로 백서 문서로 정리해 올린다. "
    "규칙: 산문·설명은 한국어로 쓰되 *KEYWORD·변수명·수식·화학식·단위 등 원문 표기는 보존한다. "
    "문서를 새로 만들기 전에는 제목과 담을 범위를 사용자에게 간단히 확인한다. "
    "도구 결과의 slug 는 답변에서 [제목](/docs/slug) 형태로 링크한다."
)


# ── SSE 프레임 ──────────────────────────────────────────────────────
def _sse(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _tool_summary(name: str, result: dict[str, Any]) -> dict[str, Any]:
    """FE 카드용 요약 + 링크."""
    if result.get("error"):
        return {"name": name, "ok": False, "summary": result["error"]}
    if name == "search_corpus":
        return {"name": name, "ok": True,
                "summary": f"{result.get('count', 0)}건 검색됨",
                "results": result.get("results", [])}
    if name in ("create_document", "append_section"):
        return {"name": name, "ok": True,
                "summary": f"{result.get('title') or result.get('slug')}",
                "link": result.get("url_path"), "slug": result.get("slug")}
    if name == "get_document":
        return {"name": name, "ok": True,
                "summary": f"{result.get('title')} — 섹션 {len(result.get('section_titles', []))}개"}
    return {"name": name, "ok": True, "summary": "완료"}


# ── 공개 진입점 ─────────────────────────────────────────────────────
async def run(
    s: AsyncSession, *, ctx: dict[str, Any], messages: list[dict[str, Any]]
) -> AsyncIterator[str]:
    """채팅 1턴을 실행하며 SSE 프레임을 yield 한다.

    ctx: {actor_id, actor_email, role}. messages: [{role, content}, ...].
    """
    if llm_client.is_live():
        started = False  # _run_llm 이 프레임을 하나라도 내보냈는지
        try:
            async for frame in _run_llm(s, ctx, messages):
                started = True
                yield frame
            return
        except Exception as exc:  # noqa: BLE001 — LLM 실패 처리.
            logger.warning("chat LLM 실패: %s", exc)
            if started:
                # 이미 tool_call/문서생성 등 출력이 나갔다 — mock 을 처음부터
                # 재실행하면 문서 이중 생성·프레임 뒤섞임이 생긴다. error+done 으로만 닫는다.
                yield _sse("error", {"message": f"LLM 처리 중 오류: {str(exc)[:200]}"})
                yield _sse("done", {})
                return
            # 출력이 시작되기 전 실패 → mock 으로 폴백.
            yield _sse("token", {"text": "(LLM 연결 실패 — mock 모드로 처리합니다)\n"})
    async for frame in _run_mock(s, ctx, messages):
        yield frame


async def _run_llm(
    s: AsyncSession, ctx: dict, messages: list[dict]
) -> AsyncIterator[str]:
    convo: list[dict[str, Any]] = [{"role": "system", "content": _SYSTEM_PROMPT}]
    convo.extend({"role": m["role"], "content": m.get("content", "")} for m in messages)
    for _round in range(_MAX_ROUNDS):
        msg = await llm_client.complete(convo, tools=_TOOL_SPECS)
        convo.append(msg)
        tool_calls = msg.get("tool_calls") or []
        if not tool_calls:
            content = msg.get("content") or ""
            if content:
                yield _sse("token", {"text": content})
            yield _sse("done", {})
            return
        for tc in tool_calls:
            fn = (tc.get("function") or {})
            name = fn.get("name")
            # id 가 없으면 합성 — assistant/tool 메시지 쌍의 tool_call_id 가
            # None 이면 다음 라운드 요청이 400 날 수 있다. tc 는 convo 에 append
            # 된 assistant msg 의 동일 객체라 여기서 패치하면 쌍이 일치한다.
            call_id = tc.get("id") or f"call_{_ulid()}"
            tc["id"] = call_id
            try:
                raw_args = fn.get("arguments") or "{}"
                args = json.loads(raw_args) if isinstance(raw_args, str) else raw_args
            except json.JSONDecodeError:
                args = {}
            if not isinstance(args, dict):
                args = {}
            yield _sse("tool_call", {"name": name, "args": args})
            handler = _TOOLS.get(name)
            result = (await handler(s, ctx, args)) if handler else {"error": f"알 수 없는 도구: {name}"}
            yield _sse("tool_result", _tool_summary(name or "", result))
            convo.append({
                "role": "tool", "tool_call_id": call_id,
                "content": json.dumps(result, ensure_ascii=False),
            })
    yield _sse("token", {"text": "(도구 호출 한도에 도달했습니다)"})
    yield _sse("done", {})


_CREATE_INTENT = re.compile(r"작성|문서|올려|올리|정리|만들|기록|추가|저장")


async def _run_mock(
    s: AsyncSession, ctx: dict, messages: list[dict]
) -> AsyncIterator[str]:
    """LLM 미연결용 휴리스틱 에이전트 — 실제 도구를 태워 흐름을 시연한다."""
    last = next((m.get("content", "") for m in reversed(messages)
                 if m.get("role") == "user"), "")
    last = (last or "").strip()
    if _CREATE_INTENT.search(last):
        title = (last.splitlines()[0] if last else "새 문서").strip()[:60] or "새 문서"
        args = {"title": title, "summary": "채팅으로 작성된 문서 (mock 모드)",
                "sections": [{"heading": "내용", "paragraphs": [last]}]}
        yield _sse("tool_call", {"name": "create_document", "args": args})
        result = await _tool_create_document(s, ctx, args)
        yield _sse("tool_result", _tool_summary("create_document", result))
        if result.get("error"):
            yield _sse("token", {"text": f"(mock 모드) 문서 생성에 실패했습니다: {result['error']}"})
        else:
            yield _sse("token", {"text":
                f"(mock 모드) 요청을 백서로 저장했습니다 — [{result['title']}]({result['url_path']}). "
                "실제 LLM(vLLM)을 연결하면 대화 맥락을 반영해 제목·구성을 더 정교하게 작성합니다."})
        yield _sse("done", {})
        return
    # 그 외 → 검색
    args = {"query": last or "", "limit": 5}
    yield _sse("tool_call", {"name": "search_corpus", "args": args})
    result = await _tool_search_corpus(s, ctx, args)
    yield _sse("tool_result", _tool_summary("search_corpus", result))
    # 결과 링크는 위 🔎 카드가 이미 보여주므로 산문에선 중복 나열하지 않는다.
    cnt = result.get("count", 0)
    yield _sse("token", {"text":
        f"(mock 모드) '{last}' 검색 결과 {cnt}건입니다 — 아래 카드에서 확인하세요. "
        "실제 LLM 연결 시 근거를 종합해 답변합니다." if cnt else
        f"(mock 모드) '{last}' 에 대한 검색 결과가 없습니다. 실제 LLM 연결 시 더 넓게 탐색합니다."})
    yield _sse("done", {})
