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


# ── per-document download authz ──────────────────────────────────────
# 두 케이스만 추가 — happy path + 거부 path.
#  - reader 가 file 의 owner 가 아니면, 해당 file 을 참조하는 non-archived
#    문서가 하나라도 있어야 302 가 나가야 한다.
#  - 어느 문서도 참조하지 않으면 403.
#
# dev fallback 으로 admin 이 download 요청을 보내므로, 비-소유자 분기를
# 강제로 타려면 직접 DB 에서 owner 를 다른 UUID 로 갈아끼운다.

async def _ensure_dummy_owner_user_id() -> str:
    """Insert a non-admin user we can re-attribute the file to. UUID 안정용."""
    from sqlalchemy import text as _t

    from app.core.db import session_scope
    from app.core.security import hash_password

    async with session_scope() as s:
        row = (await s.execute(
            _t(
                "SELECT id FROM users WHERE email = :e"
            ),
            {"e": "file-owner-fixture@example.com"},
        )).first()
        if row:
            return str(row[0])
        row = (await s.execute(
            _t(
                """
                INSERT INTO users
                  (email, name, password_hash, role, is_active)
                VALUES (:e, :n, :pw, 'editor', TRUE)
                RETURNING id
                """
            ),
            {
                "e": "file-owner-fixture@example.com",
                "n": "File Owner Fixture",
                "pw": hash_password("not-real-pw-123!"),
            },
        )).first()
        assert row is not None
        return str(row[0])


async def _reassign_file_owner(file_id: str, owner_user_id: str) -> None:
    from sqlalchemy import text as _t

    from app.core.db import session_scope

    async with session_scope() as s:
        await s.execute(
            _t("UPDATE files SET owner_user_id = CAST(:u AS uuid) WHERE id = :f"),
            {"u": owner_user_id, "f": file_id},
        )


async def _patch_doc_inject_file_block(slug: str, file_id: str) -> None:
    """Append a `{type:'file', fileId}` block into the first section of `slug`.

    Bypasses the PUT /documents endpoint (which would require running a full
    schema validate) and writes content_json directly. The download authz
    only does a `jsonb_path_exists` walk so it just needs the block shape.
    """
    from sqlalchemy import text as _t

    from app.core.db import session_scope

    async with session_scope() as s:
        row = (await s.execute(
            _t("SELECT content_json FROM documents WHERE slug = :s"),
            {"s": slug},
        )).first()
        assert row is not None, f"seed doc {slug} missing"
        import json as _j_in

        body = row[0]
        # asyncpg usually decodes jsonb to dict, but normalize defensively.
        if isinstance(body, str):
            body = _j_in.loads(body)
        sections = body.get("sections") or []
        assert sections, "seed doc has no sections"
        first = sections[0]
        first.setdefault("blocks", []).append({
            "type": "file",
            "id": "01ABCDEFGHJKMNPQRSTV" + file_id[-6:],
            "fileId": file_id,
            "name": "test.pdf",
        })
        import json as _j

        await s.execute(
            _t(
                "UPDATE documents SET content_json = CAST(:b AS jsonb) "
                "WHERE slug = :s"
            ),
            {"b": _j.dumps(body, ensure_ascii=False), "s": slug},
        )


async def _restore_seed_doc(slug: str) -> None:
    """Reload the sample JSON for `slug` so other tests aren't polluted."""
    import json as _j
    from pathlib import Path

    from sqlalchemy import text as _t

    from app.core.db import session_scope

    samples = Path("/workspace/packages/shared/samples")
    if not samples.exists():
        samples = Path(__file__).resolve().parents[3] / "packages" / "shared" / "samples"
    fp = samples / "02-onboarding-guide.json"
    if not fp.exists():
        return
    body = _j.loads(fp.read_text(encoding="utf-8"))
    async with session_scope() as s:
        await s.execute(
            _t(
                "UPDATE documents SET content_json = CAST(:b AS jsonb) "
                "WHERE slug = :s"
            ),
            {"b": _j.dumps(body, ensure_ascii=False), "s": slug},
        )


async def _upload_test_file(ac: AsyncClient, *, filename: str = "authz.pdf") -> str:
    """presign + PUT + finalize → returns file_id."""
    raw = b"%PDF-1.4 authz fixture\n%%EOF\n"
    r1 = await ac.post(
        "/api/v1/files/presign-put",
        json={"filename": filename, "mime": "application/pdf", "size": len(raw)},
    )
    assert r1.status_code == 200, r1.text
    d1 = r1.json()["data"]
    file_id = d1["file_id"]
    bucket = get_settings().minio_bucket_files
    minio_adapter.internal_client().put_object(
        Bucket=bucket, Key=d1["key"], Body=raw, ContentType="application/pdf",
    )
    r2 = await ac.post(
        "/api/v1/files/finalize",
        json={
            "file_id": file_id,
            "filename": filename,
            "mime": "application/pdf",
            "size": len(raw),
        },
    )
    assert r2.status_code == 200, r2.text
    return file_id


@pytest.mark.asyncio
async def test_download_allowed_when_doc_references_file_for_non_owner() -> None:
    """비-소유자라도 어떤 non-archived 문서가 file_id 를 참조하면 302."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        file_id = await _upload_test_file(ac, filename="docref.pdf")

        # 1) admin 이외의 owner 로 갈아끼움 → 다운로드 시 dev-admin requester
        #    는 owner 가 아니다.
        other_owner = await _ensure_dummy_owner_user_id()
        await _reassign_file_owner(file_id, other_owner)

        # 2) onboarding-guide 문서에 file 블록을 박아넣는다.
        await _patch_doc_inject_file_block("onboarding-guide", file_id)

        try:
            r = await ac.get(
                f"/api/v1/files/{file_id}/download",
                follow_redirects=False,
            )
            assert r.status_code == 302, r.text
            assert r.headers["location"].startswith("http")
        finally:
            await _restore_seed_doc("onboarding-guide")
            _cleanup_file(file_id, "docref.pdf")


@pytest.mark.asyncio
async def test_download_denied_when_no_doc_references_file_for_non_owner() -> None:
    """비-소유자 + 어떤 문서도 참조하지 않음 → 403."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        file_id = await _upload_test_file(ac, filename="orphan.pdf")
        other_owner = await _ensure_dummy_owner_user_id()
        await _reassign_file_owner(file_id, other_owner)

        try:
            r = await ac.get(
                f"/api/v1/files/{file_id}/download",
                follow_redirects=False,
            )
            assert r.status_code == 403, r.text
            assert r.json()["error"]["code"] in (
                "FORBIDDEN",
                "ACCESS_DENIED",
            )
        finally:
            _cleanup_file(file_id, "orphan.pdf")
