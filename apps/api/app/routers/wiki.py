# 위키 REST(/api/v1/wiki) — 원천 받기 · 목록 · 한 건 · 철회 · 기록(log · log.md) · 상태(health). WIKI_ENABLED 가 꺼지면 모두 404
"""CONTRACTS §6 · §10 · §11. 지은 것은 docs/lat/wiki.md §REST 가 정본.

`/health` 는 인증이 없다(포털 상태판이 읽는다) — 그래서 수 · 시각만 내고 실패 글(예외 꼬리에 원천 글이 섞일 수 있다)은 내지 않는다.
"""
from __future__ import annotations

import time
from datetime import datetime
from typing import Any
from uuid import UUID

import httpx
from fastapi import APIRouter, Body, Depends, Query
from fastapi.responses import JSONResponse, PlainTextResponse
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import require_admin, require_editor, require_reader
from app.core.config import get_settings
from app.core.db import get_db
from app.core.errors import APIError, ValidationFailed, envelope, format_pydantic_errors
from app.wiki import catalog, jobs, review, schema_doc, sources
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
