# 위키 LLM 클라이언트 — OpenAI 호환 /chat/completions 에서 구조화 출력(json_schema · 도구 호출)을 받아 pydantic 으로 다시 검사한다
"""request §7 · CONTRACTS §11 · WK-D7.

- 두 자리 — 배경 `WIKI_LLM_*`(들이기 · 점검) · 묻기 `WIKI_QUERY_LLM_*`(비면 배경과 같게).
- 구조화 출력 — `WIKI_LLM_STRUCTURED=json_schema`(기본 — `response_format`) 또는 `tools`(도구 호출 꼴 — json_schema 를 못 받는 서버).
  받은 것은 pydantic 모델로 다시 검사한다. 틀리면 무엇이 틀렸는지 알려 한 번 다시 묻고, 또 틀리면 `LLMFormatError` — 반쯤 맞은
  출력을 고쳐 쓰지 않는다.
- 오류 본문은 셋을 다 읽는다 — 새 vLLM · OpenAI `{"error": {...}}` · 옛 vLLM `{"object": "error", ...}` · `--api-key` 의 `{"error": "…"}`.
- 닿지 않음(연결 · 끊김 · 시간 초과 · 429 · 5xx)은 `LLMUnavailable` — 워커가 시도 수를 쓰지 않고 뒤로 미룬다. 그 밖의 4xx 는 `LLMError`.
- mock 으로 대신하지 않는다 — 설정이 비면 `background()` 가 None 이고 부르는 쪽이 멈춘다.
- 프록시는 챗 클라이언트(`services/llm_client.py`)처럼 환경(HTTP(S)_PROXY · NO_PROXY)을 따른다.
- 묻기(W6)는 `stream_text` — 글 조각을 받는 대로 내고(`stream: true` · `include_usage`), 조각 사이 읽기 시간 제한은 넉넉히(연결 10초는 그대로).
"""
from __future__ import annotations

import json
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any

import httpx
from pydantic import BaseModel, ValidationError

from app.core.config import get_settings

_CONNECT_S = 10.0
_MESSAGE_MAX = 300


class LLMError(RuntimeError):
    """요청이 틀렸다(4xx) 또는 응답 꼴이 OpenAI 호환이 아니다 — 다시 해도 같다."""


class LLMUnavailable(LLMError):
    """LLM 에 닿지 않는다 — 연결 · 끊김 · 시간 초과 · 429 · 5xx."""


class LLMFormatError(LLMError):
    """구조화 출력이 두 번 다 스키마에 맞지 않았다."""


@dataclass(frozen=True)
class Endpoint:
    base_url: str
    model: str
    api_key: str = ""
    structured: str = "json_schema"


@dataclass
class Usage:
    prompt_tokens: int = 0
    completion_tokens: int = 0
    calls: int = 0
    seconds: float = 0.0

    @property
    def tokens(self) -> int:
        return self.prompt_tokens + self.completion_tokens

    def as_dict(self) -> dict[str, Any]:
        return {"prompt_tokens": self.prompt_tokens, "completion_tokens": self.completion_tokens, "calls": self.calls,
                "seconds": round(self.seconds, 2)}


def _endpoint(base: str, model: str, key: str) -> Endpoint | None:
    if not (base.strip() and model.strip()):
        return None
    return Endpoint(base.strip().rstrip("/"), model.strip(), key, get_settings().wiki_llm_structured)


def background() -> Endpoint | None:
    st = get_settings()
    return _endpoint(st.wiki_llm_base_url, st.wiki_llm_model, st.wiki_llm_api_key)


def interactive() -> Endpoint | None:
    st = get_settings()
    return _endpoint(st.wiki_query_llm_base_url, st.wiki_query_llm_model, st.wiki_query_llm_api_key) or background()


def _error_message(resp: httpx.Response) -> str:
    try:
        body = resp.json()
    except ValueError:
        return resp.text[:_MESSAGE_MAX]
    if isinstance(body, dict):
        err = body.get("error")
        if isinstance(err, dict):
            return str(err.get("message") or err)[:_MESSAGE_MAX]
        if isinstance(err, str):
            return err[:_MESSAGE_MAX]
        if body.get("object") == "error":
            return str(body.get("message") or body)[:_MESSAGE_MAX]
    return str(body)[:_MESSAGE_MAX]


async def _call(
    ep: Endpoint, messages: list[dict[str, Any]], *, name: str, schema: dict[str, Any], usage: Usage, timeout_s: float,
) -> str:
    body: dict[str, Any] = {"model": ep.model, "messages": messages, "temperature": 0}
    if ep.structured == "tools":
        body["tools"] = [{"type": "function", "function": {"name": name, "description": f"{name} 출력", "parameters": schema}}]
        body["tool_choice"] = {"type": "function", "function": {"name": name}}
    else:
        body["response_format"] = {"type": "json_schema", "json_schema": {"name": name, "schema": schema}}
    headers = {"Authorization": f"Bearer {ep.api_key}"} if ep.api_key else {}
    started = time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(timeout_s, connect=_CONNECT_S)) as c:
            resp = await c.post(f"{ep.base_url}/chat/completions", json=body, headers=headers)
    except httpx.HTTPError as e:
        raise LLMUnavailable(f"LLM 에 닿지 않는다 — {type(e).__name__}: {e}"[:_MESSAGE_MAX]) from e
    finally:
        usage.calls += 1
        usage.seconds += time.monotonic() - started
    if resp.status_code == 429 or resp.status_code >= 500:
        raise LLMUnavailable(f"LLM {resp.status_code} — {_error_message(resp)}")
    if resp.status_code >= 400:
        raise LLMError(f"LLM {resp.status_code} — {_error_message(resp)}")
    try:
        data = resp.json()
        used = data.get("usage") or {}
        usage.prompt_tokens += int(used.get("prompt_tokens") or 0)
        usage.completion_tokens += int(used.get("completion_tokens") or 0)
        msg = data["choices"][0]["message"]
        if ep.structured == "tools":
            calls = msg.get("tool_calls") or []
            return str(calls[0]["function"]["arguments"]) if calls else str(msg.get("content") or "")
        return str(msg.get("content") or "")
    except (ValueError, KeyError, IndexError, TypeError) as e:
        raise LLMError(f"LLM 응답 꼴이 OpenAI 호환이 아니다 — {type(e).__name__}: {e}"[:_MESSAGE_MAX]) from e


async def stream_text(
    ep: Endpoint, messages: list[dict[str, Any]], *, usage: Usage, timeout_s: float = 120.0,
) -> AsyncIterator[str]:
    """글 답을 조각으로 — 닿지 않거나 끊기면 `LLMUnavailable`, 꼴이 틀리면 `LLMError`(이미 낸 조각은 부르는 쪽 몫)."""
    body = {"model": ep.model, "messages": messages, "temperature": 0.2, "stream": True,
            "stream_options": {"include_usage": True}}
    headers = {"Authorization": f"Bearer {ep.api_key}"} if ep.api_key else {}
    started = time.monotonic()
    usage.calls += 1
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(timeout_s, connect=_CONNECT_S)) as c, \
                c.stream("POST", f"{ep.base_url}/chat/completions", json=body, headers=headers) as resp:
            if resp.status_code >= 400:
                await resp.aread()
                cls = LLMUnavailable if resp.status_code == 429 or resp.status_code >= 500 else LLMError
                raise cls(f"LLM {resp.status_code} — {_error_message(resp)}")
            async for line in resp.aiter_lines():
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                try:
                    chunk = json.loads(data)
                except ValueError as e:
                    raise LLMError(f"스트림 조각이 JSON 이 아니다 — {data[:80]}") from e
                used = chunk.get("usage") or {}
                usage.prompt_tokens += int(used.get("prompt_tokens") or 0)
                usage.completion_tokens += int(used.get("completion_tokens") or 0)
                for choice in chunk.get("choices") or []:
                    piece = (choice.get("delta") or {}).get("content")
                    if piece:
                        yield piece
    except httpx.HTTPError as e:
        raise LLMUnavailable(f"LLM 에 닿지 않는다 — {type(e).__name__}: {e}"[:_MESSAGE_MAX]) from e
    finally:
        usage.seconds += time.monotonic() - started


async def structured[M: BaseModel](
    ep: Endpoint, messages: list[dict[str, Any]], model: type[M], *, name: str, usage: Usage, timeout_s: float = 180.0,
) -> M:
    """`model` 꼴의 답 하나. 틀리면 무엇이 틀렸는지 알려 한 번 다시 묻는다."""
    schema = model.model_json_schema()
    convo = list(messages)
    problems = ""
    for attempt in (1, 2):
        raw = await _call(ep, convo, name=name, schema=schema, usage=usage, timeout_s=timeout_s)
        try:
            return model.model_validate_json(raw)
        except ValidationError as e:
            problems = "; ".join(f"{'.'.join(str(x) for x in err['loc']) or '(맨 위)'}: {err['msg']}"
                                 for err in e.errors(include_url=False)[:5])
        if attempt == 1:
            convo = [*convo, {"role": "assistant", "content": raw[:4000]},
                     {"role": "user", "content": f"앞 출력이 스키마 {name} 에 맞지 않았다 — {problems}. "
                                                 "스키마에 맞는 JSON 하나만 다시 내라."}]
    raise LLMFormatError(f"{name} 출력이 두 번 다 스키마에 맞지 않았다 — {problems}"[:_MESSAGE_MAX])
