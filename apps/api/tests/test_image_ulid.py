"""Sprint 6 — image ULID 회귀 테스트.

  - finalize 응답의 image_id 가 ULID(26 Crockford)
  - GET /images/<ulid> 가 정상 동작
  - 새 image_id 가 들어간 ImageBlock 으로 문서 저장 OK
"""
from __future__ import annotations

import hashlib
import io
import json
import re
import secrets
import uuid
from collections.abc import Iterator
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient
from PIL import Image
from sqlalchemy import text

from app.core.config import get_settings
from app.core.db import session_scope
from app.main import app
from app.storage import minio_adapter

SAMPLES = Path("/workspace/packages/shared/samples")
if not SAMPLES.exists():
    SAMPLES = Path(__file__).resolve().parents[3] / "packages" / "shared" / "samples"

ULID_RE = re.compile(r"^[0-9A-HJKMNP-TV-Z]{26}$")


def _png_random() -> bytes:
    img = Image.new("RGB", (8, 8))
    pixels = [
        (
            (x * 31 + y * 17 + secrets.randbits(4)) & 0xFF,
            (x * 11 + y * 13 + secrets.randbits(4)) & 0xFF,
            (x * 7 + y * 19 + secrets.randbits(4)) & 0xFF,
        )
        for y in range(8)
        for x in range(8)
    ]
    img.putdata(pixels)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _ulid_like() -> str:
    alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
    return "".join(secrets.choice(alphabet) for _ in range(26))


@pytest.fixture(autouse=True)
def _reset_minio_clients() -> Iterator[None]:
    minio_adapter.reset_clients_for_tests()
    yield
    minio_adapter.reset_clients_for_tests()


@pytest.mark.asyncio
async def test_finalize_returns_ulid_and_get_works_by_ulid() -> None:
    raw = _png_random()
    sha = hashlib.sha256(raw).hexdigest()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r1 = await ac.post(
            "/api/v1/uploads/image/init",
            json={
                "filename": "ulid.png",
                "mime_type": "image/png",
                "sha256": sha,
                "size": len(raw),
            },
        )
        assert r1.status_code == 200, r1.text
        d1 = r1.json()["data"]
        if d1.get("deduped"):
            # 기존 행 정리 후 재시도
            from app.core.db import session_scope as ss
            async with ss() as s:
                await s.execute(text("DELETE FROM images WHERE sha256 = :sha"), {"sha": sha})
            bucket = get_settings().minio_bucket_images
            cli = minio_adapter.internal_client()
            for k in ("thumb", "view", "orig"):
                try:
                    cli.delete_object(Bucket=bucket, Key=f"{sha[0:2]}/{sha[2:4]}/{sha}/{k}.webp")
                except Exception:
                    pass
            r1 = await ac.post(
                "/api/v1/uploads/image/init",
                json={
                    "filename": "ulid.png",
                    "mime_type": "image/png",
                    "sha256": sha,
                    "size": len(raw),
                },
            )
            d1 = r1.json()["data"]
            assert d1.get("deduped") is False
        upload_id = d1["uploadId"]

        bucket = get_settings().minio_bucket_images
        minio_adapter.internal_client().put_object(
            Bucket=bucket,
            Key=f"uploads/{upload_id}/ulid.png",
            Body=raw,
            ContentType="image/png",
        )

        r2 = await ac.post("/api/v1/uploads/image/finalize", json={"uploadId": upload_id})
        assert r2.status_code == 200, r2.text
        f = r2.json()["data"]
        image_id = f["image_id"]
        image_uuid = f["image_uuid"]
        # 새 image_id 는 Crockford ULID
        assert ULID_RE.match(image_id), f"expected ULID, got: {image_id}"
        # image_uuid 는 UUID
        uuid.UUID(image_uuid)  # ValueError if invalid

        # GET by ULID
        r3 = await ac.get(f"/api/v1/images/{image_id}")
        assert r3.status_code == 200, r3.text
        g_ulid = r3.json()["data"]
        assert g_ulid["image_id"] == image_id

        # GET by UUID also works (backward compat)
        r4 = await ac.get(f"/api/v1/images/{image_uuid}")
        assert r4.status_code == 200, r4.text
        g_uuid = r4.json()["data"]
        assert g_uuid["image_id"] == image_id

    # cleanup
    bucket = get_settings().minio_bucket_images
    cli = minio_adapter.internal_client()
    for k in ("thumb", "view", "orig"):
        try:
            cli.delete_object(Bucket=bucket, Key=f"{sha[0:2]}/{sha[2:4]}/{sha}/{k}.webp")
        except Exception:
            pass
    async with session_scope() as s:
        await s.execute(text("DELETE FROM images WHERE sha256 = :sha"), {"sha": sha})


@pytest.mark.asyncio
async def test_document_with_image_ulid_saves_ok() -> None:
    """finalize 가 발급한 ULID 를 ImageBlock.imageId 에 넣고 doc 저장 시 422 가 아니어야 한다."""
    raw = _png_random()
    sha = hashlib.sha256(raw).hexdigest()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r1 = await ac.post(
            "/api/v1/uploads/image/init",
            json={
                "filename": "doc-ulid.png",
                "mime_type": "image/png",
                "sha256": sha,
                "size": len(raw),
            },
        )
        d1 = r1.json()["data"]
        if d1.get("deduped"):
            async with session_scope() as s:
                await s.execute(text("DELETE FROM images WHERE sha256 = :sha"), {"sha": sha})
            r1 = await ac.post(
                "/api/v1/uploads/image/init",
                json={
                    "filename": "doc-ulid.png",
                    "mime_type": "image/png",
                    "sha256": sha,
                    "size": len(raw),
                },
            )
            d1 = r1.json()["data"]
        upload_id = d1["uploadId"]

        bucket = get_settings().minio_bucket_images
        minio_adapter.internal_client().put_object(
            Bucket=bucket,
            Key=f"uploads/{upload_id}/doc-ulid.png",
            Body=raw,
            ContentType="image/png",
        )

        r2 = await ac.post("/api/v1/uploads/image/finalize", json={"uploadId": upload_id})
        assert r2.status_code == 200, r2.text
        image_id = r2.json()["data"]["image_id"]
        assert ULID_RE.match(image_id)

        # ImageBlock 이 들어간 문서 만들기
        sample = json.loads((SAMPLES / "05-minimal-doc.json").read_text(encoding="utf-8"))
        new_slug = f"doc-with-image-{uuid.uuid4().hex[:8]}"
        sample["slug"] = new_slug
        sample["id"] = _ulid_like()
        sample["sections"][0]["blocks"].append({
            "type": "image",
            "id": _ulid_like(),
            "imageId": image_id,
            "alt": "테스트",
        })

        r3 = await ac.post("/api/v1/documents", json=sample)
        assert r3.status_code == 201, r3.text

    # cleanup
    cli = minio_adapter.internal_client()
    for k in ("thumb", "view", "orig"):
        try:
            cli.delete_object(Bucket=bucket, Key=f"{sha[0:2]}/{sha[2:4]}/{sha}/{k}.webp")
        except Exception:
            pass
    async with session_scope() as s:
        await s.execute(text("DELETE FROM documents WHERE slug = :slug"), {"slug": new_slug})
        await s.execute(text("DELETE FROM images WHERE sha256 = :sha"), {"sha": sha})
