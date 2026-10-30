# AI 위키 MCP 도구(wiki_* 열넷) 시험 — 경로 · 본문 · 돌려주는 모양 · 쓰기 도구는 토큰이 있어야(docs/llm-wiki W6, CONTRACTS §7)
"""HTTP 는 ScriptedOpener 로 바꿔 친다(test_relationship_tools.py 와 같은 꼴) — 서버 쪽 동작은 apps/api 시험이 본다."""
from __future__ import annotations

import asyncio
import io
import importlib.util
import json
import re
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Callable
from urllib.parse import parse_qs, urlsplit

import pytest
from mcp.server.fastmcp.exceptions import ToolError

_SERVER_PY = Path(__file__).resolve().parents[1] / "server.py"


def _load_server_module():
    spec = importlib.util.spec_from_file_location("_mxwp_mcp_server_wiki", _SERVER_PY)
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
    def __init__(self, data: Any, meta: dict[str, Any] | None = None):
        self._raw = json.dumps({"data": data, "meta": meta or {}, "error": None}, ensure_ascii=False).encode("utf-8")
        self.status = 200
        self.headers: dict[str, str] = {}

    def read(self) -> bytes:
        return self._raw


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


def _use(server_mod, handlers: dict[tuple[str, str], Callable[[Any], Any]], token: str | None = "mxwp_TESTTOKEN0000000000000000"):
    opener = ScriptedOpener(handlers)
    client = server_mod._api().MxwpClient("http://fake", token, opener=opener)
    server_mod._make_client = lambda: client
    return opener


def _body(req: urllib.request.Request) -> dict[str, Any]:
    return json.loads(req.data.decode("utf-8"))


def test_wiki_index_renders_markdown_and_filters(server_mod) -> None:
    idx = {"version": 1, "at": "2026-10-24 15:00", "docs": 3, "sources": 9, "sections": [
        {"key": "part", "label": "부품", "count": 1, "more": 0, "items": [{"slug": "ent-part-x", "title": "힌지 브래킷", "summary": "브래킷"}]},
        {"key": "qa", "label": "문답", "count": 2, "more": 1, "items": [{"slug": "qa-1", "title": "균열은?", "summary": ""}]}]}
    _use(server_mod, {("GET", "/api/v1/wiki/index"): lambda r: _Resp(idx)})
    s = server_mod.build_server()
    full = _call(s, "wiki_index", {})
    only = _call(s, "wiki_index", {"kind": "qa"})
    assert "## 부품(part) — 1" in full and "- [[ent-part-x|힌지 브래킷]] — 브래킷" in full and "그 밖 1" in full
    assert "부품" not in only and "[[qa-1|균열은?]]" in only


def test_wiki_read_joins_blocks_and_citations(server_mod) -> None:
    doc = {"content": {"title": "힌지 브래킷", "sections": [{"id": "S1", "title": "요약", "blocks": [
        {"id": "B1", "type": "paragraph", "text": "최대 응력은 412 MPa 다."}]}]},
           "citations": {"B1": [{"short": "src_1", "title": "해석", "locator": {"path": "/results/0"}, "quote": None}]}}
    seen: list[str] = []

    def get_doc(req):
        seen.append(urlsplit(req.full_url).query)
        return _Resp(doc)

    _use(server_mod, {("GET", "/api/v1/wiki/pages/ent-part-x"): lambda r: _Resp({"kind": "entity", "managed": "ai",
                                                                                 "audience": ["org"], "entity": None}),
                      ("GET", "/api/v1/documents/ent-part-x"): get_doc})
    res = _call(server_mod.build_server(), "wiki_read", {"slug": "ent-part-x"})
    block = res["sections"][0]["blocks"][0]
    assert block == {"id": "B1", "type": "paragraph", "text": "최대 응력은 412 MPa 다.",
                     "cites": [{"short": "src_1", "title": "해석", "locator": {"path": "/results/0"}, "quote": None}]}
    assert seen == ["with=citations"] and res["kind"] == "entity"


def test_wiki_ask_and_search_and_log(server_mod) -> None:
    asked: dict[str, Any] = {}

    def ask(req):
        asked.update(_body(req))
        return _Resp({"answer": "체결부 [1].", "citations": [{"n": 1}], "miss": False, "question_id": None, "pages": []})

    _use(server_mod, {("POST", "/api/v1/wiki/ask"): ask,
                      ("GET", "/api/v1/wiki/search"): lambda r: _Resp({"pages": [{"slug": "a", "via": "entity"}], "entities": []}),
                      ("GET", "/api/v1/wiki/log"): lambda r: _Resp([{"at": "2026-10-24T06:00:00+00:00", "op": "ingest", "title": "x"}])})
    s = server_mod.build_server()
    assert _call(s, "wiki_ask", {"question": "균열은?"})["answer"] == "체결부 [1]." and asked == {"question": "균열은?"}
    assert _call(s, "wiki_search", {"query": "균열"})["pages"][0]["via"] == "entity"
    assert _call(s, "wiki_log", {"n": 5}) == ["[2026-10-24 06:00] ingest | x"]


def test_wiki_lint_report_reads_findings(server_mod) -> None:
    seen: list[dict[str, list[str]]] = []
    finding = {"id": "f1", "rule": "contradiction", "severity": "error", "title": "서로 다른 말 — 힌지 브래킷", "status": "open",
               "docs": [{"slug": "ent-part-x", "title": "힌지 브래킷"}], "question_id": "q1", "detail": {"metric": "m"}}

    def findings(req):
        seen.append(parse_qs(urlsplit(req.full_url).query))
        return _Resp([finding], {"total": 1, "by_rule": {"contradiction": 1}, "last_run": {"scope": "full"}})

    _use(server_mod, {("GET", "/api/v1/wiki/lint/findings"): findings})
    out = _call(server_mod.build_server(), "wiki_lint_report", {"rule": "contradiction", "limit": 5})
    assert out["by_rule"] == {"contradiction": 1} and out["last_run"] == {"scope": "full"} and out["total"] == 1
    assert out["findings"] == [{"rule": "contradiction", "severity": "error", "title": "서로 다른 말 — 힌지 브래킷",
                                "status": "open", "question_id": "q1", "docs": ["ent-part-x"]}]
    assert seen == [{"rule": ["contradiction"], "limit": ["5"]}]


def test_wiki_graph_keeps_wiki_edges_and_filters_predicates(server_mod) -> None:
    sub = {"root": "a", "nodes": ["a", "b", "c"], "edges": [
        {"subject_slug": "a", "predicate": "의 일부다", "predicate_key": "part-of", "object_slug": "b", "source": "wiki"},
        {"subject_slug": "a", "predicate": "인용한다", "predicate_key": None, "object_slug": "c", "source": "manual"},
        {"subject_slug": "c", "predicate": "에서 일어난다", "predicate_key": "has-failure-mode", "object_slug": "a", "source": "wiki"}]}
    depth: list[str] = []

    def subgraph(req):
        depth.append(parse_qs(urlsplit(req.full_url).query)["depth"][0])
        return _Resp(sub)

    _use(server_mod, {("GET", "/api/v1/triples/subgraph"): subgraph})
    res = _call(server_mod.build_server(), "wiki_graph", {"slug": "a", "depth": 5, "predicates": ["part-of"]})
    assert res["edges"] == [{"subject": "a", "predicate": "의 일부다", "predicate_key": "part-of", "object": "b"}]
    assert depth == ["2"]  # 깊이는 2 까지


def test_wiki_write_tools_post_bodies(server_mod) -> None:
    bodies: dict[str, Any] = {}

    def keep(name):
        def h(req):
            bodies[name] = (_body(req), urlsplit(req.full_url).query)
            return _Resp({"id": "x", "status": "pending_review"})
        return h

    _use(server_mod, {("POST", "/api/v1/wiki/fileback"): keep("fileback"), ("POST", "/api/v1/wiki/propose"): keep("propose"),
                      ("POST", "/api/v1/wiki/questions"): keep("question"), ("POST", "/api/v1/wiki/sources"): keep("source")})
    s = server_mod.build_server()
    _call(s, "wiki_fileback", {"question": "q", "answer": "a", "citations": [{"slug": "p", "block_id": "B1", "n": 1}]})
    _call(s, "wiki_propose", {"summary": "s", "ops": [{"op": "block.delete", "doc": "p", "block_id": "B1", "why": "w"}]})
    _call(s, "wiki_add_question", {"text": "물음"})
    _call(s, "wiki_submit_source", {"envelope": {"schema": "mxwp-source/1"}, "ingest": False})
    assert bodies["fileback"][0]["citations"] == [{"slug": "p", "block_id": "B1", "n": 1}] and "audience" not in bodies["fileback"][0]
    assert bodies["propose"][0] == {"summary": "s", "ops": [{"op": "block.delete", "doc": "p", "block_id": "B1", "why": "w"}],
                                    "relations": []}
    assert bodies["question"][0] == {"text": "물음", "priority": 3} and bodies["source"][1] == "ingest=false"


def test_wiki_write_tools_need_a_token(server_mod) -> None:
    _use(server_mod, {}, token=None)
    with pytest.raises(ToolError, match="MXWP_API_TOKEN"):
        _call(server_mod.build_server(), "wiki_propose", {"summary": "s", "ops": []})


def test_only_pure_reads_are_marked_read_only(server_mod) -> None:
    tools = {t.name: t for t in asyncio.run(server_mod.build_server().list_tools()) if t.name.startswith("wiki_")}
    marked = {n for n, t in tools.items() if t.annotations and t.annotations.readOnlyHint}
    assert marked == {"wiki_index", "wiki_search", "wiki_read", "wiki_source", "wiki_entity", "wiki_graph", "wiki_log",
                      "wiki_lint_report", "wiki_questions"}  # 게이트웨이가 읽기 전용 PAT 에 여는 것
    assert {"wiki_ask", "wiki_submit_source", "wiki_fileback", "wiki_propose", "wiki_add_question"} <= set(tools) - marked


_LOCAL_PATH_TOOLS = {"import_file", "upload_image", "extract_pptx_images"}


def _names(s) -> set[str]:
    return {t.name for t in asyncio.run(s.list_tools())}


def test_http_mode_drops_tools_that_read_server_paths(server_mod) -> None:
    stdio, http = _names(server_mod.build_server()), _names(server_mod.build_server(http=True))
    assert _LOCAL_PATH_TOOLS <= stdio  # 사용자 PC 에서 도는 stdio 에서는 그대로
    assert not (_LOCAL_PATH_TOOLS & http)  # 게이트웨이로 여럿이 부르는 서버는 서버 쪽 경로를 읽지 않는다(MW-02)
    assert {"upload_image_from_url", "upload_image_base64"} <= http


def test_http_mode_descriptions_do_not_point_at_dropped_tools(server_mod) -> None:
    for t in asyncio.run(server_mod.build_server(http=True).list_tools()):  # 없는 도구를 찾게 하지 않는다(10-30 MW-12)
        assert not [n for n in _LOCAL_PATH_TOOLS if re.search(rf"\b{n}\b", t.description or "")], t.name


def test_wiki_tools_hide_when_the_wiki_is_off(server_mod) -> None:
    on, off = _names(server_mod.build_server()), _names(server_mod.build_server(wiki=False))
    assert len({n for n in on if n.startswith("wiki_")}) == 14
    assert not {n for n in off if n.startswith("wiki_")} and "search_documents" in off


def _wiki_off(req):
    body = json.dumps({"data": None, "meta": None, "error": {"code": "wiki_disabled", "message": "MX 백서 AI 위키는 아직 열리지 않았다"}})
    raise urllib.error.HTTPError(req.full_url, 404, "Not Found", hdrs=None, fp=io.BytesIO(body.encode("utf-8")))


def test_wiki_switch_reads_health(server_mod) -> None:
    _use(server_mod, {("GET", "/api/v1/wiki/health"): lambda r: _Resp({"jobs": {}})})
    assert server_mod._wiki_switch() is True
    _use(server_mod, {("GET", "/api/v1/wiki/health"): _wiki_off})
    assert server_mod._wiki_switch() is False  # 꺼짐 — 도구를 싣지 않는다
    _use(server_mod, {})  # 닿지 않음(예상 밖 요청) — 싣는다
    assert server_mod._wiki_switch() is True


def test_wiki_off_answer_points_elsewhere(server_mod) -> None:
    _use(server_mod, {("GET", "/api/v1/wiki/index"): _wiki_off})
    with pytest.raises(ToolError) as e:
        _call(server_mod.build_server(), "wiki_index", {})
    assert "search_documents" in str(e.value) and "WIKI_ENABLED" not in str(e.value)
