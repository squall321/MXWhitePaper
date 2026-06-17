"""Tests for the file/image MCP tools (T4).

Layers:
  (a) encode_multipart — boundary + Content-Disposition unit test (no HTTP).
  (b) live: upload_image (init→PUT→finalize→image_id, then dedup) and
      import_file (openpyxl-built .xlsx → import → save → slug → cleanup).

Live tests reuse the token issue/revoke + _api_alive helpers from
test_write_tools (same dev no-token admin fallback).
"""
from __future__ import annotations

import asyncio
import importlib.util
import io
import secrets
import struct
import time
import zlib
from pathlib import Path
from typing import Any

import pytest

_HERE = Path(__file__).resolve()
_SERVER_PY = _HERE.parents[1] / "server.py"

# live helpers live in the sibling write-tools test module.
from test_write_tools import (  # noqa: E402
    _api_alive,
    _issue_live_token,
    _revoke_live_token,
    LIVE_URL,
)


def _load_server_module():
    spec = importlib.util.spec_from_file_location("_mxwp_mcp_server_ft", _SERVER_PY)
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


# ── (a) encode_multipart unit ───────────────────────────────────────


def test_encode_multipart_layout(server_mod) -> None:
    api = server_mod._api()
    body, boundary = api.encode_multipart(
        file_field_name="file",
        filename="a.xlsx",
        content=b"PK\x03\x04bytes",
        content_type="application/zip",
        form_fields={"slug": "my-doc", "title": "제목"},
    )
    text = body.decode("utf-8", errors="replace")
    # boundary 가 본문에 등장하고 닫는 boundary 는 -- 로 끝난다.
    assert boundary in text
    assert text.endswith(f"--{boundary}--\r\n")
    # text 필드 + 파일 파트의 Content-Disposition.
    assert 'Content-Disposition: form-data; name="slug"' in text
    assert "my-doc" in text
    assert 'Content-Disposition: form-data; name="title"' in text
    assert "제목" in text
    assert (
        'Content-Disposition: form-data; name="file"; filename="a.xlsx"' in text
    )
    assert "Content-Type: application/zip" in text
    # 파일 바이트 보존.
    assert b"PK\x03\x04bytes" in body
    # CRLF 라인 구분.
    assert b"\r\n" in body


# ── tiny valid PNG (1×1) — stdlib only ──────────────────────────────


def _make_png() -> bytes:
    """매 호출마다 sha256 이 다른 1×1 PNG (랜덤 픽셀) — 재실행해도 dedup 충돌 없음."""
    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    rgb = secrets.token_bytes(3)
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)  # 1×1, 8-bit RGB
    raw = b"\x00" + rgb  # one filtered scanline: filter 0 + R G B
    idat = zlib.compress(raw)
    return sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")


def _make_xlsx() -> bytes:
    openpyxl = pytest.importorskip("openpyxl")
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Sheet1"
    ws.append(["부서", "금액"])
    ws.append(["A", 10])
    ws.append(["B", 20])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


# ── (b) live ─────────────────────────────────────────────────────────


@pytest.mark.live
def test_live_upload_image_and_dedup(server_mod, monkeypatch, tmp_path) -> None:
    if not _api_alive():
        pytest.skip(f"live API not reachable at {LIVE_URL}")
    token, token_id = _issue_live_token()
    monkeypatch.setenv("MXWP_API_URL", LIVE_URL)
    monkeypatch.setenv("MXWP_API_TOKEN", token)
    s = server_mod.build_server()

    png = tmp_path / f"mcp-live-{int(time.time() * 1000)}.png"
    png.write_bytes(_make_png())
    try:
        first = _call(s, "upload_image", {"path": str(png)})
        assert first["image_id"]
        assert len(first["image_id"]) == 26  # ULID
        assert first["deduped"] is False

        # 같은 내용 재업로드 → dedup, 동일 image_id.
        again = _call(s, "upload_image", {"path": str(png)})
        assert again["deduped"] is True
        assert again["image_id"] == first["image_id"]
    finally:
        _revoke_live_token(token, token_id)


@pytest.mark.live
def test_live_import_file_xlsx_save(server_mod, monkeypatch, tmp_path) -> None:
    if not _api_alive():
        pytest.skip(f"live API not reachable at {LIVE_URL}")
    token, token_id = _issue_live_token()
    monkeypatch.setenv("MXWP_API_URL", LIVE_URL)
    monkeypatch.setenv("MXWP_API_TOKEN", token)
    s = server_mod.build_server()

    xlsx = tmp_path / f"mcp-live-{int(time.time() * 1000)}.xlsx"
    xlsx.write_bytes(_make_xlsx())
    cleanup_client = server_mod._api().MxwpClient(LIVE_URL, token)
    created_slug: str | None = None

    def _import(args: dict[str, Any]) -> Any:
        # /imports 라우터는 5/min/user in-process rate-limit (60s sliding) — 연속
        # 실행 시 429. 슬라이딩 윈도가 비도록 잠깐 기다렸다 재시도.
        for attempt in range(4):
            try:
                return _call(s, "import_file", args)
            except Exception as e:  # noqa: BLE001
                if "rate limit" in str(e).lower() and attempt < 3:
                    time.sleep(20)
                    continue
                raise
        raise AssertionError("unreachable")

    try:
        res = _import({"path": str(xlsx), "save": True})
        assert res["slug"]
        created_slug = res["slug"]
        assert res["sections"] >= 1
        assert isinstance(res["message"], str) and res["message"]

        # save=False → slug 없음, 저장 안 함.
        nosave = _import({"path": str(xlsx), "save": False})
        assert "slug" not in nosave
        assert nosave["sections"] >= 1
    finally:
        if created_slug:
            try:
                cleanup_client.delete_document(created_slug)
            except Exception:
                pass
        _revoke_live_token(token, token_id)
