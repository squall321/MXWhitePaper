# 시험용 OpenAI 호환 가짜 LLM 서버 — 시나리오 규칙으로 답을 고르고 vLLM 과 같은 꼴로 낸다
"""위키 쓰기(들이기 · 점검 · 지속 질의 · 묻기)를 진짜 LLM 없이 시험한다(docs/llm-wiki START §2-3 · WK-D7).

진짜 소켓 위의 HTTP 서버다(표준 라이브러리 `http.server`, 연결마다 스레드). 그래야 '느림' 은 진짜 읽기 시간 초과로,
'연결 끊김' 은 진짜 `RemoteProtocolError` 로 클라이언트에 닿는다. **꼴은 vLLM 의 OpenAI 호환 서버를 따른다** — 가짜가 진짜와
다르면 판정 결함을 숨긴다.

- `POST /v1/chat/completions` — `response_format: json_schema` 면 `message.content` 에 JSON 글, `tools` 면 `message.tool_calls`
  (`arguments` 는 JSON 글 · `content` 는 null · `finish_reason: tool_calls`). 도구 호출이 없으면 `tool_calls` 는 `[]` 다(vLLM — null 이 아니다).
- `GET /v1/models` — 시나리오의 모델 하나.
- 진짜처럼 거부한다 — 모르는 모델 404 · JSON 아닌 본문 · 빈 messages · 틀린 스키마 400 · 키를 정했는데 Bearer 가 틀리면 401.
  오류 본문은 `error_style` 로 고른다 — `openai`(`{"error": {...}}`, 새 vLLM) · `vllm-legacy`(`{"object": "error", ...}`).
- `stream: true`(글 모드만 — W6 묻기) — vLLM 처럼 `data: {chat.completion.chunk}` 를 잇고 `data: [DONE]` 로 닫는다(첫 조각은 role,
  끝 조각은 finish_reason, `stream_options.include_usage` 면 choices 가 빈 쓴 양 조각). 곁들임 `chunk_chars`(조각 크기, 기본 12) ·
  `chunk_delay_s`(조각 사이 쉼).

시나리오(dict 또는 JSON 파일 — 이름만 주면 `tests/fixtures/wiki/scenarios/` 에서 찾는다)::

    {"model": "fake-wiki", "api_key": null, "error_style": "openai",
     "rules": [{"match": {...}, "reply": {...}, "times": 1}, ...]}

규칙은 위에서부터 보고 처음 맞는 것을 쓴다. 맞는 것이 없으면 500 — 시나리오 결함을 조용히 넘기지 않는다.

- `match`(모두 맞아야) — `schema`: `json_schema.name` 또는 도구 모드에서 부를 함수 이름 · `contains`: 메시지 글을 이은 것에 든 문자열.
- `reply`(넷 중 하나) — `json`: 객체(json_schema 모드면 content, 도구 모드면 arguments) · `text`: 글 그대로(형식 틀림 시험) ·
  `error`: `{status, message, type?}` · `disconnect: true`: 응답 없이 끊는다.
  곁들임 — `delay_s`(느림) · `finish_reason` · `usage{prompt_tokens, completion_tokens}` · `tool`(auto 도구 모드에서 부를 함수) ·
  `capture{이름: 정규식}`(메시지 글에서 첫 묶음을 뽑아 `json` · `text` 안의 `{{이름}}` 을 바꾼다 — 원천 · 블록 id 처럼 실행 때 정해지는 값) ·
  `conform`(기본 참 — `json` 답이 요청 스키마에 맞는지 가짜가 먼저 본다. 진짜 서버의 유도 디코딩처럼. 틀린 꼴을 일부러 내려면 `text`).
- `times` — 이 규칙을 몇 번 쓰나(기본 끝없이). 다 쓰면 다음 규칙으로 — '처음엔 틀리고 다시 물으면 맞음' 을 짠다.

쓰는 법::

    with FakeLLM("slow.json") as llm:   # 127.0.0.1 의 빈 포트
        llm.base_url                    # http://127.0.0.1:<port>/v1
        llm.load(other)                 # 시나리오 바꾸기(받은 요청 기록도 비운다)
        llm.calls                       # [{path, body, rule}] — 프롬프트 · 구획 시험용

    python -m tests.fakes.fake_llm --scenario slow.json --port 8999      # apps/api 에서
"""
from __future__ import annotations

import argparse
import json
import re
import socket
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import jsonschema

SCENARIO_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "wiki" / "scenarios"
_PLACEHOLDER_RE = re.compile(r"\{\{[A-Za-z_][A-Za-z0-9_]*\}\}")


class ScenarioError(Exception):
    """시나리오가 이 요청에 답을 지을 수 없다 — 500 으로 소리 낸다."""


class _BadRequest(Exception):
    pass


def _message_text(messages: list[Any]) -> str:
    parts: list[str] = []
    for m in messages:
        if not isinstance(m, dict):
            continue
        c = m.get("content")
        if isinstance(c, str):
            parts.append(c)
        elif isinstance(c, list):  # [{type:'text', text}] 꼴
            parts.extend(p.get("text", "") for p in c if isinstance(p, dict) and p.get("type") == "text")
    return "\n".join(parts)


def _substitute(value: Any, caps: dict[str, str]) -> Any:
    if isinstance(value, str):
        for name, got in caps.items():
            value = value.replace("{{" + name + "}}", got)
        left = _PLACEHOLDER_RE.search(value)
        if left:
            raise ScenarioError(f"바꾸지 못한 자리 {left.group(0)} — capture 이름을 본다")
        return value
    if isinstance(value, list):
        return [_substitute(v, caps) for v in value]
    if isinstance(value, dict):
        return {k: _substitute(v, caps) for k, v in value.items()}
    return value


def _schema_errors(obj: Any, schema: dict[str, Any]) -> list[str]:
    validator = jsonschema.validators.validator_for(schema)(schema)
    return [f"{'/'.join(map(str, e.absolute_path)) or '(맨 위)'}: {e.message}" for e in validator.iter_errors(obj)]


class FakeLLM:
    def __init__(self, scenario: dict[str, Any] | str | Path, *, host: str = "127.0.0.1", port: int = 0) -> None:
        self._lock = threading.Lock()
        self.calls: list[dict[str, Any]] = []
        self.scenario: dict[str, Any] = {}
        self._used: list[int] = []
        self._created = int(time.time())
        self.load(scenario)
        self._httpd = ThreadingHTTPServer((host, port), _handler_for(self))
        self._httpd.daemon_threads = True  # 느린 답을 자는 스레드가 stop() 을 붙잡지 않게
        self._thread: threading.Thread | None = None

    # ── 바깥에서 쓰는 것 ──────────────────────────────────────────────────────────────────────

    @property
    def model(self) -> str:
        return str(self.scenario.get("model") or "fake-wiki")

    @property
    def base_url(self) -> str:
        host, port = self._httpd.server_address[:2]
        return f"http://{host}:{port}/v1"

    def load(self, scenario: dict[str, Any] | str | Path) -> None:
        if isinstance(scenario, (str, Path)):
            path = Path(scenario)
            if not path.is_absolute() and not path.exists():
                path = SCENARIO_DIR / path
            scenario = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(scenario, dict) or not isinstance(scenario.get("rules"), list):
            raise ScenarioError("시나리오에 rules 목록이 없다")
        with self._lock:
            self.scenario = scenario
            self._used = [0] * len(scenario["rules"])
            self.calls = []

    def start(self) -> FakeLLM:
        self._thread = threading.Thread(target=self._httpd.serve_forever, name="fake-llm", daemon=True)
        self._thread.start()
        return self

    def stop(self) -> None:
        self._httpd.shutdown()
        self._httpd.server_close()
        if self._thread is not None:
            self._thread.join(timeout=5)

    def __enter__(self) -> FakeLLM:
        return self.start()

    def __exit__(self, *_exc: object) -> None:
        self.stop()

    # ── 서버 안 ─────────────────────────────────────────────────────────────────────────────

    def _error_body(self, status: int, message: str, etype: str) -> dict[str, Any]:
        if self.scenario.get("error_style") == "vllm-legacy":
            return {"object": "error", "message": message, "type": etype, "param": None, "code": status}
        return {"error": {"message": message, "type": etype, "param": None, "code": status}}

    def _models(self) -> dict[str, Any]:
        return {"object": "list", "data": [{
            "id": self.model, "object": "model", "created": self._created, "owned_by": "vllm",
            "root": self.model, "parent": None, "max_model_len": int(self.scenario.get("max_model_len", 32768)),
            "permission": [],
        }]}

    def _mode(self, body: dict[str, Any]) -> tuple[str, str | None, dict[str, Any] | None]:
        """(모드, 맞출 이름, 답이 따라야 할 스키마). 모드는 json_schema · json_object · tools · text."""
        rf = body.get("response_format")
        if isinstance(rf, dict) and rf.get("type") == "json_schema":
            js = rf.get("json_schema")
            if not isinstance(js, dict) or not isinstance(js.get("schema"), dict):
                raise _BadRequest("response_format.json_schema.schema 가 없다")
            try:
                jsonschema.validators.validator_for(js["schema"]).check_schema(js["schema"])
            except jsonschema.SchemaError as e:
                raise _BadRequest(f"json_schema 가 JSON Schema 가 아니다: {e.message}") from e
            return "json_schema", js.get("name"), js["schema"]
        if isinstance(rf, dict) and rf.get("type") == "json_object":
            return "json_object", None, None
        tools = [t for t in (body.get("tools") or []) if isinstance(t, dict) and isinstance(t.get("function"), dict)]
        choice = body.get("tool_choice")
        if tools and choice != "none":
            names = [t["function"].get("name") for t in tools]
            if isinstance(choice, dict):
                name = (choice.get("function") or {}).get("name")
                if name not in names:
                    raise _BadRequest(f"tool_choice 의 함수 {name!r} 가 tools 에 없다")
            else:
                name = names[0]
            return "tools", name, None
        return "text", None, None

    def _pick(self, target: str | None, text: str) -> tuple[int | None, dict[str, Any] | None]:
        for i, rule in enumerate(self.scenario["rules"]):
            times = rule.get("times")
            if times is not None and self._used[i] >= int(times):
                continue
            match = rule.get("match") or {}
            if "schema" in match and match["schema"] != target:
                continue
            if "contains" in match and str(match["contains"]) not in text:
                continue
            self._used[i] += 1
            return i, rule
        return None, None

    def _render(self, reply: dict[str, Any], text: str, schema: dict[str, Any] | None) -> str:
        caps: dict[str, str] = {}
        for name, pattern in (reply.get("capture") or {}).items():
            m = re.search(pattern, text)
            if not m:
                raise ScenarioError(f"capture {name!r} 의 정규식이 프롬프트에서 안 잡힌다: {pattern}")
            caps[name] = m.group(1) if m.groups() else m.group(0)
        if "json" in reply:
            obj = _substitute(reply["json"], caps)
            if reply.get("conform", True) and schema is not None:
                errs = _schema_errors(obj, schema)
                if errs:
                    raise ScenarioError(f"json 답이 요청 스키마에 안 맞는다 — {errs[:3]}")
            return json.dumps(obj, ensure_ascii=False)
        if "text" in reply:
            return str(_substitute(reply["text"], caps))
        raise ScenarioError("reply 에 json · text · error · disconnect 중 하나가 없다")

    def complete(self, raw: bytes) -> tuple[int, dict[str, Any] | None]:
        """한 요청 → (HTTP 상태, 본문). 본문이 None 이면 응답 없이 연결을 끊는다."""
        try:
            body = json.loads(raw or b"null")
        except ValueError:
            return 400, self._error_body(400, "본문이 JSON 이 아니다", "BadRequestError")
        if not isinstance(body, dict):
            return 400, self._error_body(400, "본문이 JSON 객체가 아니다", "BadRequestError")
        if body.get("model") != self.model:
            return 404, self._error_body(404, f"The model `{body.get('model')}` does not exist.", "NotFoundError")
        messages = body.get("messages")
        if not isinstance(messages, list) or not messages:
            return 400, self._error_body(400, "messages 가 비었다", "BadRequestError")
        try:
            mode, target, schema = self._mode(body)
        except _BadRequest as e:
            return 400, self._error_body(400, str(e), "BadRequestError")
        text = _message_text(messages)
        with self._lock:
            idx, rule = self._pick(target, text)
            self.calls.append({"path": "/v1/chat/completions", "body": body, "rule": idx})
        if rule is None:
            return 500, self._error_body(500, f"fake LLM: 맞는 규칙이 없다(mode={mode}, schema={target}) — 시나리오를 고친다",
                                         "InternalServerError")
        reply = rule.get("reply") or {}
        if reply.get("delay_s"):
            time.sleep(float(reply["delay_s"]))
        if reply.get("disconnect"):
            return 0, None
        if "error" in reply:
            err = reply["error"]
            status = int(err.get("status", 500))
            return status, self._error_body(status, str(err.get("message", "fake error")),
                                            str(err.get("type", "InternalServerError")))
        if mode == "tools" and reply.get("tool"):
            names = [t["function"].get("name") for t in body.get("tools") or [] if isinstance(t, dict)]
            if reply["tool"] not in names:
                return 500, self._error_body(500, f"fake LLM 시나리오 결함: tools 에 {reply['tool']!r} 가 없다",
                                             "InternalServerError")
            target = reply["tool"]
        if mode == "tools":
            fn = next(t["function"] for t in body["tools"] if t["function"].get("name") == target)
            schema = fn.get("parameters") if isinstance(fn.get("parameters"), dict) else None
        try:
            content = self._render(reply, text, schema)
        except ScenarioError as e:
            return 500, self._error_body(500, f"fake LLM 시나리오 결함: {e}", "InternalServerError")

        usage = reply.get("usage") or {}
        prompt_tokens = int(usage.get("prompt_tokens", max(1, len(text) // 4)))
        completion_tokens = int(usage.get("completion_tokens", max(1, len(content) // 4)))
        if body.get("stream"):
            if mode != "text":
                return 400, self._error_body(400, "fake LLM: stream 은 글 모드만", "BadRequestError")
            size = int(reply.get("chunk_chars", 12))
            base = {"id": f"chatcmpl-{uuid.uuid4().hex}", "object": "chat.completion.chunk", "created": int(time.time()),
                    "model": self.model}
            chunks = [{**base, "choices": [{"index": 0, "delta": {"role": "assistant", "content": ""}, "logprobs": None,
                                            "finish_reason": None}]}]
            chunks += [{**base, "choices": [{"index": 0, "delta": {"content": content[i:i + size]}, "logprobs": None,
                                             "finish_reason": None}]} for i in range(0, len(content), size)]
            chunks.append({**base, "choices": [{"index": 0, "delta": {}, "logprobs": None,
                                                "finish_reason": reply.get("finish_reason", "stop"), "stop_reason": None}]})
            if (body.get("stream_options") or {}).get("include_usage"):
                chunks.append({**base, "choices": [], "usage": {"prompt_tokens": prompt_tokens, "completion_tokens": completion_tokens,
                                                                "total_tokens": prompt_tokens + completion_tokens}})
            return 200, {"__stream__": chunks, "__delay__": float(reply.get("chunk_delay_s", 0))}
        if mode == "tools":
            message: dict[str, Any] = {
                "role": "assistant", "reasoning_content": None, "content": None,
                "tool_calls": [{"id": f"chatcmpl-tool-{uuid.uuid4().hex}", "type": "function",
                                "function": {"name": target, "arguments": content}}],
            }
            finish = "tool_calls"
        else:
            message = {"role": "assistant", "reasoning_content": None, "content": content, "tool_calls": []}
            finish = "stop"
        return 200, {
            "id": f"chatcmpl-{uuid.uuid4().hex}", "object": "chat.completion", "created": int(time.time()),
            "model": self.model,
            "choices": [{"index": 0, "message": message, "logprobs": None,
                         "finish_reason": reply.get("finish_reason", finish), "stop_reason": None}],
            "usage": {"prompt_tokens": prompt_tokens, "total_tokens": prompt_tokens + completion_tokens,
                      "completion_tokens": completion_tokens, "prompt_tokens_details": None},
            "prompt_logprobs": None,
        }


def _handler_for(fake: FakeLLM) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"  # uvicorn(vLLM)처럼 keep-alive — Content-Length 를 늘 싣는다

        def log_message(self, format: str, *args: Any) -> None:  # 시험 출력을 더럽히지 않는다
            pass

        def _send(self, status: int, obj: Any) -> None:
            raw = json.dumps(obj, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def _authorized(self) -> bool:
            key = fake.scenario.get("api_key")
            if not key or self.headers.get("Authorization") == f"Bearer {key}":
                return True
            self._send(401, {"error": "Unauthorized"})  # vLLM --api-key 의 꼴
            return False

        def do_GET(self) -> None:
            if self.path.rstrip("/") != "/v1/models":
                self._send(404, {"detail": "Not Found"})
            elif self._authorized():
                self._send(200, fake._models())

        def do_POST(self) -> None:
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length) if length else b""
            if self.path.rstrip("/") != "/v1/chat/completions":
                self._send(404, {"detail": "Not Found"})
                return
            if not self._authorized():
                return
            status, obj = fake.complete(raw)
            if isinstance(obj, dict) and "__stream__" in obj:
                parts = [f"data: {json.dumps(c, ensure_ascii=False)}\n\n".encode() for c in obj["__stream__"]]
                parts.append(b"data: [DONE]\n\n")
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Content-Length", str(sum(len(p) for p in parts)))
                self.end_headers()
                for p in parts:
                    self.wfile.write(p)
                    self.wfile.flush()
                    if obj["__delay__"]:
                        time.sleep(obj["__delay__"])
                return
            if obj is None:
                self.close_connection = True
                try:
                    self.connection.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass
                return
            self._send(status, obj)

    return Handler


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description="시험용 가짜 LLM(OpenAI 호환 · vLLM 꼴)")
    ap.add_argument("--scenario", required=True, help="시나리오 JSON 경로 또는 scenarios/ 안의 이름")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8999)
    args = ap.parse_args(argv)
    fake = FakeLLM(args.scenario, host=args.host, port=args.port)
    print(f"fake LLM — {fake.base_url} · model {fake.model}", flush=True)
    try:
        fake._httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        fake._httpd.server_close()


if __name__ == "__main__":
    main()
