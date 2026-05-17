"""Sprint 5 — image upload pipeline 통합 테스트.

흐름:
  1) /init 요청 → presigned PUT URL 받음 (또는 dedup 응답)
  2) 클라이언트가 PUT 으로 raw 바이트 업로드 (테스트는 boto3 client 로 직접 put_object)
  3) /finalize → image_id + 3종 url 반환 + EXIF 제거 검증
  4) 같은 sha256 으로 다시 init → deduped: true
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
from app.storage import minio_adapter


# ── 헬퍼 ──────────────────────────────────────────────────────────────
def _png_with_exif(width: int = 8, height: int = 8) -> bytes:
    """8x8 PNG 를 Pillow 로 인코딩 (EXIF 없음, 원본 색만 다양)."""
    img = Image.new("RGB", (width, height))
    # 약간의 패턴 — 매 호출마다 픽셀이 달라져 sha256 가 달라지도록 random 사용
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


def _jpeg_with_exif() -> bytes:
    """JPEG with synthetic EXIF orientation tag — finalize 후 EXIF 가 제거됐는지 확인용."""
    img = Image.new("RGB", (16, 16), color=(120, 64, 200))
    # Pillow EXIF 빌드: ImageDescription tag
    exif = img.getexif()
    exif[0x010E] = "MX White Paper test image — EXIF should be stripped"
    exif[0x0112] = 1  # Orientation
    buf = io.BytesIO()
    img.save(buf, format="JPEG", exif=exif.tobytes(), quality=90)
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
    # 단위 테스트에서 view refresh 비활성 (이미 conftest 에서 설정되어 있지만 안전망)
    monkeypatch.setenv("MXWP_SKIP_VIEW_REFRESH", "1")
    minio_adapter.reset_clients_for_tests()
    yield
    minio_adapter.reset_clients_for_tests()


# ── 테스트 ────────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_init_returns_presigned_url_for_new_sha256() -> None:
    raw = _png_with_exif()
    sha = _sha256(raw)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post(
            "/api/v1/uploads/image/init",
            json={
                "filename": "tiny.png",
                "mime_type": "image/png",
                "sha256": sha,
                "size": len(raw),
            },
        )
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["deduped"] is False
    assert data["method"] == "PUT"
    assert "uploadId" in data and len(data["uploadId"]) >= 16
    assert data["url"].startswith("http")
    assert data["headers"]["Content-Type"] == "image/png"
    assert data["expiresIn"] == 600

    # cleanup pending row + any staged object
    _cleanup_test_objects(f"uploads/{data['uploadId']}/")


@pytest.mark.asyncio
async def test_init_dedup_when_sha_already_exists() -> None:
    """이미 finalize 된 sha 와 동일 → deduped: true."""
    raw = _png_with_exif()
    sha = _sha256(raw)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # 1차 init
        r1 = await ac.post(
            "/api/v1/uploads/image/init",
            json={"filename": "a.png", "mime_type": "image/png", "sha256": sha, "size": len(raw)},
        )
        assert r1.status_code == 200, r1.text
        d1 = r1.json()["data"]
        upload_id = d1["uploadId"]

        # 직접 staging key 에 PUT (presigned 우회 — apptainer 내부에서 동일 효과)
        bucket = get_settings().minio_bucket_images
        minio_adapter.internal_client().put_object(
            Bucket=bucket, Key=f"uploads/{upload_id}/a.png", Body=raw,
            ContentType="image/png",
        )

        # finalize
        r2 = await ac.post("/api/v1/uploads/image/finalize", json={"uploadId": upload_id})
        assert r2.status_code == 200, r2.text
        f_data = r2.json()["data"]
        image_id = f_data["image_id"]

        # 2차 init: 같은 sha → deduped
        r3 = await ac.post(
            "/api/v1/uploads/image/init",
            json={"filename": "b.png", "mime_type": "image/png", "sha256": sha, "size": len(raw)},
        )
        assert r3.status_code == 200, r3.text
        d3 = r3.json()["data"]
        assert d3["deduped"] is True
        assert d3["image_id"] == image_id
        assert "thumb" in d3["urls"] and "view" in d3["urls"] and "orig" in d3["urls"]

    # 영구 객체는 그대로 두지 않고 정리 (다음 테스트 셋과 충돌 방지)
    _cleanup_test_objects(f"{sha[0:2]}/{sha[2:4]}/{sha}/")


@pytest.mark.asyncio
async def test_init_size_too_large_returns_422() -> None:
    sha = "a" * 64
    big = get_settings().image_max_bytes + 1
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post(
            "/api/v1/uploads/image/init",
            json={"filename": "x.png", "mime_type": "image/png", "sha256": sha, "size": big},
        )
    assert r.status_code == 422, r.text
    body = r.json()
    assert body["error"]["code"] == "VALIDATION_ERROR"


@pytest.mark.asyncio
async def test_finalize_unknown_upload_id_returns_404() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post(
            "/api/v1/uploads/image/finalize",
            json={"uploadId": "01JABCDEFGHIJKLMNOPQRSTUVW"},
        )
    assert r.status_code == 404, r.text


@pytest.mark.asyncio
async def test_finalize_strips_exif_and_generates_3_sizes() -> None:
    raw = _jpeg_with_exif()
    sha = _sha256(raw)

    # sanity: 원본에 EXIF 가 있어야 한다
    src_img = Image.open(io.BytesIO(raw))
    src_exif = src_img.getexif()
    assert dict(src_exif), "test fixture must include EXIF"

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r1 = await ac.post(
            "/api/v1/uploads/image/init",
            json={"filename": "exif.jpg", "mime_type": "image/jpeg", "sha256": sha, "size": len(raw)},
        )
        assert r1.status_code == 200, r1.text
        d1 = r1.json()["data"]
        # 이미 존재하면 (이전 실행 잔재) 정리 후 재시도
        if d1.get("deduped"):
            _cleanup_test_objects(f"{sha[0:2]}/{sha[2:4]}/{sha}/")
            # row 도 지움
            from sqlalchemy import text as _text

            from app.core.db import session_scope
            async with session_scope() as s:
                await s.execute(_text("DELETE FROM images WHERE sha256 = :sha"), {"sha": sha})
            r1 = await ac.post(
                "/api/v1/uploads/image/init",
                json={"filename": "exif.jpg", "mime_type": "image/jpeg", "sha256": sha, "size": len(raw)},
            )
            assert r1.status_code == 200
            d1 = r1.json()["data"]
            assert d1["deduped"] is False
        upload_id = d1["uploadId"]

        # staging PUT
        bucket = get_settings().minio_bucket_images
        minio_adapter.internal_client().put_object(
            Bucket=bucket, Key=f"uploads/{upload_id}/exif.jpg", Body=raw,
            ContentType="image/jpeg",
        )

        # finalize
        r2 = await ac.post("/api/v1/uploads/image/finalize", json={"uploadId": upload_id})
        assert r2.status_code == 200, r2.text
        f_data = r2.json()["data"]
        image_id = f_data["image_id"]
        assert "thumb" in f_data["urls"] and "view" in f_data["urls"] and "orig" in f_data["urls"]
        assert f_data["dominant_color"].startswith("#")
        assert f_data["width"] == 16 and f_data["height"] == 16

        # GET image — alt/caption: None
        r3 = await ac.get(f"/api/v1/images/{image_id}")
        assert r3.status_code == 200, r3.text
        gdata = r3.json()["data"]
        assert gdata["image_id"] == image_id
        assert gdata["mime_type"] == "image/jpeg"
        assert gdata["alt"] is None
        assert gdata["caption"] is None

        # 영구 객체 fetch → EXIF 제거 확인
        cli = minio_adapter.internal_client()
        orig_obj = cli.get_object(Bucket=bucket, Key=f"{sha[0:2]}/{sha[2:4]}/{sha}/orig.webp")
        orig_bytes = orig_obj["Body"].read()
        out_img = Image.open(io.BytesIO(orig_bytes))
        out_exif = out_img.getexif()
        # WebP 변환 시 EXIF 가 명시적으로 보존되지 않으면 비어있어야 한다.
        assert not dict(out_exif), f"EXIF should be stripped, got: {dict(out_exif)}"

    # cleanup
    _cleanup_test_objects(f"{sha[0:2]}/{sha[2:4]}/{sha}/")
    from sqlalchemy import text as _text

    from app.core.db import session_scope
    async with session_scope() as s:
        await s.execute(_text("DELETE FROM images WHERE sha256 = :sha"), {"sha": sha})


@pytest.mark.asyncio
async def test_get_image_404_for_missing_id() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/v1/images/00000000-0000-0000-0000-000000000000")
    assert r.status_code == 404, r.text
