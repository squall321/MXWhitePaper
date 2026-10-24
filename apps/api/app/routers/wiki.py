# 위키 REST(/api/v1/wiki) — 원천 받기 · 목록 · 한 건 · 철회 · 기록(log · log.md) · 상태(health). WIKI_ENABLED 가 꺼지면 모두 404
"""CONTRACTS §6 · §10 · §11. 지은 것은 docs/lat/wiki.md §REST 가 정본.

`/health` 는 인증이 없다(포털 상태판이 읽는다) — 그래서 수 · 시각만 내고 실패 글(예외 꼬리에 원천 글이 섞일 수 있다)은 내지 않는다.
"""
from __future__ import annotations

import time
from datetime import datetime
from typing import Any, Literal
from uuid import UUID

import httpx
from fastapi import APIRouter, Body, Depends, Query
from fastapi.responses import JSONResponse, PlainTextResponse, StreamingResponse
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import require_admin, require_editor, require_reader
from app.core.config import get_settings
from app.core.db import get_db, session_factory
from app.core.errors import APIError, ValidationFailed, envelope, format_pydantic_errors
from app.wiki import (
    audience,
    candidates,
    catalog,
    entities,
    fileback,
    jobs,
    ontology,
    query,
    questions,
    review,
    schema_doc,
    sources,
)
from app.wiki.envelope import SourceEnvelope


class _WikiDisabledError(APIError):
    http_status = 404
    code = "wiki_disabled"
    message = "위키가 꺼져 있다(WIKI_ENABLED)"


def _enabled() -> None:
    if not get_settings().wiki_enabled:
        raise _WikiDisabledError()


router = APIRouter(prefix="/api/v1/wiki", tags=["wiki"], dependencies=[Depends(_enabled)])

_LLM_TTL_S = 30.0
_llm_state: tuple[float, str] | None = None


async def _llm_reachability() -> str:
    """`ok` · `unreachable` · `unset` — 상태판이 자주 부르니 30초 담아 둔다."""
    global _llm_state
    now = time.monotonic()
    if _llm_state is not None and now - _llm_state[0] < _LLM_TTL_S:
        return _llm_state[1]
    st = get_settings()
    base = st.wiki_llm_base_url.strip().rstrip("/")
    if not base:
        state = "unset"
    else:
        headers = {"Authorization": f"Bearer {st.wiki_llm_api_key}"} if st.wiki_llm_api_key else {}
        try:
            async with httpx.AsyncClient(timeout=3.0) as c:
                r = await c.get(f"{base}/models", headers=headers)
            state = "ok" if r.status_code == 200 else "unreachable"
        except httpx.HTTPError:
            state = "unreachable"
    _llm_state = (now, state)
    return state


@router.post("/sources")
async def post_source(
    body: dict[str, Any] = Body(...),
    ingest: bool = Query(True, description="0 이면 들이기 작업을 줄 세우지 않는다"),
    user: dict[str, Any] = Depends(require_editor),
    s: AsyncSession = Depends(get_db),
) -> JSONResponse:
    try:
        env = SourceEnvelope.model_validate(body)
    except ValidationError as e:
        # format_pydantic_errors 는 맨 앞 'body' 를 요청 껍데기로 보고 뗀다 — 봉투의 body 칸이 사라지지 않게 껍데기를 하나 씌운다.
        errors = [{**err, "loc": ("body", *err["loc"])} for err in e.errors(include_url=False)]
        raise ValidationFailed("봉투가 mxwp-source/1 꼴이 아니다 — details 의 field · message 를 보라",
                               details={"errors": format_pydantic_errors(errors)}) from None
    got = await sources.receive(s, env, caller=user, ingest=ingest)
    data = {"id": got.id, "short": sources.short_id(got.id), "dedup": got.dedup, "doc_slug": got.doc_slug,
            "ingest_state": got.ingest_state}
    return JSONResponse(status_code=200 if got.dedup else 201, content=envelope(data=data))


@router.get("/sources")
async def get_sources(
    kind: str | None = None,
    system: str | None = None,
    status: str | None = None,
    since: datetime | None = None,
    until: datetime | None = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    _: dict[str, Any] = Depends(require_reader),
    s: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    rows, total = await sources.list_sources(s, kind=kind, system=system, status=status, since=since, until=until,
                                             limit=limit, offset=offset)
    return envelope(data=rows, meta={"total": total, "limit": limit, "offset": offset})


@router.get("/sources/{source_id}")
async def get_source(
    source_id: UUID, _: dict[str, Any] = Depends(require_reader), s: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    return envelope(data=await sources.get_source(s, str(source_id)))


@router.get("/pages/{slug}")
async def get_page(slug: str, _: dict[str, Any] = Depends(require_reader), s: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    return envelope(data=await sources.page_info(s, slug))


@router.post("/sources/{source_id}/withdraw")
async def withdraw_source(
    source_id: UUID, user: dict[str, Any] = Depends(require_reader), s: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    return envelope(data=await sources.withdraw(s, str(source_id), caller=user))


class _IngestBody(BaseModel):
    source_ids: list[UUID] = Field(min_length=1, max_length=50)


class _Decision(BaseModel):
    note: str | None = Field(default=None, max_length=1000)


@router.post("/ingest")
async def post_ingest(
    body: _IngestBody, user: dict[str, Any] = Depends(require_editor), s: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    return envelope(data=await sources.enqueue_ingest(s, [str(x) for x in body.source_ids], caller=user))


@router.get("/changes")
async def get_changes(
    status: str | None = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    user: dict[str, Any] = Depends(require_reader),
    s: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    await review.require_reviewer(s, user)
    rows, total = await review.list_changes(s, status=status, limit=limit, offset=offset)
    return envelope(data=rows, meta={"total": total, "limit": limit, "offset": offset})


@router.get("/changes/{cs_id}")
async def get_change(
    cs_id: UUID, user: dict[str, Any] = Depends(require_reader), s: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    await review.require_reviewer(s, user)
    return envelope(data=await review.get_change(s, str(cs_id)))


@router.post("/changes/{cs_id}/approve")
async def approve_change(
    cs_id: UUID, body: _Decision | None = None, user: dict[str, Any] = Depends(require_reader),
    s: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    return envelope(data=await review.approve(s, str(cs_id), user=user, note=body.note if body else None))


@router.post("/changes/{cs_id}/reject")
async def reject_change(
    cs_id: UUID, body: _Decision, user: dict[str, Any] = Depends(require_reader), s: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    return envelope(data=await review.reject(s, str(cs_id), user=user, note=body.note))


@router.post("/changes/{cs_id}/revert")
async def revert_change(
    cs_id: UUID, user: dict[str, Any] = Depends(require_reader), s: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    return envelope(data=await review.revert(s, str(cs_id), user=user))


@router.get("/log")
async def get_log(
    limit: int = Query(100, ge=1, le=500),
    since: datetime | None = None,
    _: dict[str, Any] = Depends(require_reader),
    s: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    return envelope(data=await sources.list_log(s, limit=limit, since=since))


@router.get("/log.md", response_class=PlainTextResponse)
async def get_log_md(
    limit: int = Query(500, ge=1, le=2000),
    since: datetime | None = None,
    _: dict[str, Any] = Depends(require_reader),
    s: AsyncSession = Depends(get_db),
) -> PlainTextResponse:
    entries = await sources.list_log(s, limit=limit, since=since)
    return PlainTextResponse(sources.log_markdown(entries), media_type="text/markdown; charset=utf-8")


class _SchemaBody(BaseModel):
    yaml: str = Field(min_length=1, max_length=200_000)


@router.get("/index")
async def get_index(_: dict[str, Any] = Depends(require_reader), s: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    return envelope(data=await catalog.build(s))


@router.get("/index.md", response_class=PlainTextResponse)
async def get_index_md(_: dict[str, Any] = Depends(require_reader), s: AsyncSession = Depends(get_db)) -> PlainTextResponse:
    return PlainTextResponse(catalog.markdown(await catalog.build(s)), media_type="text/markdown; charset=utf-8")


@router.get("/schema")
async def get_schema(_: dict[str, Any] = Depends(require_reader), s: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    return envelope(data=await schema_doc.current(s))


@router.put("/schema")
async def put_schema(
    body: _SchemaBody, user: dict[str, Any] = Depends(require_admin), s: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    return envelope(data=await schema_doc.put(s, body.yaml, user=user))


@router.get("/ontology")
async def get_ontology(
    status: Literal["approved", "proposed", "rejected"] | None = None,
    _: dict[str, Any] = Depends(require_reader),
    s: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    return envelope(data=await ontology.listing(s, status=status))


@router.post("/ontology/types", status_code=201)
async def propose_type(
    body: ontology.TypeProposal, user: dict[str, Any] = Depends(require_editor), s: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    return envelope(data=await ontology.propose_type(s, body, user=user))


@router.post("/ontology/predicates", status_code=201)
async def propose_predicate(
    body: ontology.PredicateProposal, user: dict[str, Any] = Depends(require_editor), s: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    return envelope(data=await ontology.propose_predicate(s, body, user=user))


@router.post("/ontology/{kind}/{key}/approve")
async def approve_ontology(
    kind: ontology.Kind, key: str, body: _Decision | None = None, user: dict[str, Any] = Depends(require_admin),
    s: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    return envelope(data=await ontology.decide(s, kind, key, approve=True, user=user, note=body.note if body else None))


@router.post("/ontology/{kind}/{key}/reject")
async def reject_ontology(
    kind: ontology.Kind, key: str, body: _Decision, user: dict[str, Any] = Depends(require_admin),
    s: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    return envelope(data=await ontology.decide(s, kind, key, approve=False, user=user, note=body.note))


@router.get("/entities")
async def get_entities(
    type: str | None = None,
    q: str | None = Query(None, max_length=200),
    status: Literal["active", "merged", "retired"] = "active",
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    _: dict[str, Any] = Depends(require_reader),
    s: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    rows, total = await entities.list_entities(s, type_key=type, q=q, status=status, limit=limit, offset=offset)
    return envelope(data=rows, meta={"total": total, "limit": limit, "offset": offset})


@router.get("/entities/duplicates")
async def get_entity_duplicates(user: dict[str, Any] = Depends(require_reader), s: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    await review.require_reviewer(s, user)
    return envelope(data=await entities.duplicates(s))


@router.get("/entities/{entity_id}")
async def get_entity(entity_id: UUID, _: dict[str, Any] = Depends(require_reader),
                     s: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    return envelope(data=await entities.get_entity(s, str(entity_id)))


@router.patch("/entities/{entity_id}")
async def patch_entity(
    entity_id: UUID, body: entities.EntityPatch, user: dict[str, Any] = Depends(require_editor),
    s: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    return envelope(data=await entities.update_entity(s, str(entity_id), body, user=user))


class _MergeBody(BaseModel):
    from_id: UUID
    into_id: UUID
    note: str | None = Field(default=None, max_length=1000)


@router.post("/entities/merge", status_code=201)
async def post_entity_merge(
    body: _MergeBody, user: dict[str, Any] = Depends(require_editor), s: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    return envelope(data=await entities.propose_merge(s, str(body.from_id), str(body.into_id), user=user, note=body.note))


_QUERY_WINDOW_S, _QUERY_LIMIT = 60.0, 20
_query_hist: dict[str, list[float]] = {}


class _QueryRateLimited(APIError):
    http_status = 429
    code = "RATE_LIMITED"
    message = "묻기 한도 초과 — 잠시 후 다시"


class _Msg(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=20_000)


class _QueryBody(BaseModel):
    messages: list[_Msg] = Field(min_length=1, max_length=20, description="마지막이 물음(user) — 앞은 이어지는 대화")


@router.post("/query")
async def post_query(body: _QueryBody, user: dict[str, Any] = Depends(require_reader)) -> StreamingResponse:
    """SSE — 위키로 답한다(tool_call · tool_result · token · citation · miss · error · done)."""
    if body.messages[-1].role != "user":
        raise ValidationFailed("마지막 말은 물음(user)이어야 한다")
    now = time.monotonic()
    hist = [t for t in _query_hist.get(str(user["id"]), []) if t >= now - _QUERY_WINDOW_S]
    if len(hist) >= _QUERY_LIMIT:
        raise _QueryRateLimited(details={"window_seconds": int(_QUERY_WINDOW_S), "limit": _QUERY_LIMIT})
    _query_hist[str(user["id"])] = [*hist, now]
    viewer = audience.current_viewer()
    msgs = [{"role": m.role, "content": m.content} for m in body.messages]

    async def gen() -> Any:
        with audience.acting_as(viewer):
            async with session_factory()() as s:
                try:
                    async for frame in query.run(s, user=user, messages=msgs):
                        yield frame
                except Exception as exc:  # 스트림 중 실패도 프레임으로
                    yield query.sse("error", {"message": str(exc)[:300]})
                    yield query.sse("done", {"miss": False, "cited": 0})

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"})


@router.post("/fileback")
async def post_fileback(
    body: fileback.FilebackBody, user: dict[str, Any] = Depends(require_reader), s: AsyncSession = Depends(get_db),
) -> JSONResponse:
    """묻기의 답을 qa 원천으로 남기고 들인다 — 201(새것) · 200(같은 사람 · 물음 · 답이 이미 있다)."""
    out = await fileback.fileback(s, body, user=user)
    return JSONResponse(status_code=200 if out["dedup"] else 201, content=envelope(data=out))


@router.get("/candidates")
async def get_candidates(user: dict[str, Any] = Depends(require_reader), s: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    """내 후보 — 주인만(admin 도 남의 후보는 못 본다). 기한이 지난 것은 이때 철회한다."""
    return envelope(data=await candidates.mine(s, user=user))


class _ApproveBody(BaseModel):
    audience: list[str] | None = Field(default=None, description="비면 보낸 범위")


@router.post("/candidates/{source_id}/approve")
async def approve_candidate(
    source_id: UUID, body: _ApproveBody | None = None, user: dict[str, Any] = Depends(require_reader),
    s: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    return envelope(data=await candidates.approve(s, str(source_id), user=user, aud=body.audience if body else None))


@router.post("/candidates/{source_id}/discard")
async def discard_candidate(
    source_id: UUID, user: dict[str, Any] = Depends(require_reader), s: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    return envelope(data=await candidates.discard(s, str(source_id), user=user))


@router.get("/questions")
async def get_questions(
    status: str | None = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    _: dict[str, Any] = Depends(require_reader),
    s: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    rows, total = await questions.listing(s, status=status, limit=limit, offset=offset)
    return envelope(data=rows, meta={"total": total, "limit": limit, "offset": offset})


class _QuestionBody(BaseModel):
    text: str = Field(min_length=2, max_length=2000)
    audience: list[str] | None = Field(default=None, description="비면 남긴 사람만(user:<id>)")
    priority: int = Field(3, ge=1, le=5)
    origin: Literal["user", "query_miss"] = "user"


@router.post("/questions", status_code=201)
async def post_question(
    body: _QuestionBody, user: dict[str, Any] = Depends(require_reader), s: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    out = await questions.add(s, body.text, origin=body.origin, user=user, aud=body.audience, priority=body.priority)
    await s.commit()
    return envelope(data=out)


@router.get("/health")
async def wiki_health(s: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    workers = (await s.execute(text("""
        SELECT worker, state, seen_at, job_id FROM wiki_workers
         WHERE seen_at > NOW() - INTERVAL '10 minutes' ORDER BY seen_at DESC
    """))).all()
    return envelope(data={
        "jobs": await jobs.stats(s),
        "workers": [{"worker": w[0], "state": w[1], "seen_at": w[2].isoformat(), "job_id": str(w[3]) if w[3] else None}
                    for w in workers],
        "llm": await _llm_reachability(),
        "last_lint": None,
    })
