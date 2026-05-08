"""files 라우터 단위 테스트.

흐름:
  1) /files/presign-put → presigned URL 발급 + file_id 반환
  2) 클라이언트가 PUT (테스트는 boto3 client 로 직접 put_object)
  3) /files/finalize → HEAD 검증 + files row INSERT + download_url 반환
  4) /files/<id>/download → 302 redirect → presigned GET URL

storage client 는 minio_adapter 의 internal/public client 로 위임되며,
테스트는 실제 MinIO (apptainer instance) 와 동일 endpoint 를 사용한다.
무거운 처리는 없으므로 mock 없이 라이브로 검증한다.
"""
from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.config import get_settings
from app.main import app
from app.routers import files as files_router_mod
from app.storage import minio_adapter


@pytest.fixture(autouse=True)
def _reset_state(monkeypatch):
    monkeypatch.setenv("MXWP_SKIP_VIEW_REFRESH", "1")
    minio_adapter.reset_clients_for_tests()
    files_router_mod._reset_rate_limit_for_tests()
    yield
    files_router_mod._reset_rate_limit_for_tests()
    minio_adapter.reset_clients_for_tests()


def _cleanup_file(file_id: str, filename: str) -> None:
    bucket = get_settings().minio_bucket_files
    cli = minio_adapter.internal_client()
    try:
        cli.delete_object(Bucket=bucket, Key=f"{file_id}/{filename}")
    except Exception:
        pass


@pytest.mark.asyncio
async def test_presign_put_returns_url_and_file_id() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post(
            "/api/v1/files/presign-put",
            json={"filename": "report.pdf", "mime": "application/pdf", "size": 1024},
        )
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["method"] == "PUT"
    assert data["presigned_url"].startswith("http")
    assert len(data["file_id"]) == 26   # ULID
    assert data["key"].endswith("/report.pdf")
    assert data["headers"]["Content-Type"] == "application/pdf"
    assert data["expires_in"] == 300


@pytest.mark.asyncio
async def test_presign_put_rejects_oversize() -> None:
    big = get_settings().file_max_bytes + 1
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post(
            "/api/v1/files/presign-put",
            json={"filename": "big.zip", "mime": "application/zip", "size": big},
        )
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "VALIDATION_ERROR"


@pytest.mark.asyncio
async def test_presign_put_rejects_blocked_mime() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # exe / shell script / js 모두 거부.
        for bad in (
            "application/x-msdownload",
            "application/x-sh",
            "application/javascript",
            "application/x-executable",
        ):
            r = await ac.post(
                "/api/v1/files/presign-put",
                json={"filename": "x.bin", "mime": bad, "size": 100},
            )
            assert r.status_code == 422, f"{bad}: {r.text}"
            assert r.json()["error"]["code"] == "VALIDATION_ERROR"


@pytest.mark.asyncio
async def test_presign_put_rejects_image_mime_with_hint() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post(
            "/api/v1/files/presign-put",
            json={"filename": "x.png", "mime": "image/png", "size": 100},
        )
    assert r.status_code == 422, r.text
    body = r.json()
    assert body["error"]["code"] == "VALIDATION_ERROR"
    # 안내 — 이미지 라우터 사용 권장
    assert "uploads/image" in (body["error"].get("details") or {}).get("use_endpoint", "")


@pytest.mark.asyncio
async def test_finalize_without_prior_put_returns_404() -> None:
    """presign 받은 file_id 라도 실제 PUT 이 없으면 HEAD 가 404."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # presign 만 받아놓고 PUT 은 생략
        r1 = await ac.post(
            "/api/v1/files/presign-put",
            json={"filename": "ghost.pdf", "mime": "application/pdf", "size": 7},
        )
        assert r1.status_code == 200
        file_id = r1.json()["data"]["file_id"]

        r2 = await ac.post(
            "/api/v1/files/finalize",
            json={
                "file_id": file_id,
                "filename": "ghost.pdf",
                "mime": "application/pdf",
                "size": 7,
            },
        )
    assert r2.status_code == 404, r2.text


@pytest.mark.asyncio
async def test_full_pipeline_presign_put_finalize_download() -> None:
    """presign → 직접 PUT → finalize → 302 download redirect (happy path)."""
    raw = b"%PDF-1.4 fake pdf body for test\n%%EOF\n"
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r1 = await ac.post(
            "/api/v1/files/presign-put",
            json={"filename": "doc.pdf", "mime": "application/pdf", "size": len(raw)},
        )
        assert r1.status_code == 200, r1.text
        d1 = r1.json()["data"]
        file_id = d1["file_id"]

        # 직접 staging key 에 PUT (presigned 우회 — 동일 효과)
        bucket = get_settings().minio_bucket_files
        minio_adapter.internal_client().put_object(
            Bucket=bucket,
            Key=d1["key"],
            Body=raw,
            ContentType="application/pdf",
        )

        r2 = await ac.post(
            "/api/v1/files/finalize",
            json={
                "file_id": file_id,
                "filename": "doc.pdf",
                "mime": "application/pdf",
                "size": len(raw),
            },
        )
        assert r2.status_code == 200, r2.text
        d2 = r2.json()["data"]
        assert d2["file_id"] == file_id
        assert d2["filename"] == "doc.pdf"
        assert d2["size"] == len(raw)
        assert d2["mime"] == "application/pdf"
        assert d2["download_url"].startswith("http")

        # download → 302
        r3 = await ac.get(
            f"/api/v1/files/{file_id}/download",
            follow_redirects=False,
        )
        assert r3.status_code == 302, r3.text
        assert r3.headers["location"].startswith("http")

    _cleanup_file(file_id, "doc.pdf")


@pytest.mark.asyncio
async def test_finalize_size_mismatch_returns_422() -> None:
    raw = b"hello world"
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r1 = await ac.post(
            "/api/v1/files/presign-put",
            json={"filename": "h.txt", "mime": "text/plain", "size": len(raw)},
        )
        assert r1.status_code == 200
        d1 = r1.json()["data"]
        file_id = d1["file_id"]

        # 실제 PUT 사이즈가 init 사이즈와 다름 (10 → 11) → finalize 422
        bucket = get_settings().minio_bucket_files
        minio_adapter.internal_client().put_object(
            Bucket=bucket, Key=d1["key"], Body=raw + b"!", ContentType="text/plain",
        )

        r2 = await ac.post(
            "/api/v1/files/finalize",
            json={
                "file_id": file_id,
                "filename": "h.txt",
                "mime": "text/plain",
                "size": len(raw),
            },
        )
    assert r2.status_code == 422, r2.text

    _cleanup_file(file_id, "h.txt")


@pytest.mark.asyncio
async def test_download_unknown_id_returns_404() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get(
            "/api/v1/files/01ABCDEFGHJKMNPQRSTVWXYZ00/download",
            follow_redirects=False,
        )
    assert r.status_code == 404, r.text
