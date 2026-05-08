"""AI assist hooks 라우터 — 요약/번역/다듬기/이어쓰기/제목 자동생성.

현재는 **모두 placeholder** 응답이다. 실제 LLM 호출은 추후 작업으로 빼두었으며,
본 모듈 안에 통합 지점만 명확히 표시해 둔다.

────────────────────────────────────────────────────────────────────────────
실제 LLM 연결 가이드 (TODO)
────────────────────────────────────────────────────────────────────────────
1) `.env` (또는 apptainer --env-file) 에 다음 중 하나를 설정한다:
     OPENAI_API_KEY=sk-...
     ANTHROPIC_API_KEY=sk-ant-...
2) 본 파일 하단의 `_call_llm(...)` placeholder 를 실제 SDK 호출로 교체.
   - OpenAI:    `from openai import AsyncOpenAI`  → chat.completions.create
   - Anthropic: `from anthropic import AsyncAnthropic` → messages.create
3) `Settings` 에 `openai_api_key` / `anthropic_api_key` 를 추가하고, 본 모듈
   상단에서 `get_settings()` 로 읽는다.
4) `AI_ENABLED=true` 로 켜야 라우터가 응답을 시작한다 (기본 false 일 때는 503).

라우터 자체는 placeholder 든 LLM 응답이든 **응답 shape 가 동일** 하도록
설계되어 있어, 위 1~3 단계만 교체하면 FE 변경 없이 살아난다.
"""
from __future__ import annotations

import re
import time
from typing import Any

from fastapi import APIRouter, Depends, Header
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import require_editor
from app.core.config import get_settings
from app.core.db import get_db
from app.core.errors import APIError, ValidationFailed, envelope
from app.repos import document_repo

router = APIRouter(prefix="/api/v1/ai", tags=["ai"])


# ── 에러 ──────────────────────────────────────────────────────────────
class _AIDisabled(APIError):
    code = "AI_DISABLED"
    http_status = 503
    message = "AI 기능은 현재 비활성화되어 있습니다 — 관리자에게 문의하세요."


class _AIRateLimited(APIError):
    code = "RATE_LIMITED"
    http_status = 429
    message = "AI 요청 한도 초과 — 잠시 후 다시 시도하세요."


# ── 10/min/user in-process limiter (files.py 패턴 미러) ─────────────
_RATE_WINDOW_SECONDS = 60.0
_RATE_LIMIT_PER_WINDOW = 10
# user_id → list[float] (recent request timestamps within window)
_call_history: dict[str, list[float]] = {}


def _check_rate_limit(user_id: str) -> bool:
    """True == 허용. 단일 프로세스 가정."""
    now = time.monotonic()
    cutoff = now - _RATE_WINDOW_SECONDS
    hist = [t for t in _call_history.get(user_id, []) if t >= cutoff]
    if len(hist) >= _RATE_LIMIT_PER_WINDOW:
        _call_history[user_id] = hist
        return False
    hist.append(now)
    _call_history[user_id] = hist
    return True


def _reset_rate_limit_for_tests() -> None:
    _call_history.clear()


# ── 공통 dependency ──────────────────────────────────────────────────
def _ensure_enabled() -> None:
    if not get_settings().ai_enabled:
        raise _AIDisabled()


async def _resolve_actor(
    s: AsyncSession, x_mxwp_user: str | None, user: dict | None
) -> str:
    if x_mxwp_user:
        uid = await document_repo.fetch_user_by_email(s, x_mxwp_user)
        if uid:
            return uid
    if user and user.get("id"):
        return str(user["id"])
    return await document_repo.fetch_admin_owner_id(s)


def _enforce_rate(actor: str) -> None:
    if not _check_rate_limit(actor):
        raise _AIRateLimited(
            details={"window_seconds": 60, "limit": _RATE_LIMIT_PER_WINDOW},
        )


# ── 요청 모델 ────────────────────────────────────────────────────────
class SummarizeBody(BaseModel):
    text: str = Field(min_length=1, max_length=200_000)
    target_length: str | None = Field(default="medium")


class TranslateBody(BaseModel):
    text: str = Field(min_length=1, max_length=200_000)
    target_language: str = Field(min_length=2, max_length=8)


class PolishBody(BaseModel):
    text: str = Field(min_length=1, max_length=200_000)
    tone: str | None = Field(default=None)


class ContinueBody(BaseModel):
    text: str = Field(min_length=1, max_length=200_000)
    max_tokens: int | None = Field(default=None, ge=1, le=4096)


class TitleBody(BaseModel):
    content: str = Field(min_length=1, max_length=200_000)


# ── placeholder 구현 ─────────────────────────────────────────────────
_SENT_END_RE = re.compile(r"[.!?。！？]\s+")


def _placeholder_summary(text: str, target_length: str | None) -> str:
    """앞 30% 를 가져오되, 가능한 한 문장 경계에서 끊는다."""
    pct = {"short": 0.15, "medium": 0.30, "long": 0.50}.get(
        target_length or "medium", 0.30
    )
    n = max(1, int(len(text) * pct))
    head = text[:n]
    # 마지막 문장 종결 부호까지로 다듬기
    matches = list(_SENT_END_RE.finditer(head))
    if matches:
        last = matches[-1]
        head = head[: last.end()].rstrip()
    return head.strip() or text[:n].strip()


_LANG_LABEL = {"en": "EN", "ja": "JA", "zh": "ZH", "ko": "KO"}


def _placeholder_translate(text: str, target: str) -> tuple[str, str]:
    """입력을 마커와 함께 반환. source_language 는 단순 휴리스틱."""
    label = _LANG_LABEL.get(target, target.upper())
    # 한글 문자 비율 > 0.2 → ko, 일본어 가나 > 0.05 → ja, 그 외 → en
    if any("가" <= c <= "힣" for c in text):
        src = "ko"
    elif any("぀" <= c <= "ヿ" for c in text):
        src = "ja"
    elif any("一" <= c <= "鿿" for c in text):
        src = "zh"
    else:
        src = "en"
    src_label = _LANG_LABEL.get(src, src.upper())
    return f"[{src_label}→{label} placeholder] {text}", src


def _placeholder_polish(text: str, _tone: str | None) -> str:
    s = text.strip()
    # 끝 문장부호를 "." 로 정규화 — 다중 문장부호도 한 개로.
    s = re.sub(r"[.!?。！？]+\s*$", ".", s)
    # 이미 문장 종결이 없는 경우 "." 추가
    if not s.endswith("."):
        s = s + "."
    return s


def _placeholder_continue(_text: str) -> str:
    return "...(이어 쓰기 자리표시자: 실제 LLM 연결 시 자동완성)"


def _placeholder_title(content: str) -> str:
    head = content.strip()
    if len(head) <= 50:
        return head
    return head[:50]


# ── (TODO) 실제 LLM 호출 자리 ─────────────────────────────────────────
async def _call_llm(_prompt: str, _system: str | None = None) -> str:
    """TODO: 실제 LLM SDK 호출로 교체.

    예 (OpenAI):
        from openai import AsyncOpenAI
        cli = AsyncOpenAI(api_key=settings.openai_api_key)
        rsp = await cli.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": _system or ""},
                {"role": "user", "content": _prompt},
            ],
        )
        return rsp.choices[0].message.content or ""
    """
    raise NotImplementedError("LLM call not yet wired — see module docstring")


# ── 라우트 ───────────────────────────────────────────────────────────
@router.post("/summarize")
async def ai_summarize(
    body: SummarizeBody,
    x_mxwp_user: str | None = Header(default=None, alias="X-MXWP-User"),
    s: AsyncSession = Depends(get_db),
    user: dict = Depends(require_editor),
) -> dict[str, Any]:
    _ensure_enabled()
    actor = await _resolve_actor(s, x_mxwp_user, user)
    _enforce_rate(actor)
    if body.target_length not in (None, "short", "medium", "long"):
        raise ValidationFailed("target_length must be one of short|medium|long")
    summary = _placeholder_summary(body.text, body.target_length)
    return envelope(data={"summary": summary})


@router.post("/translate")
async def ai_translate(
    body: TranslateBody,
    x_mxwp_user: str | None = Header(default=None, alias="X-MXWP-User"),
    s: AsyncSession = Depends(get_db),
    user: dict = Depends(require_editor),
) -> dict[str, Any]:
    _ensure_enabled()
    actor = await _resolve_actor(s, x_mxwp_user, user)
    _enforce_rate(actor)
    if body.target_language not in ("en", "ja", "zh", "ko"):
        raise ValidationFailed("target_language must be one of en|ja|zh|ko")
    translated, src = _placeholder_translate(body.text, body.target_language)
    return envelope(data={"translated": translated, "source_language": src})


@router.post("/polish")
async def ai_polish(
    body: PolishBody,
    x_mxwp_user: str | None = Header(default=None, alias="X-MXWP-User"),
    s: AsyncSession = Depends(get_db),
    user: dict = Depends(require_editor),
) -> dict[str, Any]:
    _ensure_enabled()
    actor = await _resolve_actor(s, x_mxwp_user, user)
    _enforce_rate(actor)
    if body.tone is not None and body.tone not in ("formal", "casual", "concise"):
        raise ValidationFailed("tone must be one of formal|casual|concise")
    polished = _placeholder_polish(body.text, body.tone)
    return envelope(data={"polished": polished})


@router.post("/continue")
async def ai_continue(
    body: ContinueBody,
    x_mxwp_user: str | None = Header(default=None, alias="X-MXWP-User"),
    s: AsyncSession = Depends(get_db),
    user: dict = Depends(require_editor),
) -> dict[str, Any]:
    _ensure_enabled()
    actor = await _resolve_actor(s, x_mxwp_user, user)
    _enforce_rate(actor)
    cont = _placeholder_continue(body.text)
    return envelope(data={"continuation": cont})


@router.post("/title")
async def ai_title(
    body: TitleBody,
    x_mxwp_user: str | None = Header(default=None, alias="X-MXWP-User"),
    s: AsyncSession = Depends(get_db),
    user: dict = Depends(require_editor),
) -> dict[str, Any]:
    _ensure_enabled()
    actor = await _resolve_actor(s, x_mxwp_user, user)
    _enforce_rate(actor)
    title = _placeholder_title(body.content)
    return envelope(data={"title": title})
