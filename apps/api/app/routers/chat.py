# 대화형 채팅 라우터 — POST /api/v1/chat (SSE 스트림, agentic 저작+검색).
"""채팅 엔드포인트.

`chat_agent.run()` 이 흘리는 SSE 프레임(tool_call/tool_result/token/done)을
그대로 `text/event-stream` 으로 전달한다. 문서를 생성하므로 editor 권한.
LLM 미설정이면 `chat_agent` 가 mock 으로 폴백하므로 이 라우터는 항상 응답한다.
"""
from __future__ import annotations

import time
from typing import Any, AsyncIterator

from fastapi import APIRouter, Depends, Header
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import require_editor
from app.core.config import get_settings
from app.core.db import get_db
from app.core.errors import APIError
from app.repos import document_repo
from app.services import chat_agent

router = APIRouter(prefix="/api/v1/chat", tags=["chat"])


class _ChatDisabled(APIError):
    code = "CHAT_DISABLED"
    http_status = 503
    message = "채팅 기능이 비활성화되어 있습니다 — 관리자에게 문의하세요."


class _ChatRateLimited(APIError):
    code = "RATE_LIMITED"
    http_status = 429
    message = "채팅 요청 한도 초과 — 잠시 후 다시 시도하세요."


# ── in-process rate limiter (ai.py 미러, 20/min/user) ────────────────
_RATE_WINDOW = 60.0
_RATE_LIMIT = 20
_hist: dict[str, list[float]] = {}


def _check_rate(uid: str) -> bool:
    now = time.monotonic()
    hist = [t for t in _hist.get(uid, []) if t >= now - _RATE_WINDOW]
    if len(hist) >= _RATE_LIMIT:
        _hist[uid] = hist
        return False
    hist.append(now)
    _hist[uid] = hist
    return True


def _reset_rate_limit_for_tests() -> None:
    _hist.clear()


class Message(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    content: str = Field(min_length=0, max_length=100_000)


class ChatBody(BaseModel):
    messages: list[Message] = Field(min_length=1, max_length=50)


async def _resolve_actor(
    s: AsyncSession, x_mxwp_user: str | None, user: dict | None
) -> tuple[str, str | None]:
    """(actor_id, actor_email) 해소 — ai.py 패턴."""
    email = x_mxwp_user or (user.get("email") if user else None)
    if x_mxwp_user:
        uid = await document_repo.fetch_user_by_email(s, x_mxwp_user)
        if uid:
            return uid, email
    if user and user.get("id"):
        return str(user["id"]), email
    return await document_repo.fetch_admin_owner_id(s), email


@router.post("")
async def chat(
    body: ChatBody,
    x_mxwp_user: str | None = Header(default=None, alias="X-MXWP-User"),
    s: AsyncSession = Depends(get_db),
    user: dict = Depends(require_editor),
) -> StreamingResponse:
    if not get_settings().chat_enabled:
        raise _ChatDisabled()
    actor_id, actor_email = await _resolve_actor(s, x_mxwp_user, user)
    if not _check_rate(actor_id):
        raise _ChatRateLimited(details={"window_seconds": 60, "limit": _RATE_LIMIT})

    ctx = {"actor_id": actor_id, "actor_email": actor_email,
           "role": (user or {}).get("role")}
    msgs = [{"role": m.role, "content": m.content} for m in body.messages]

    async def gen() -> AsyncIterator[str]:
        try:
            async for frame in chat_agent.run(s, ctx=ctx, messages=msgs):
                yield frame
        except Exception as exc:  # noqa: BLE001 — 스트림 중 실패도 이벤트로 전달.
            import json
            yield f"event: error\ndata: {json.dumps({'message': str(exc)[:300]}, ensure_ascii=False)}\n\n"
            yield "event: done\ndata: {}\n\n"

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
