"""Generic file upload pipeline (FileBlock 첨부용).

이미지 파이프라인 (`upload_service.py`) 의 `init/finalize` 패턴을 그대로
따르되:
  - sha256 dedup 없음 — 동일 바이트라도 새 file_id 발급 (이미지 대비 단순화).
  - EXIF/WebP 트랜스코드 없음 — 원본 그대로 보관.
  - storage_key 는 `<file_id>/<filename>` (이미지 staging 과 키 충돌 없음, 별도 버킷).

Endpoint:
  presign_put       — body 검증 → 5분 presigned PUT URL 발급 (DB 미기록)
  finalize          — HEAD 검증 → files row INSERT → 1일 GET URL 반환
  issue_download_url— files row 조회 후 1일 presigned GET URL 발급
"""
from __future__ import annotations

import re
from collections.abc import Callable
from typing import Any

import ulid
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import (
    APIError,
    Forbidden,
    NotFound,
    ValidationFailed,
)
from app.repos import document_repo
from app.storage import minio_adapter

# ── 상수 ─────────────────────────────────────────────────────────────
_FILENAME_MAX = 255
_PRESIGN_PUT_TTL = 300       # 5 minutes
_PRESIGN_GET_TTL = 86_400    # 24 hours
_ULID_RE = re.compile(r"^[0-9A-HJKMNP-TV-Z]{26}$")

# ── MIME 정책 ────────────────────────────────────────────────────────
# 명시적으로 거부할 위험 MIME (실행파일/스크립트). application/x- 으로 시작
# 하는 그 외 타입은 _ALLOWED_APPLICATION_PREFIXES 화이트리스트로 통과 여부
# 판정한다.
_BLOCKED_MIMES: frozenset[str] = frozenset({
    "application/x-msdownload",        # .exe / .dll
    "application/x-msi",                # .msi
    "application/x-sh",                 # shell script
    "application/x-bash",
    "application/javascript",
    "text/javascript",
    "application/x-javascript",
    "application/x-executable",
    "application/x-mach-binary",
    "application/x-elf",
    "application/x-dosexec",
    "application/vnd.microsoft.portable-executable",
    "application/x-msdos-program",
    "application/x-php",
    "application/x-perl",
    "application/x-python-code",
})

# `application/` 하위 중 허용할 prefix. 화이트리스트 외 application/x-* 는 거부.
_ALLOWED_APPLICATION_PREFIXES: tuple[str, ...] = (
    "application/pdf",
    "application/zip",
    "application/x-zip-compressed",
    "application/x-tar",
    "application/x-gzip",
    "application/gzip",
    "application/json",
    "application/xml",
    "application/vnd.openxmlformats-",  # .docx/.xlsx/.pptx
    "application/vnd.ms-",              # legacy office
    "application/vnd.oasis.",
    "application/octet-stream",         # 일반 첨부 (브라우저가 모르는 타입)
)


class _RateLimited(APIError):
    code = "RATE_LIMITED"
    http_status = 429
    message = "Too many uploads — try again shortly"


def _validate_mime(mime: str) -> None:
    if not isinstance(mime, str) or not mime:
        raise ValidationFailed("mime required")
    mime_lc = mime.lower().strip()

    if mime_lc.startswith("image/"):
        # 이미지는 별도 파이프라인 사용 안내.
        raise ValidationFailed(
            "image/* 는 /uploads/image/init 을 사용하세요 (EXIF strip + WebP 트랜스코드).",
            details={"mime": mime, "use_endpoint": "/api/v1/uploads/image/init"},
        )

    if mime_lc in _BLOCKED_MIMES:
        raise ValidationFailed(
            f"mime '{mime}' 는 보안 정책상 업로드할 수 없습니다.",
            details={"mime": mime},
        )

    # 명시 허용군: text/*, audio/*, video/*, application/<allowed prefix>.
    if mime_lc.startswith(("text/", "audio/", "video/")):
        return
    if any(mime_lc.startswith(p) for p in _ALLOWED_APPLICATION_PREFIXES):
        return
    if mime_lc.startswith("application/x-"):
        # 화이트리스트에 안 걸렸으면 거부. (executables 가 대부분 application/x-*)
        raise ValidationFailed(
            f"mime '{mime}' 는 허용되지 않는 application/x-* 타입입니다.",
            details={"mime": mime},
        )

    # 기타 — 일단 통과 (multipart/* 등 흔치 않은 case).
    return


def _validate_filename(filename: str) -> str:
    if not isinstance(filename, str) or not filename:
        raise ValidationFailed("filename required")
    if len(filename) > _FILENAME_MAX:
        raise ValidationFailed(
            f"filename must be ≤ {_FILENAME_MAX} chars",
            details={"got_length": len(filename)},
        )
    # path traversal 차단 — slash/backslash 금지.
    if "/" in filename or "\\" in filename:
        raise ValidationFailed("filename must not contain path separators")
    return filename


def _validate_size(size: Any) -> int:
    if not isinstance(size, int) or isinstance(size, bool) or size <= 0:
        raise ValidationFailed("size must be a positive integer", details={"got": size})
    max_bytes = get_settings().file_max_bytes
    if size > max_bytes:
        raise ValidationFailed(
            f"size exceeds FILE_MAX_BYTES ({max_bytes})",
            details={"got": size, "limit": max_bytes},
        )
    return size


def _new_ulid_str() -> str:
    return str(ulid.new())


def _storage_key(file_id: str, filename: str) -> str:
    return f"{file_id}/{filename}"


def enforce_rate_limit(check: Callable[[str], bool], user_id: str) -> None:
    """라우터에서 in-process limiter 결과를 도메인 에러로 변환."""
    if not check(user_id):
        raise _RateLimited(
            f"presign-put limit exceeded ({30}/min)",
            details={"window_seconds": 60, "limit": 30},
        )


# ── presign-put ──────────────────────────────────────────────────────
def presign_put(*, body: dict[str, Any], actor_id: str) -> dict[str, Any]:
    """body: {filename, mime, size}.

    DB 에 사전 row 를 만들지 않는다 (이미지의 `images_pending` 패턴 대비
    단순화). finalize 단계에서 HEAD 로 객체 존재를 검증 → INSERT.
    """
    if not isinstance(body, dict):
        raise ValidationFailed("body must be an object")
    filename = _validate_filename(body.get("filename") or "")
    mime = body.get("mime") or ""
    _validate_mime(mime)
    size = _validate_size(body.get("size"))

    file_id = _new_ulid_str()
    bucket = get_settings().minio_bucket_files
    key = _storage_key(file_id, filename)

    url = minio_adapter.public_client().generate_presigned_url(
        "put_object",
        Params={"Bucket": bucket, "Key": key, "ContentType": mime},
        ExpiresIn=_PRESIGN_PUT_TTL,
    )
    # actor_id is logged via the upstream router's audit on finalize; this
    # endpoint is intentionally cheap (no DB write).
    _ = actor_id, size  # 입력 검증만 하고 finalize 에서 다시 확인.

    return {
        "file_id": file_id,
        "key": key,
        "presigned_url": url,
        "method": "PUT",
        "headers": {"Content-Type": mime},
        "expires_in": _PRESIGN_PUT_TTL,
    }


# ── finalize ─────────────────────────────────────────────────────────
def _head_object(bucket: str, key: str) -> dict[str, Any]:
    cli = minio_adapter.internal_client()
    try:
        return cli.head_object(Bucket=bucket, Key=key)
    except Exception as e:
        raise NotFound(
            f"uploaded object not found at {key}",
            details={"key": key, "error": str(e)[:200]},
        ) from e


def _presigned_get_url(bucket: str, key: str, *, ttl: int = _PRESIGN_GET_TTL) -> str:
    return minio_adapter.public_client().generate_presigned_url(
        "get_object",
        Params={"Bucket": bucket, "Key": key},
        ExpiresIn=ttl,
    )


async def finalize(
    s: AsyncSession, *, body: dict[str, Any], actor_id: str
) -> dict[str, Any]:
    if not isinstance(body, dict):
        raise ValidationFailed("body must be an object")
    file_id = body.get("file_id")
    filename = body.get("filename")
    mime = body.get("mime")
    size = body.get("size")

    if not isinstance(file_id, str) or not _ULID_RE.match(file_id):
        raise ValidationFailed("file_id must be a 26-char ULID", details={"got": file_id})
    filename = _validate_filename(filename or "")
    _validate_mime(mime or "")
    expected_size = _validate_size(size)

    bucket = get_settings().minio_bucket_files
    key = _storage_key(file_id, filename)

    head = _head_object(bucket, key)
    actual_size = int(head.get("ContentLength") or 0)
    actual_mime = head.get("ContentType")
    if actual_size != expected_size:
        raise ValidationFailed(
            "uploaded size does not match presign size",
            details={"expected": expected_size, "got": actual_size},
        )
    if not actual_mime:
        raise ValidationFailed(
            "uploaded object missing content-type",
            details={"key": key},
        )

    # INSERT files row.
    await s.execute(
        text("""
            INSERT INTO files
              (id, owner_user_id, filename, mime, size_bytes, storage_key)
            VALUES (:id, CAST(:u AS uuid), :fn, :mt, :sz, :sk)
        """),
        {
            "id": file_id,
            "u": actor_id,
            "fn": filename,
            "mt": mime,
            "sz": expected_size,
            "sk": key,
        },
    )
    await document_repo.insert_audit(
        s,
        user_id=actor_id,
        action="file.upload.finalize",
        target=f"file:{file_id}",
        payload={"filename": filename, "size": expected_size, "mime": mime},
    )
    await s.commit()

    download_url = _presigned_get_url(bucket, key)
    return {
        "file_id": file_id,
        "filename": filename,
        "size": expected_size,
        "mime": mime,
        "download_url": download_url,
    }


# ── download ─────────────────────────────────────────────────────────
async def _file_is_referenced_by_any_doc(
    s: AsyncSession, *, file_id: str
) -> bool:
    """Walk every non-archived document's content_json to find a
    `{type: "file", fileId: <file_id>}` block anywhere in the tree.

    Uses Postgres `jsonb_path_exists` with recursive descent (`**`) so the
    query catches blocks nested under columns / tabs / accordions without
    hand-coded traversal. Indexed on `documents.status` (existing partial
    index from 0001_init); the jsonb walk is per-row and we cap with LIMIT 1
    so the query short-circuits at the first match.

    Slower than a dedicated `file_document_links` join table but avoids the
    migration + back-fill, and the editor's typical doc set is small enough
    that this is a non-issue in practice.
    """
    # asyncpg can't infer the type of a bare bind, so we must cast :fid to
    # text BEFORE handing it to jsonb_build_object — otherwise the driver
    # raises `IndeterminateDatatypeError: could not determine data type of
    # parameter $1`. The cast is a no-op cost-wise and keeps the SQL
    # portable.
    row = (await s.execute(
        text("""
            SELECT 1
            FROM documents d
            WHERE d.status != 'archived'
              AND jsonb_path_exists(
                d.content_json,
                '$.** ? (@.type == "file" && @.fileId == $fid)'::jsonpath,
                jsonb_build_object('fid', CAST(:fid AS text))
              )
            LIMIT 1
        """),
        {"fid": file_id},
    )).first()
    return row is not None


async def issue_download_url(
    s: AsyncSession,
    *,
    file_id: str,
    requester_user_id: str | None = None,
) -> str:
    """Resolve `file_id` → presigned 1-day GET URL with per-doc authorization.

    Authz policy:
      - The file's owner (`files.owner_user_id == requester_user_id`) always
        bypasses the document check (so an editor can re-download their own
        upload even before pasting it into a doc).
      - Otherwise, allow only when at least one non-archived document
        references this `file_id` via a `type: "file"` block. The reader+
        gate on the route already ensures the requester can read every
        non-archived document, so a reference is sufficient evidence of
        access. Returning 403 otherwise keeps file URLs from leaking even
        to authenticated readers when the file isn't actually attached
        anywhere.
      - Unknown file → 404 (existing behaviour).
    """
    if not isinstance(file_id, str) or not _ULID_RE.match(file_id):
        raise NotFound(f"file not found: {file_id}")
    row = (await s.execute(
        text("""
            SELECT id, storage_key, CAST(owner_user_id AS text)
            FROM files WHERE id = :id
        """),
        {"id": file_id},
    )).first()
    if not row:
        raise NotFound(f"file not found: {file_id}")

    is_owner = (
        requester_user_id is not None
        and str(row[2]) == str(requester_user_id)
    )
    if not is_owner:
        if not await _file_is_referenced_by_any_doc(s, file_id=file_id):
            raise Forbidden(
                "this file is not attached to any document you can read",
                details={"file_id": file_id},
            )

    bucket = get_settings().minio_bucket_files
    return _presigned_get_url(bucket, row[1])


# ── exports for tests ────────────────────────────────────────────────
__all__ = [
    "_ALLOWED_APPLICATION_PREFIXES",
    "_BLOCKED_MIMES",
    "enforce_rate_limit",
    "finalize",
    "issue_download_url",
    "presign_put",
]


# Re-export the rate-limit reset hook so tests can clear in-process state.
def _ensure_router_rate_limit_reset_hook() -> None:
    """No-op placeholder: tests import the router's `_reset_rate_limit_for_tests`."""
    return None


