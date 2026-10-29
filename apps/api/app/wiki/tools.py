# 지속 질의의 읽기 전용 도구 — 게이트웨이 MCP(streamable HTTP)에 포털 읽기 전용 PAT 로 붙어 허용 목록의 도구만 부른다
"""request §5-9 · WK-D11(지속 질의는 읽기 전용 — 해석 · 시험은 제안만).

- 설정 `WIKI_TOOLS_URL`(게이트웨이 MCP 끝점) · `WIKI_TOOLS_TOKEN`(포털이 발급한 읽기 전용 PAT — `.env` 로만). 둘 중 하나가 비면 도구
  단계는 없다(위키 안에서만 답한다).
- 세 겹으로 거른다 — 규칙서 `inquiry.tools_allowlist` 에 있고, 그 도구의 결과 범위(적지 않으면 전사)를 질문의 범위가 다 담고, 게이트웨이
  `tools/list` 가 `readOnlyHint` 를 단 도구만. 허용 목록에 쓰기 도구가 잘못 들어가도 부르지 않는다(게이트웨이도 읽기 전용 PAT 에 막는다).
- 이 PAT 의 시야는 '사람 없는 서비스' 의 시야다 — 사람별로 막힌 자료는 보지 못한다. 그런 질문은 LLM 이 needs_human 으로 넘긴다.
  신원을 꾸며 남의 자료를 읽지 않는다.
- 프로토콜 — JSON-RPC 2.0 `initialize` → `notifications/initialized` → `tools/list` · `tools/call`. 응답은 application/json 과
  text/event-stream(같은 id 의 `data:`) 둘 다 읽고, 세션 머리글 `Mcp-Session-Id` 를 잇는다.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

import httpx

from app.core.config import get_settings
from app.wiki import schema as wiki_schema

PROTOCOL = "2025-03-26"
_TIMEOUT_S = 60.0
RESULT_CHARS = 4000


class ToolsError(RuntimeError):
    """게이트웨이에 닿지 않거나 JSON-RPC 오류 — 그 질문의 도구 단계만 건너뛴다."""


@dataclass(frozen=True)
class Tool:
    name: str
    description: str
    schema: dict[str, Any]
    audience: list[str]


def configured() -> bool:
    st = get_settings()
    return bool(st.wiki_tools_url.strip() and st.wiki_tools_token.strip())


def _covers(question_aud: list[str], tool_aud: list[str]) -> bool:
    return set(tool_aud) - {"org"} <= set(question_aud) - {"org"}


def _parse(resp: httpx.Response, want_id: int) -> dict[str, Any]:
    ctype = resp.headers.get("content-type", "")
    if "text/event-stream" in ctype:
        for line in resp.text.splitlines():
            if line.startswith("data:"):
                try:
                    msg = json.loads(line[5:].strip())
                except ValueError:
                    continue
                if isinstance(msg, dict) and msg.get("id") == want_id:
                    return msg
        raise ToolsError("이벤트 흐름에 답이 없다")
    try:
        msg = resp.json()
    except ValueError as e:
        raise ToolsError(f"JSON 이 아닌 답 — {resp.text[:120]}") from e
    if isinstance(msg, list):  # 묶음 답
        msg = next((m for m in msg if isinstance(m, dict) and m.get("id") == want_id), {})
    return msg if isinstance(msg, dict) else {}


class Session:
    """게이트웨이 MCP 세션 하나 — `async with Session() as t:` 안에서 `list_tools` · `call`."""

    def __init__(self, url: str | None = None, token: str | None = None) -> None:
        st = get_settings()
        self.url = (url or st.wiki_tools_url).strip()
        self.token = (token or st.wiki_tools_token).strip()
        self.session_id: str | None = None
        self._id = 0
        self._client: httpx.AsyncClient | None = None

    async def __aenter__(self) -> Session:
        self._client = httpx.AsyncClient(timeout=httpx.Timeout(_TIMEOUT_S, connect=10.0))
        try:
            await self._rpc("initialize", {"protocolVersion": PROTOCOL, "capabilities": {},
                                           "clientInfo": {"name": "mxwp-wiki-inquiry", "version": "1"}})
            await self._rpc("notifications/initialized", None, notify=True)
        except BaseException:
            await self._client.aclose()
            raise
        return self

    async def __aexit__(self, *exc: object) -> None:
        if self._client is not None:
            await self._client.aclose()

    async def _rpc(self, method: str, params: dict[str, Any] | None, *, notify: bool = False) -> Any:
        assert self._client is not None
        headers = {"Authorization": f"Bearer {self.token}", "Accept": "application/json, text/event-stream",
                   "Content-Type": "application/json"}
        if self.session_id:
            headers["Mcp-Session-Id"] = self.session_id
        body: dict[str, Any] = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            body["params"] = params
        if not notify:
            self._id += 1
            body["id"] = self._id
        try:
            resp = await self._client.post(self.url, json=body, headers=headers)
        except httpx.HTTPError as e:
            raise ToolsError(f"게이트웨이에 닿지 않는다 — {type(e).__name__}") from e
        if sid := resp.headers.get("mcp-session-id"):
            self.session_id = sid
        if resp.status_code >= 400:
            raise ToolsError(f"게이트웨이 {resp.status_code} — {resp.text[:200]}")
        if notify:
            return None
        msg = _parse(resp, self._id)
        if msg.get("error"):
            err = msg["error"]
            raise ToolsError(f"{method} 오류 — {err.get('message') if isinstance(err, dict) else err}"[:300])
        return msg.get("result") or {}

    async def list_tools(self) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        cursor: str | None = None
        for _ in range(20):
            res = await self._rpc("tools/list", {"cursor": cursor} if cursor else {})
            out.extend(t for t in res.get("tools") or [] if isinstance(t, dict))
            cursor = res.get("nextCursor")
            if not cursor:
                break
        return out

    async def call(self, name: str, args: dict[str, Any]) -> str:
        """도구 결과의 글(text 조각을 이은 것, `RESULT_CHARS` 까지). 도구가 오류를 내면 그 글을 '도구 오류 — …' 로."""
        res = await self._rpc("tools/call", {"name": name, "arguments": args})
        parts = [c.get("text", "") for c in res.get("content") or [] if isinstance(c, dict) and c.get("type") == "text"]
        if not parts and res.get("structuredContent") is not None:
            parts = [json.dumps(res["structuredContent"], ensure_ascii=False)]
        body = "\n".join(parts).strip()
        return (f"도구 오류 — {body}" if res.get("isError") else body)[:RESULT_CHARS]


def offered(book: wiki_schema.RuleBook, question_aud: list[str], listed: list[dict[str, Any]]) -> list[Tool]:
    """이 질문에 내놓을 도구 — 허용 목록 · 결과 범위 · readOnlyHint."""
    allow = book.spec.inquiry.tools()
    out: list[Tool] = []
    for t in listed:
        name = str(t.get("name") or "")
        if name not in allow or not _covers(question_aud, allow[name]):
            continue
        if not (t.get("annotations") or {}).get("readOnlyHint"):
            continue
        out.append(Tool(name=name, description=str(t.get("description") or "")[:500],
                        schema=t.get("inputSchema") if isinstance(t.get("inputSchema"), dict) else {},
                        audience=allow[name]))
    return out
