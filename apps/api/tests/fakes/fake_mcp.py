# 시험용 가짜 게이트웨이 MCP(streamable HTTP) — 지속 질의의 읽기 전용 도구 단계를 진짜 게이트웨이 없이 시험한다
"""docs/llm-wiki W7 — `app/wiki/tools.py` 가 붙는 꼴(JSON-RPC 2.0 · Mcp-Session-Id · application/json 또는 text/event-stream).

진짜 소켓 위의 HTTP 서버(표준 라이브러리, 연결마다 스레드) — 가짜 LLM 과 같은 자세. 도구는 `tools` 로 준다
(`{name, description, inputSchema, annotations, result}` — result 는 글 또는 args → 글). Bearer 가 틀리면 401.

    with FakeMCP(tools=[...], token="t", sse=True) as mcp:
        mcp.url        # http://127.0.0.1:<port>/mcp
        mcp.calls      # [(method, params)]
"""
from __future__ import annotations

import json
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any


class FakeMCP:
    def __init__(self, tools: list[dict[str, Any]], *, token: str = "fake-pat", sse: bool = False) -> None:
        self.tools = tools
        self.token = token
        self.sse = sse
        self.calls: list[tuple[str, Any]] = []
        self.session = uuid.uuid4().hex
        self._server = ThreadingHTTPServer(("127.0.0.1", 0), self._handler())
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self._server.server_address[1]}/mcp"

    def __enter__(self) -> FakeMCP:
        self._thread.start()
        return self

    def __exit__(self, *exc: object) -> None:
        self._server.shutdown()
        self._server.server_close()

    def _answer(self, msg: dict[str, Any]) -> dict[str, Any] | None:
        method, params = msg.get("method"), msg.get("params") or {}
        self.calls.append((method, params))
        if "id" not in msg:
            return None  # 알림
        if method == "initialize":
            result: Any = {"protocolVersion": params.get("protocolVersion"), "capabilities": {"tools": {}},
                           "serverInfo": {"name": "fake-gateway", "version": "0"}}
        elif method == "tools/list":
            result = {"tools": [{k: v for k, v in t.items() if k != "result"} for t in self.tools]}
        elif method == "tools/call":
            tool = next((t for t in self.tools if t["name"] == params.get("name")), None)
            if tool is None:
                return {"jsonrpc": "2.0", "id": msg["id"], "error": {"code": -32602, "message": "Unknown tool"}}
            out = tool.get("result", "")
            body = out(params.get("arguments") or {}) if callable(out) else str(out)
            result = {"content": [{"type": "text", "text": body}], "isError": False}
        else:
            return {"jsonrpc": "2.0", "id": msg["id"], "error": {"code": -32601, "message": "Method not found"}}
        return {"jsonrpc": "2.0", "id": msg["id"], "result": result}

    def _handler(self) -> type[BaseHTTPRequestHandler]:
        fake = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args: Any) -> None:
                pass

            def do_POST(self) -> None:
                if self.headers.get("Authorization") != f"Bearer {fake.token}":
                    self.send_response(401)
                    self.end_headers()
                    return
                raw = self.rfile.read(int(self.headers.get("Content-Length") or 0))
                reply = fake._answer(json.loads(raw or b"{}"))
                if reply is None:
                    self.send_response(202)
                    self.send_header("Mcp-Session-Id", fake.session)
                    self.end_headers()
                    return
                if fake.sse:
                    data = f"event: message\ndata: {json.dumps(reply, ensure_ascii=False)}\n\n".encode()
                    ctype = "text/event-stream"
                else:
                    data = json.dumps(reply, ensure_ascii=False).encode()
                    ctype = "application/json"
                self.send_response(200)
                self.send_header("Content-Type", ctype)
                self.send_header("Mcp-Session-Id", fake.session)
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

        return Handler
