# from-url 이미지 인제스트 — SSRF 가드 + 직접 저장 파이프라인 통합 테스트.
"""POST /api/v1/uploads/image/from-url 통합 테스트.

흐름:
  1) 정상: 원격 fetch 를 monkeypatch 로 작은 PNG 로 대체 → image_id 발급 +
     GET /images/{id} 200 (네트워크/SSRF 가드를 통과하는 fetch 계층만 대체).
  2) 사설/예약 IP 리터럴 → SSRF 가드가 4xx 로 차단 (getaddrinfo 가 IP 리터럴을
     그대로 반환하므로 네트워크 없이 검증).
  3) 비로그인(APP_ENV=production, bearer 없음) → 401.
  4) 비-http 스킴 거부.
"""
from __future__ import annotations

import hashlib
import io
import secrets

import pytest
from httpx import ASGITransport, AsyncClient
from PIL import Image

from app.core.config import get_settings
from app.main import app
from app.services import upload_service
from app.storage import minio_adapter


def _png(width: int = 8, height: int = 8) -> bytes:
    img = Image.new("RGB", (width, height))
    pixels = [
        (
            (x * 31 + y * 17 + secrets.randbits(4)) & 0xFF,
            (x * 11 + y * 13 + secrets.randbits(4)) & 0xFF,
            (x * 7 + y * 19 + secrets.randbits(4)) & 0xFF,
        )
        for y in range(height)
        for x in range(width)
    ]
    img.putdata(pixels)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _cleanup_test_objects(prefix: str) -> None:
    bucket = get_settings().minio_bucket_images
    cli = minio_adapter.internal_client()
    paginator = cli.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for obj in page.get("Contents") or []:
            try:
                cli.delete_object(Bucket=bucket, Key=obj["Key"])
            except Exception:
                pass


@pytest.fixture(autouse=True)
def _ensure_test_env(monkeypatch):
    monkeypatch.setenv("MXWP_SKIP_VIEW_REFRESH", "1")
    minio_adapter.reset_clients_for_tests()
    yield
    minio_adapter.reset_clients_for_tests()


# ── (a) 정상 fetch → image_id + GET /images/{id} 200 ─────────────────
@pytest.mark.asyncio
async def test_from_url_success_stores_image(monkeypatch) -> None:
    raw = _png()
    sha = _sha256(raw)

    def _fake_fetch(url: str, *, max_bytes: int):
        return raw, "image/png"

    monkeypatch.setattr(upload_service, "_fetch_remote_bytes", _fake_fetch)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post(
            "/api/v1/uploads/image/from-url",
            json={"url": "https://example.com/pic.png"},
        )
        assert r.status_code == 200, r.text
        data = r.json()["data"]
        assert data["deduped"] is False
        image_id = data["image_id"]
        assert len(image_id) == 26
        assert "thumb" in data["urls"] and "view" in data["urls"] and "orig" in data["urls"]

        g = await ac.get(f"/api/v1/images/{image_id}")
        assert g.status_code == 200, g.text
        assert g.json()["data"]["image_id"] == image_id

    _cleanup_test_objects(f"{sha[0:2]}/{sha[2:4]}/{sha}/")
    from sqlalchemy import text as _text

    from app.core.db import session_scope
    async with session_scope() as s:
        await s.execute(_text("DELETE FROM images WHERE sha256 = :sha"), {"sha": sha})


# ── (b) 사설/예약 IP → SSRF 차단 (4xx) ───────────────────────────────
@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1:9000/x.png",          # loopback
        "http://10.0.0.5/x.png",                # 사설 10/8
        "http://192.168.1.10/x.png",            # 사설 192.168/16
        "http://169.254.169.254/latest/meta",   # link-local (클라우드 메타데이터)
    ],
)
@pytest.mark.asyncio
async def test_from_url_blocks_private_addresses(url) -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post("/api/v1/uploads/image/from-url", json={"url": url})
    assert 400 <= r.status_code < 500, r.text
    assert r.json()["error"]["code"] == "VALIDATION_ERROR"


def test_ssrf_guard_unit() -> None:
    """SSRF 가드 단위 — 사설/예약은 False, 공인은 True."""
    assert upload_service._host_is_public("127.0.0.1") is False
    assert upload_service._host_is_public("10.0.0.5") is False
    assert upload_service._host_is_public("192.168.0.1") is False
    assert upload_service._host_is_public("169.254.169.254") is False
    assert upload_service._host_is_public("::1") is False
    assert upload_service._host_is_public("8.8.8.8") is True


# ── (c) 비로그인 → 401 ───────────────────────────────────────────────
@pytest.mark.asyncio
async def test_from_url_requires_auth_in_production(monkeypatch) -> None:
    from app.core import config as cfg
    monkeypatch.setenv("APP_ENV", "production")
    cfg.get_settings.cache_clear()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post(
            "/api/v1/uploads/image/from-url",
            json={"url": "https://example.com/pic.png"},
        )

    cfg.get_settings.cache_clear()
    assert r.status_code == 401, r.text


# ── (d) 비-http 스킴 거부 ─────────────────────────────────────────────
@pytest.mark.asyncio
async def test_from_url_rejects_non_http_scheme() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post(
            "/api/v1/uploads/image/from-url",
            json={"url": "file:///etc/passwd"},
        )
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "VALIDATION_ERROR"
