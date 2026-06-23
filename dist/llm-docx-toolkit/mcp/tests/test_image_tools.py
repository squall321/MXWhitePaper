"""이미지 전송 도구 3종 (upload_image_from_url / upload_image_base64 /
extract_pptx_images) 테스트 — RA upload_from_url/upload_file/extract_pptx_images 파리티.

Layers:
  (a) 단위: 256KB 초과 base64 거부, 잘못된 base64 거부, from_url api_client 매핑 (mock opener).
  (b) live: base64 작은 PNG → image_id + resolvable, extract_pptx_images (임시 pptx zip) → image_ids.

from-url 도구는 T1 서버 endpoint (POST /uploads/image/from-url) 가 있으면 live,
없으면 api_client 단위 (mock) 로 계약만 검증한다.
"""
from __future__ import annotations

import asyncio
import base64
import importlib.util
import io
import time
import zipfile
from pathlib import Path
from typing import Any

import pytest

_HERE = Path(__file__).resolve()
_SERVER_PY = _HERE.parents[1] / "server.py"

# live helpers + tiny-PNG factory live in the sibling test modules.
from test_write_tools import (  # noqa: E402
    _api_alive,
    _issue_live_token,
    _revoke_live_token,
    LIVE_URL,
)
from test_file_tools import _make_png  # noqa: E402


def _load_server_module():
    spec = importlib.util.spec_from_file_location("_mxwp_mcp_server_it", _SERVER_PY)
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


def _make_pptx_with_images(images: dict[str, bytes]) -> bytes:
    """ppt/media/ 에 images 를 담은 최소 zip — extract_pptx_images 는 media 만 읽는다."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", "<Types/>")
        zf.writestr("ppt/presentation.xml", "<presentation/>")
        for name, content in images.items():
            zf.writestr(f"ppt/media/{name}", content)
    return buf.getvalue()


# ── (a) 단위 ─────────────────────────────────────────────────────────


def test_base64_oversize_rejected(server_mod, monkeypatch) -> None:
    # 토큰 검사를 통과시키기 위해 더미 토큰 주입 (HTTP 까지 가지 않고 캡에서 막힘).
    monkeypatch.setenv("MXWP_API_TOKEN", "dummy")
    s = server_mod.build_server()
    big = base64.b64encode(b"x" * (257 * 1024)).decode("ascii")
    with pytest.raises(Exception) as ei:
        _call(s, "upload_image_base64", {"filename": "big.png", "data_base64": big})
    assert "너무 큽니다" in str(ei.value)
    assert "upload_image_from_url" in str(ei.value)


def test_base64_invalid_rejected(server_mod, monkeypatch) -> None:
    monkeypatch.setenv("MXWP_API_TOKEN", "dummy")
    s = server_mod.build_server()
    with pytest.raises(Exception) as ei:
        _call(s, "upload_image_base64", {"filename": "x.png", "data_base64": "!!!notb64"})
    assert "base64" in str(ei.value)


def test_from_url_api_client_mapping(server_mod) -> None:
    """T1 endpoint 부재 시에도 api_client 의 from-url 매핑 계약을 mock 으로 검증."""
    api = server_mod._api()
    captured: dict[str, Any] = {}

    class _Resp:
        def __init__(self, payload: bytes) -> None:
            self._payload = payload
            self.headers: dict[str, str] = {}

        def read(self) -> bytes:
            return self._payload

    def fake_opener(req, timeout):
        captured["url"] = req.full_url
        captured["method"] = req.get_method()
        captured["body"] = req.data
        payload = (
            b'{"data": {"image_id": "01HZZZZZZZZZZZZZZZZZZZZZZZ", '
            b'"deduped": false, "urls": {"view": "http://x/v.webp", '
            b'"orig": "http://x/o.webp"}}}'
        )
        return _Resp(payload)

    client = api.MxwpClient(LIVE_URL, "tok", opener=fake_opener)
    out = client.upload_image_from_url("https://example.com/a.png")
    assert out["image_id"] == "01HZZZZZZZZZZZZZZZZZZZZZZZ"
    assert out["deduped"] is False
    assert out["image_url"] == "http://x/v.webp"
    assert captured["method"] == "POST"
    assert captured["url"].endswith("/api/v1/uploads/image/from-url")
    assert b'"url"' in captured["body"]
    assert b"example.com" in captured["body"]


# ── (b) live ─────────────────────────────────────────────────────────


@pytest.mark.live
def test_live_upload_image_base64(server_mod, monkeypatch) -> None:
    if not _api_alive():
        pytest.skip(f"live API not reachable at {LIVE_URL}")
    token, token_id = _issue_live_token()
    monkeypatch.setenv("MXWP_API_URL", LIVE_URL)
    monkeypatch.setenv("MXWP_API_TOKEN", token)
    s = server_mod.build_server()

    data_b64 = base64.b64encode(_make_png()).decode("ascii")
    try:
        out = _call(
            s, "upload_image_base64", {"filename": "desk.png", "data_base64": data_b64}
        )
        assert out["image_id"]
        assert len(out["image_id"]) == 26  # ULID
        assert out["deduped"] is False
        # image_id 가 실제로 조회 가능한지 (resolvable) GET /images/{id} 로 확인.
        client = server_mod._api().MxwpClient(LIVE_URL, token)
        data, _m, _h = client._request(
            "GET", f"/api/v1/images/{out['image_id']}"
        )
        assert (data or {}).get("image_id") == out["image_id"]
        assert ((data or {}).get("urls") or {}).get("view")
    finally:
        _revoke_live_token(token, token_id)


@pytest.mark.live
def test_live_extract_pptx_images(server_mod, monkeypatch, tmp_path) -> None:
    if not _api_alive():
        pytest.skip(f"live API not reachable at {LIVE_URL}")
    token, token_id = _issue_live_token()
    monkeypatch.setenv("MXWP_API_URL", LIVE_URL)
    monkeypatch.setenv("MXWP_API_TOKEN", token)
    s = server_mod.build_server()

    # 2 개의 서로 다른 PNG + 1 개의 svg(=skip) 를 ppt/media 에 담는다.
    pptx_bytes = _make_pptx_with_images(
        {
            "image1.png": _make_png(),
            "image2.png": _make_png(),
            "vector.svg": b"<svg/>",
        }
    )
    pptx = tmp_path / f"mcp-live-{int(time.time() * 1000)}.pptx"
    pptx.write_bytes(pptx_bytes)
    try:
        out = _call(s, "extract_pptx_images", {"path": str(pptx)})
        assert out["extracted"] == 2
        assert out["skipped"] == 1  # svg
        ids = [im["image_id"] for im in out["images"]]
        assert len(ids) == 2
        assert all(len(i) == 26 for i in ids)  # ULID
    finally:
        _revoke_live_token(token, token_id)


@pytest.mark.live
def test_live_upload_image_from_url_if_available(server_mod, monkeypatch) -> None:
    """T1 endpoint (POST /uploads/image/from-url) 가 배포돼 있으면 live.

    endpoint 미배포 시 404 → skip. 배포돼 있어도 컨테이너에 외부 인터넷이
    없어 fetch 자체가 실패할 수 있으므로, 원격 fetch 단계 실패는 환경 한계로
    보고 skip (도구 계약은 test_from_url_api_client_mapping 가 단위로 검증)."""
    if not _api_alive():
        pytest.skip(f"live API not reachable at {LIVE_URL}")
    token, token_id = _issue_live_token()
    monkeypatch.setenv("MXWP_API_URL", LIVE_URL)
    monkeypatch.setenv("MXWP_API_TOKEN", token)
    s = server_mod.build_server()
    try:
        out = _call(
            s,
            "upload_image_from_url",
            {"url": "https://raw.githubusercontent.com/githubtraining/hellogitworld/master/resources/logo.png"},
        )
        assert out["image_id"]
        assert len(out["image_id"]) == 26
    except Exception as e:  # noqa: BLE001
        msg = str(e)
        if "404" in msg and "from-url" in msg:
            pytest.skip("from-url endpoint 미배포 (T1) — api_client 단위로만 검증됨")
        if any(k in msg for k in ("timeout", "연결", "fetch", "다운로드", "URL")):
            pytest.skip(f"외부 fetch 불가 (컨테이너 네트워크 한계): {msg[:120]}")
        raise
    finally:
        _revoke_live_token(token, token_id)
