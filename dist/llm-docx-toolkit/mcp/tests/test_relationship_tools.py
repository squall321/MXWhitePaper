"""Tests for the relationship (semantic edge) MCP tools — graph-triple-mcp.

get_relationships (read: outgoing/incoming split + LLM-legible sentences +
inverse fallback), create_relationship (write: inverse in body, 409 message),
delete_relationship, extract_relationships. Reuses the ScriptedOpener /
_use_client pattern from test_write_tools.py.
"""
from __future__ import annotations

import asyncio
import importlib.util
import io
import json
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlsplit, parse_qs

import pytest
from mcp.server.fastmcp.exceptions import ToolError

_HERE = Path(__file__).resolve()
_SERVER_PY = _HERE.parents[1] / "server.py"


def _load_server_module():
    spec = importlib.util.spec_from_file_location("_mxwp_mcp_server_rel", _SERVER_PY)
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture
def server_mod():
    return _load_server_module()


def _call(s, name: str, args: dict[str, Any]) -> Any:
    result = asyncio.run(s.call_tool(name, args))
    if isinstance(result, tuple):
        _content, structured = result
        if isinstance(structured, dict) and "result" in structured:
            return structured["result"]
        return structured
    return result


class _Resp:
    def __init__(self, payload: dict[str, Any], status: int = 200):
        self._raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.status = status
        self.headers: dict[str, str] = {}

    def read(self) -> bytes:
        return self._raw


def _http_error(url: str, code: int, payload: dict[str, Any]) -> urllib.error.HTTPError:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    return urllib.error.HTTPError(url, code, "err", {}, io.BytesIO(body))


class ScriptedOpener:
    def __init__(self, handlers: dict[tuple[str, str], Callable[[Any], Any]]):
        self.handlers = handlers
        self.requests: list[Any] = []

    def __call__(self, req: urllib.request.Request, timeout: float) -> Any:
        self.requests.append(req)
        key = (req.get_method(), urlsplit(req.full_url).path)
        if key not in self.handlers:
            raise AssertionError(f"unexpected request: {key}")
        return self.handlers[key](req)


def _use_client(server_mod, opener, token: str = "mxwp_TESTTOKEN0000000000000000"):
    api = server_mod._api()
    client = api.MxwpClient("http://fake", token, opener=opener)
    server_mod._make_client = lambda: client
    return client


def _body(req: urllib.request.Request) -> dict[str, Any]:
    return json.loads(req.data.decode("utf-8"))


# ── get_relationships ───────────────────────────────────────────────
def test_get_relationships_splits_and_renders(server_mod) -> None:
    def triples(req):
        q = parse_qs(urlsplit(req.full_url).query)
        if q.get("subject") == ["me"]:
            return _Resp({"data": [
                {"id": "t1", "subject_slug": "me", "predicate": "전제로 한다",
                 "object_slug": "b", "source": "manual", "inverse_predicate": None},
            ], "meta": {}, "error": None})
        if q.get("object") == ["me"]:
            return _Resp({"data": [
                {"id": "t2", "subject_slug": "a", "predicate": "인용한다",
                 "object_slug": "me", "source": "llm", "inverse_predicate": "에 인용된다"},
                {"id": "t3", "subject_slug": "c", "predicate": "참조한다",
                 "object_slug": "me", "source": "manual", "inverse_predicate": None},
            ], "meta": {}, "error": None})
        return _Resp({"data": [], "meta": {}, "error": None})

    opener = ScriptedOpener({("GET", "/api/v1/triples"): triples})
    _use_client(server_mod, opener)
    s = server_mod.build_server()
    res = _call(s, "get_relationships", {"slug": "me"})

    assert res["summary"] == "나가는 관계 1개, 들어오는 관계 2개"
    assert res["outgoing"][0]["object"] == "b"
    assert res["outgoing"][0]["sentence"] == "me --[전제로 한다]--> b"
    # 들어오는: inverse 있으면 역방향 문장 포함
    inc_with_inv = next(t for t in res["incoming"] if t["subject"] == "a")
    assert inc_with_inv["inverse"] == "에 인용된다"
    assert "역방향: me 에 인용된다 a" in inc_with_inv["sentence"]
    assert inc_with_inv["id"] == "t2"
    # inverse 없으면 역방향 문장 없음
    inc_no_inv = next(t for t in res["incoming"] if t["subject"] == "c")
    assert "역방향" not in inc_no_inv["sentence"]


# ── create_relationship ─────────────────────────────────────────────
def test_create_relationship_sends_inverse(server_mod) -> None:
    seen: dict[str, Any] = {}

    def create(req):
        seen.update(_body(req))
        return _Resp({"data": {"id": "new", **seen}, "meta": {}, "error": None})

    opener = ScriptedOpener({("POST", "/api/v1/triples"): create})
    _use_client(server_mod, opener)
    s = server_mod.build_server()
    res = _call(s, "create_relationship", {
        "subject_slug": "a", "predicate": "인용한다", "object_slug": "b",
        "inverse_predicate": "에 인용된다",
    })
    assert seen["subject_slug"] == "a"
    assert seen["inverse_predicate"] == "에 인용된다"
    assert seen["source"] == "manual"
    assert res["id"] == "new"


def test_create_relationship_409_message(server_mod) -> None:
    def create(req):
        raise _http_error(req.full_url, 409, {"error": {"code": "CONFLICT",
                          "message": "Triple already exists"}})

    opener = ScriptedOpener({("POST", "/api/v1/triples"): create})
    _use_client(server_mod, opener)
    s = server_mod.build_server()
    with pytest.raises(ToolError) as ei:
        _call(s, "create_relationship", {
            "subject_slug": "a", "predicate": "p", "object_slug": "b",
        })
    assert "이미 같은 관계가 존재합니다" in str(ei.value)


def test_create_relationship_requires_token(server_mod) -> None:
    opener = ScriptedOpener({})
    _use_client(server_mod, opener, token="")
    s = server_mod.build_server()
    with pytest.raises(ToolError):
        _call(s, "create_relationship", {
            "subject_slug": "a", "predicate": "p", "object_slug": "b",
        })
    assert opener.requests == []  # 토큰 없으면 HTTP 미발생


# ── delete / extract ────────────────────────────────────────────────
def test_delete_relationship(server_mod) -> None:
    def delete(req):
        return _Resp({"data": {"id": "t1", "deleted": True}, "meta": {}, "error": None})

    opener = ScriptedOpener({("DELETE", "/api/v1/triples/t1"): delete})
    _use_client(server_mod, opener)
    s = server_mod.build_server()
    res = _call(s, "delete_relationship", {"triple_id": "t1"})
    assert res == {"id": "t1", "deleted": True}


def test_extract_relationships(server_mod) -> None:
    def extract(req):
        return _Resp({"data": {"stored": 1, "replaced": 0, "extracted": [
            {"predicate": "는_b_와_관련있다", "object_slug": "b",
             "inverse_predicate": "와_관련있다"},
        ]}, "meta": {}, "error": None})

    opener = ScriptedOpener({("POST", "/api/v1/triples/extract"): extract})
    _use_client(server_mod, opener)
    s = server_mod.build_server()
    res = _call(s, "extract_relationships", {"slug": "me"})
    assert res["stored"] == 1
    assert res["extracted"][0]["object"] == "b"
    assert res["extracted"][0]["inverse"] == "와_관련있다"
