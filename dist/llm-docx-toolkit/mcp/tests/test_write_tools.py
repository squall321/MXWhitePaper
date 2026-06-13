"""Tests for the document read/write MCP tools (T1).

Three layers:
  (a) validate_block — local jsonschema validation, no HTTP.
  (b) api_client unit tests — scripted urllib opener (imp/client.py pattern):
      token-missing guidance, If-Match propagation, 412 conflict message.
  (c) live integration (`-m live`, skipped when the API is unreachable):
      real token issue → create_document → 5-block insert → outline →
      update → move → delete → cleanup.

Server module is loaded via importlib alias to dodge the mcp-SDK name
clash (same as test_server.py).
"""
from __future__ import annotations

import asyncio
import importlib.util
import io
import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlsplit

import pytest
from mcp.server.fastmcp.exceptions import ToolError

_HERE = Path(__file__).resolve()
_SERVER_PY = _HERE.parents[1] / "server.py"

# 26-char Crockford ULIDs matching ^[0-9A-HJKMNP-TV-Z]{26}$.
ULID_A = "01" + "A" * 24
ULID_B = "01" + "B" * 24
SEC_ID = "01" + "C" * 24


def _load_server_module():
    spec = importlib.util.spec_from_file_location("_mxwp_mcp_server_wt", _SERVER_PY)
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture
def server_mod():
    return _load_server_module()


def _call(s, name: str, args: dict[str, Any]) -> Any:
    """call_tool + FastMCP structured-output normalisation."""
    result = asyncio.run(s.call_tool(name, args))
    if isinstance(result, tuple):
        _content, structured = result
        if isinstance(structured, dict) and "result" in structured:
            return structured["result"]
        return structured
    return result


# ── fake transport ──────────────────────────────────────────────────


class _Resp:
    def __init__(self, payload: dict[str, Any], headers: dict[str, str], status: int = 200):
        self._raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.status = status
        self.headers = headers

    def read(self) -> bytes:
        return self._raw


def _http_error(url: str, code: int, payload: dict[str, Any]) -> urllib.error.HTTPError:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    return urllib.error.HTTPError(url, code, "err", {}, io.BytesIO(body))


class ScriptedOpener:
    """(method, path) → handler(req). Records every request it sees."""

    def __init__(self, handlers: dict[tuple[str, str], Callable[[Any], Any]]):
        self.handlers = handlers
        self.requests: list[Any] = []

    def __call__(self, req: urllib.request.Request, timeout: float) -> Any:
        self.requests.append(req)
        key = (req.get_method(), urlsplit(req.full_url).path)
        if key not in self.handlers:
            raise AssertionError(f"unexpected request: {key}")
        return self.handlers[key](req)


def _doc_envelope(version: int = 3, blocks: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    return {
        "data": {
            "id": "d1",
            "slug": "test-doc",
            "title": "테스트 문서",
            "version": version,
            "content": {
                "schema_version": "1.0",
                "sections": [
                    {
                        "id": SEC_ID,
                        "level": 1,
                        "number": "1",
                        "title": "개요",
                        "blocks": blocks or [],
                    }
                ],
            },
        },
        "meta": {"etag": f'W/"d1-{version}"'},
        "error": None,
    }


def _use_client(server_mod, opener, token: str = "mxwp_TESTTOKEN0000000000000000"):
    api = server_mod._api()
    client = api.MxwpClient("http://fake", token, opener=opener)
    server_mod._make_client = lambda: client
    return client


# ── (a) validate_block — local schema ───────────────────────────────


def test_validate_block_valid_paragraph(server_mod) -> None:
    s = server_mod.build_server()
    res = _call(s, "validate_block", {
        "block": {"type": "paragraph", "id": ULID_A, "text": "안녕 **굵게**"}
    })
    assert res["valid"] is True
    assert res["errors"] == []


def test_validate_block_valid_slicer_without_id(server_mod) -> None:
    s = server_mod.build_server()
    res = _call(s, "validate_block", {
        "block": {
            "type": "slicer",
            "field": "dept",
            "label": "부서",
            "source": {"kind": "inline", "rows": [{"dept": "A"}, {"dept": "B"}]},
        }
    })
    assert res["valid"] is True, res["errors"]


def test_validate_block_unknown_type_reports_path(server_mod) -> None:
    s = server_mod.build_server()
    res = _call(s, "validate_block", {"block": {"type": "paragrap", "text": "x"}})
    assert res["valid"] is False
    assert res["errors"][0]["path"] == "type"
    assert "paragraph" in res["errors"][0]["message"]  # 허용 목록 안내


def test_validate_block_missing_required_field(server_mod) -> None:
    s = server_mod.build_server()
    res = _call(s, "validate_block", {"block": {"type": "paragraph", "id": ULID_A}})
    assert res["valid"] is False
    assert any("text" in e["message"] for e in res["errors"])


def test_validate_block_rejects_extra_property(server_mod) -> None:
    s = server_mod.build_server()
    res = _call(s, "validate_block", {
        "block": {"type": "paragraph", "id": ULID_A, "text": "x", "bogus": 1}
    })
    assert res["valid"] is False
    assert any("bogus" in e["message"] for e in res["errors"])


# ── (b) token / ETag / conflict — fake transport ────────────────────


def test_write_tool_without_token_gives_issuance_guidance(server_mod) -> None:
    opener = ScriptedOpener({})
    _use_client(server_mod, opener, token="")
    s = server_mod.build_server()
    with pytest.raises(ToolError) as exc:
        asyncio.run(s.call_tool("insert_block", {
            "slug": "test-doc",
            "section_id": SEC_ID,
            "block": {"type": "paragraph", "text": "x"},
        }))
    assert "MXWP_API_TOKEN" in str(exc.value)
    assert opener.requests == []  # 토큰 없으면 HTTP 자체가 없다


def test_insert_block_fetches_etag_and_sends_if_match(server_mod) -> None:
    captured: dict[str, Any] = {}

    def on_post(req):
        captured["if_match"] = req.get_header("If-match")
        captured["body"] = json.loads(req.data.decode("utf-8"))
        return _Resp(
            {
                "data": {"slug": "test-doc", "version": 4,
                         "block_id": captured["body"]["block"]["id"]},
                "meta": {"etag": 'W/"d1-4"'},
                "error": None,
            },
            {"ETag": 'W/"d1-4"'},
            status=201,
        )

    opener = ScriptedOpener({
        ("GET", "/api/v1/documents/test-doc"): lambda req: _Resp(
            _doc_envelope(version=3), {"ETag": 'W/"d1-3"'}
        ),
        ("POST", "/api/v1/documents/test-doc/blocks"): on_post,
    })
    _use_client(server_mod, opener)
    s = server_mod.build_server()
    res = _call(s, "insert_block", {
        "slug": "test-doc",
        "section_id": SEC_ID,
        "block": {"type": "paragraph", "text": "본문"},
    })
    assert captured["if_match"] == 'W/"d1-3"'
    assert captured["body"]["section_id"] == SEC_ID
    # id 자동 생성 (26-char ULID) + 응답 block_id 로 회신
    assert len(res["block_id"]) == 26
    assert res["block_id"] == captured["body"]["block"]["id"]


def test_insert_block_conflict_412_says_retry(server_mod) -> None:
    def on_post(req):
        raise _http_error(req.full_url, 412, {
            "data": None, "meta": None,
            "error": {"code": "PRECONDITION_FAILED",
                      "message": "ETag mismatch — refresh and retry"},
        })

    opener = ScriptedOpener({
        ("GET", "/api/v1/documents/test-doc"): lambda req: _Resp(
            _doc_envelope(version=3), {"ETag": 'W/"d1-3"'}
        ),
        ("POST", "/api/v1/documents/test-doc/blocks"): on_post,
    })
    _use_client(server_mod, opener)
    s = server_mod.build_server()
    with pytest.raises(ToolError) as exc:
        asyncio.run(s.call_tool("insert_block", {
            "slug": "test-doc",
            "section_id": SEC_ID,
            "block": {"type": "paragraph", "text": "x"},
        }))
    assert "다시 읽고" in str(exc.value)


def test_insert_block_invalid_block_makes_no_http_call(server_mod) -> None:
    opener = ScriptedOpener({})
    _use_client(server_mod, opener)
    s = server_mod.build_server()
    with pytest.raises(ToolError) as exc:
        asyncio.run(s.call_tool("insert_block", {
            "slug": "test-doc",
            "section_id": SEC_ID,
            "block": {"type": "callout", "text": "variant 누락"},
        }))
    assert "검증 실패" in str(exc.value)
    assert "variant" in str(exc.value)
    assert opener.requests == []


def test_update_block_merges_partial_body(server_mod) -> None:
    existing = {"type": "paragraph", "id": ULID_B, "text": "old"}
    captured: dict[str, Any] = {}

    def on_patch(req):
        captured["if_match"] = req.get_header("If-match")
        captured["body"] = json.loads(req.data.decode("utf-8"))
        return _Resp(
            {
                "data": {"slug": "test-doc", "version": 4,
                         "block": captured["body"]},
                "meta": {"etag": 'W/"d1-4"'},
                "error": None,
            },
            {"ETag": 'W/"d1-4"'},
        )

    opener = ScriptedOpener({
        ("GET", "/api/v1/documents/test-doc"): lambda req: _Resp(
            _doc_envelope(version=3, blocks=[existing]), {"ETag": 'W/"d1-3"'}
        ),
        ("PATCH", f"/api/v1/documents/test-doc/blocks/{ULID_B}"): on_patch,
    })
    _use_client(server_mod, opener)
    s = server_mod.build_server()
    res = _call(s, "update_block", {
        "slug": "test-doc", "block_id": ULID_B, "block": {"text": "new"},
    })
    assert res == {"ok": True, "version": 4}
    assert captured["if_match"] == 'W/"d1-3"'
    # 부분 body 가 기존 block 에 병합되어 완전한 paragraph 로 전송됨
    assert captured["body"] == {"type": "paragraph", "id": ULID_B, "text": "new"}


def test_get_document_outline_builds_hints(server_mod) -> None:
    blocks = [
        {"type": "paragraph", "id": ULID_A, "text": "첫 단락의 본문 텍스트"},
        {"type": "chart", "id": ULID_B, "chartType": "bar", "title": "분기 매출",
         "data": {"labels": [], "series": []}},
    ]
    opener = ScriptedOpener({
        ("GET", "/api/v1/documents/test-doc"): lambda req: _Resp(
            _doc_envelope(version=3, blocks=blocks), {"ETag": 'W/"d1-3"'}
        ),
    })
    _use_client(server_mod, opener)
    s = server_mod.build_server()
    res = _call(s, "get_document_outline", {"slug": "test-doc"})
    assert res["etag"] == 'W/"d1-3"'
    sec = res["sections"][0]
    assert sec["id"] == SEC_ID and sec["number"] == "1"
    assert sec["blocks"][0] == {
        "id": ULID_A, "type": "paragraph", "hint": "첫 단락의 본문 텍스트"
    }
    assert sec["blocks"][1]["hint"] == "분기 매출"


# ── (c) live integration ────────────────────────────────────────────

LIVE_URL = os.environ.get("MXWP_API_URL", "http://127.0.0.1:8800").rstrip("/")


def _api_alive() -> bool:
    try:
        urllib.request.urlopen(f"{LIVE_URL}/api/v1/documents?limit=1", timeout=2)
        return True
    except Exception:
        return False


def _issue_live_token() -> tuple[str, str]:
    """dev no-token admin fallback 으로 write 토큰 발급 → (token, token_id).

    발급 호출은 익명 (anon rate-limit bucket, 60/min/IP) — 429 면 Retry-After
    만큼 기다렸다 재시도 (최대 3회)."""
    body = json.dumps({
        "name": f"mcp-live-{int(time.time() * 1000)}",
        "scopes": ["read", "write"],
    }).encode("utf-8")
    req = urllib.request.Request(
        f"{LIVE_URL}/api/v1/me/api-tokens", data=body, method="POST",
        headers={"Content-Type": "application/json"},
    )
    for attempt in range(3):
        try:
            payload = json.loads(urllib.request.urlopen(req, timeout=10).read())
            break
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < 2:
                time.sleep(int(e.headers.get("Retry-After") or 2))
                continue
            raise
    data = payload["data"]
    return data["token"], data["id"]


def _revoke_live_token(token: str, token_id: str) -> None:
    req = urllib.request.Request(
        f"{LIVE_URL}/api/v1/me/api-tokens/{token_id}", method="DELETE",
        headers={"Authorization": f"Bearer {token}"},
    )
    try:
        urllib.request.urlopen(req, timeout=10)
    except Exception:
        pass  # cleanup best-effort


LIVE_BLOCKS: list[dict[str, Any]] = [
    {"type": "paragraph", "text": "라이브 테스트 본문 **굵게**"},
    {"type": "callout", "variant": "info", "title": "안내", "text": "콜아웃 본문"},
    {"type": "chart", "chartType": "bar", "title": "분기 매출",
     "data": {"labels": ["Q1", "Q2"],
              "series": [{"name": "매출", "values": [10, 20]}]}},
    {"type": "slicer", "field": "dept", "label": "부서",
     "source": {"kind": "inline", "rows": [{"dept": "A"}, {"dept": "B"}]}},
    {"type": "pivot-table",
     "source": {"kind": "inline",
                "rows": [{"dept": "A", "amount": 10}, {"dept": "B", "amount": 20}]},
     "rows": ["dept"], "cols": [],
     "values": [{"field": "amount", "agg": "sum"}]},
]


@pytest.mark.live
def test_live_full_block_roundtrip(server_mod, monkeypatch) -> None:
    if not _api_alive():
        pytest.skip(f"live API not reachable at {LIVE_URL}")
    token, token_id = _issue_live_token()
    monkeypatch.setenv("MXWP_API_URL", LIVE_URL)
    monkeypatch.setenv("MXWP_API_TOKEN", token)
    s = server_mod.build_server()
    slug = f"mcp-live-{int(time.time() * 1000)}"
    cleanup_client = server_mod._api().MxwpClient(LIVE_URL, token)
    try:
        # q 는 title/summary ILIKE — slug 로 찾을 수 있게 title 에 포함시킨다.
        created = _call(s, "create_document", {
            "title": f"MCP 라이브 테스트 {slug}", "slug": slug, "summary": "T1 live"
        })
        assert created["slug"] == slug

        outline = _call(s, "get_document_outline", {"slug": slug})
        sec_id = outline["sections"][0]["id"]
        assert outline["sections"][0]["blocks"] == []

        ids: dict[str, str] = {}
        for b in LIVE_BLOCKS:
            r = _call(s, "insert_block", {
                "slug": slug, "section_id": sec_id, "block": b,
            })
            ids[b["type"]] = r["block_id"]

        outline = _call(s, "get_document_outline", {"slug": slug})
        got = outline["sections"][0]["blocks"]
        assert [g["type"] for g in got] == [
            "paragraph", "callout", "chart", "slicer", "pivot-table"
        ]
        assert got[0]["hint"].startswith("라이브 테스트")
        assert got[2]["hint"] == "분기 매출"

        upd = _call(s, "update_block", {
            "slug": slug, "block_id": ids["paragraph"],
            "block": {"text": "수정된 본문"},
        })
        assert upd["ok"] is True and isinstance(upd["version"], int)
        blk = _call(s, "get_block", {"slug": slug, "block_id": ids["paragraph"]})
        assert blk["text"] == "수정된 본문"

        _call(s, "move_block", {
            "slug": slug, "block_id": ids["paragraph"],
            "target_section_id": sec_id,
        })
        outline = _call(s, "get_document_outline", {"slug": slug})
        assert outline["sections"][0]["blocks"][-1]["id"] == ids["paragraph"]

        _call(s, "delete_block", {"slug": slug, "block_id": ids["callout"]})
        outline = _call(s, "get_document_outline", {"slug": slug})
        assert "callout" not in [
            g["type"] for g in outline["sections"][0]["blocks"]
        ]

        # 신규 문서는 status='draft' — published 목록에는 안 보인다 (API 사양).
        # list_documents 는 반환 shape 만 검증.
        docs = _call(s, "list_documents", {"limit": 5})
        assert isinstance(docs, list)
        if docs:
            assert {"slug", "title", "part", "updated_at"} <= set(docs[0].keys())

        sec = _call(s, "get_section", {"slug": slug, "section_id": sec_id})
        assert sec["id"] == sec_id and len(sec["blocks"]) == 4
    finally:
        try:
            cleanup_client.delete_document(slug)
        except Exception:
            pass
        _revoke_live_token(token, token_id)
