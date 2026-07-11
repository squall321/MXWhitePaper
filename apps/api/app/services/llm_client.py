# OpenAI 호환(vLLM) chat.completions 클라이언트 — 도구 호출 포함, 실패 시 예외.
"""LLM HTTP 클라이언트.

vLLM 은 OpenAI 호환 `/chat/completions` 엔드포인트를 제공하므로 그 스펙으로
호출한다. `llm_backend` 가 `openai` 일 때만 실 호출하며, 도달 실패 / 비-200 /
파싱 실패 시 예외를 던진다 — 상위(`chat_agent`)가 mock 으로 폴백한다
(HWAX 포털 플레이북 §8: 라이브 엔드포인트에 의존하지 않는다).
"""
from __future__ import annotations

from typing import Any

import httpx

from app.core.config import get_settings

# 도구 라운드는 응답이 짧아 타임아웃을 넉넉히 잡되, 무한 대기는 막는다.
_TIMEOUT_SECONDS = 60.0


def is_live() -> bool:
    """실 LLM 이 설정돼 있으면 True (backend=openai + base_url + model)."""
    s = get_settings()
    return (
        s.llm_backend.strip().lower() == "openai"
        and bool(s.llm_base_url.strip())
        and bool(s.llm_model.strip())
    )


async def complete(
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """OpenAI 호환 chat.completions 1회 호출 → assistant 메시지 dict 반환.

    반환 예: {"role": "assistant", "content": "...", "tool_calls": [...]}.
    실패(연결/타임아웃/비-200/파싱) 시 예외를 던진다.
    """
    s = get_settings()
    url = s.llm_base_url.rstrip("/") + "/chat/completions"
    payload: dict[str, Any] = {
        "model": s.llm_model,
        "messages": messages,
        "temperature": 0.3,
    }
    if tools:
        payload["tools"] = tools
        payload["tool_choice"] = "auto"

    headers = {"Content-Type": "application/json"}
    if s.llm_api_key.strip():
        headers["Authorization"] = f"Bearer {s.llm_api_key.strip()}"

    async with httpx.AsyncClient(timeout=_TIMEOUT_SECONDS) as client:
        resp = await client.post(url, json=payload, headers=headers)
        resp.raise_for_status()
        data = resp.json()

    choices = data.get("choices")
    if not isinstance(choices, list) or not choices:
        raise ValueError("LLM 응답에 choices 가 없습니다")
    msg = choices[0].get("message")
    if not isinstance(msg, dict):
        raise ValueError("LLM 응답에 message 가 없습니다")
    return msg
