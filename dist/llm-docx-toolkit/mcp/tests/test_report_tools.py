"""Tests for the report-augmentation + export MCP tools.

search_documents / search_knowledge / get_glossary_term / list_glossary /
get_backlinks (데이터 증강, envelope GET) + export_document (raw-bytes POST,
_send 우회 → 파일 저장). ScriptedOpener 패턴 재사용.
"""
from __future__ import annotations

import asyncio
import importlib.util
import io
import json
import urllib.error
import urllib.request
from email.message import Message
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlsplit, parse_qs

import pytest

_HERE = Path(__file__).resolve()
_SERVER_PY = _HERE.parents[1] / "server.py"


def _load():
    spec = importlib.util.spec_from_file_location("_mxwp_mcp_server_rep", _SERVER_PY)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture
def server_mod():
    return _load()


def _call(s, name, args):
    r = asyncio.run(s.call_tool(name, args))
    if isinstance(r, tuple):
        _c, st = r
        blocks = _c if isinstance(_c, list) else []
        if isinstance(st, dict) and "result" in st:
            return st["result"]
        return st
    return r


class _Resp:
    def __init__(self, payload=None, *, raw: bytes | None = None, headers=None):
        if raw is not None:
            self._raw = raw
        else:
            self._raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.status = 200
        self.headers = headers or {}

    def read(self):
        return self._raw


class ScriptedOpener:
    def __init__(self, handlers):
        self.handlers = handlers
        self.requests: list[Any] = []

    def __call__(self, req, timeout):
        self.requests.append(req)
        key = (req.get_method(), urlsplit(req.full_url).path)
        if key not in self.handlers:
            raise AssertionError(f"unexpected: {key}")
        return self.handlers[key](req)


def _use(server_mod, opener, token="mxwp_TESTTOKEN0000000000000000"):
    api = server_mod._api()
    server_mod._make_client = lambda: api.MxwpClient("http://fake", token, opener=opener)


# ── 데이터 증강 ──────────────────────────────────────────────────────
def test_search_documents(server_mod) -> None:
    def h(req):
        q = parse_qs(urlsplit(req.full_url).query)
        assert q["q"] == ["배터리"]
        return _Resp({"data": [{"slug": "lsdyna-battery", "title": "배터리",
                                "snippet": "…", "tags": ["배터리"]}], "meta": {}, "error": None})
    _use(server_mod, ScriptedOpener({("GET", "/api/v1/search"): h}))
    res = _call(server_mod.build_server(), "search_documents", {"q": "배터리"})
    assert res[0]["slug"] == "lsdyna-battery"


def test_search_knowledge(server_mod) -> None:
    def h(req):
        return _Resp({"data": [{"id": "graph.md#1", "kind": "lat", "heading": "Graph lat"}],
                      "meta": {}, "error": None})
    _use(server_mod, ScriptedOpener({("GET", "/api/v1/search/knowledge"): h}))
    res = _call(server_mod.build_server(), "search_knowledge", {"q": "관계"})
    assert res[0]["kind"] == "lat"


def test_get_glossary_term(server_mod) -> None:
    def h(req):
        assert urlsplit(req.full_url).path == "/api/v1/glossary/term/SEI"
        return _Resp({"data": {"term": "SEI", "definition": "고체 전해질 계면",
                               "related_doc_count": 3}, "meta": {}, "error": None})
    _use(server_mod, ScriptedOpener({("GET", "/api/v1/glossary/term/SEI"): h}))
    res = _call(server_mod.build_server(), "get_glossary_term", {"term": "SEI"})
    assert res["definition"] == "고체 전해질 계면"


def test_list_glossary(server_mod) -> None:
    def h(req):
        return _Resp({"data": {"items": [{"term": "GaN"}], "total": 1}, "meta": {}, "error": None})
    _use(server_mod, ScriptedOpener({("GET", "/api/v1/glossary"): h}))
    res = _call(server_mod.build_server(), "list_glossary", {"q": "Ga"})
    assert res["items"][0]["term"] == "GaN"


def test_get_backlinks(server_mod) -> None:
    def h(req):
        return _Resp({"data": [{"slug": "a", "title": "A", "sections_referenced": 2}],
                      "meta": {}, "error": None})
    _use(server_mod, ScriptedOpener({("GET", "/api/v1/documents/x/backlinks"): h}))
    res = _call(server_mod.build_server(), "get_backlinks", {"slug": "x"})
    assert res[0]["sections_referenced"] == 2


# ── export (raw bytes → 파일) ────────────────────────────────────────
def test_export_document_writes_binary(server_mod, tmp_path) -> None:
    # 서버가 docx zip(PK 매직) 바이트를 반환 → json 파싱 없이 파일로 저장.
    fake_docx = b"PK\x03\x04" + b"\x00" * 40
    hdrs = Message()
    hdrs["X-Export-Artifact-Id"] = "art-1"
    hdrs["X-Export-Download-Url"] = "/api/v1/exports/artifacts/art-1"

    def h(req):
        assert json.loads(req.data.decode())["slug"] == "report-x"
        return _Resp(raw=fake_docx, headers=hdrs)

    _use(server_mod, ScriptedOpener({("POST", "/api/v1/exports/docx"): h}))
    out = str(tmp_path / "report-x.docx")
    res = _call(server_mod.build_server(), "export_document",
                {"slug": "report-x", "format": "docx", "out_path": out})
    assert res["size"] == len(fake_docx)
    assert res["download_url"] == "/api/v1/exports/artifacts/art-1"
    assert Path(out).read_bytes()[:4] == b"PK\x03\x04"  # 유효 zip/docx 매직


def test_export_document_requires_token(server_mod) -> None:
    opener = ScriptedOpener({})
    _use(server_mod, opener, token="")
    from mcp.server.fastmcp.exceptions import ToolError
    with pytest.raises(ToolError):
        _call(server_mod.build_server(), "export_document", {"slug": "x"})
    assert opener.requests == []  # 토큰 없으면 HTTP 미발생
