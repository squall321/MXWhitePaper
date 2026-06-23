"""Image upload pipeline (Sprint 5 + Sprint 6 ULID 보강).

2-phase 업로드:
  1) /init   — sha256 dedup + presigned PUT URL 발급 → images_pending 행 기록
  2) /finalize — 스테이징 객체 fetch → EXIF strip → WebP 3종(thumb/view/orig)
                 + 영구 키로 이동 → images 행 INSERT (ULID 발급)

Sprint 6:
  - images.ulid (Crockford 26-char) 컬럼을 finalize 시 발급/저장.
  - finalize/init 응답의 image_id 는 ULID. uuid 는 image_uuid 로 함께 노출.
  - GET /images/<id> 는 UUID/ULID 둘 다 허용.

이미지 처리는 동기 inline (Pillow). FastAPI 엔드포인트에서
`run_in_threadpool` 으로 호출하면 블로킹을 피한다.
"""
from __future__ import annotations

import hashlib
import io
import ipaddress
import json
import re
import socket
import urllib.request
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlparse

import ulid
from PIL import Image, ImageStat
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import NotFound, ValidationFailed
from app.repos import document_repo
from app.storage import minio_adapter

# ── 상수 ─────────────────────────────────────────────────────────────
_SHA256_RE = re.compile(r"^[a-f0-9]{64}$")
_FILENAME_MAX = 200
_PRESIGN_TTL_SECONDS = 600
_PENDING_TTL_SECONDS = 3600  # 1h. 600s presign + finalize 여유.

THUMB_MAX_WIDTH = 320
VIEW_MAX_WIDTH = 1024
WEBP_QUALITY = 85

# from-url fetch: 다운로드 청크 / 리다이렉트 추적 / 타임아웃
_FETCH_CHUNK = 1024 * 1024
_FETCH_MAX_REDIRECTS = 3
_FETCH_TIMEOUT = 30.0

# Crockford ULID (DocumentJSON Ulid) / UUID 정규식
_ULID_RE = re.compile(r"^[0-9A-HJKMNP-TV-Z]{26}$")
_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)


# ── 헬퍼 ─────────────────────────────────────────────────────────────
def _validate_init_body(body: dict[str, Any]) -> tuple[str, str, str, int]:
    """init 요청 검증. (filename, mime_type, sha256, size) 반환."""
    if not isinstance(body, dict):
        raise ValidationFailed("body must be an object")
    filename = body.get("filename")
    mime_type = body.get("mime_type")
    sha256 = body.get("sha256")
    size = body.get("size")
    if not isinstance(filename, str) or not filename or len(filename) > _FILENAME_MAX:
        raise ValidationFailed(
            f"filename must be a non-empty string ≤ {_FILENAME_MAX} chars",
            details={"got": filename},
        )
    if not isinstance(mime_type, str) or not mime_type.startswith("image/"):
        raise ValidationFailed(
            "mime_type must start with 'image/'",
            details={"got": mime_type},
        )
    if not isinstance(sha256, str) or not _SHA256_RE.match(sha256):
        raise ValidationFailed(
            "sha256 must be 64-char lowercase hex",
            details={"got": sha256},
        )
    if not isinstance(size, int) or size <= 0:
        raise ValidationFailed("size must be a positive integer", details={"got": size})
    max_bytes = get_settings().image_max_bytes
    if size > max_bytes:
        raise ValidationFailed(
            f"size exceeds IMAGE_MAX_BYTES ({max_bytes})",
            details={"got": size, "limit": max_bytes},
        )
    return filename, mime_type, sha256, size


def _staging_key(upload_id: str, filename: str) -> str:
    return f"uploads/{upload_id}/{filename}"


def _permanent_prefix(sha256: str) -> str:
    return f"{sha256[0:2]}/{sha256[2:4]}/{sha256}"


def _public_urls_for_sha(sha256: str) -> dict[str, str]:
    bucket = get_settings().minio_bucket_images
    pref = _permanent_prefix(sha256)
    return {
        "thumb": minio_adapter.public_url(bucket, f"{pref}/thumb.webp"),
        "view": minio_adapter.public_url(bucket, f"{pref}/view.webp"),
        "orig": minio_adapter.public_url(bucket, f"{pref}/orig.webp"),
    }


# ── DB helpers ───────────────────────────────────────────────────────
def _row_to_image(row: Any) -> dict[str, Any]:
    keys = row[8]
    if isinstance(keys, str):
        keys = json.loads(keys)
    return {
        "id": str(row[0]),
        "ulid": row[1],
        "sha256": row[2],
        "mime_type": row[3],
        "size_bytes": int(row[4]),
        "width": int(row[5]) if row[5] is not None else None,
        "height": int(row[6]) if row[6] is not None else None,
        "dominant_color": row[7],
        "storage_keys": keys,
    }


async def _find_image_by_sha256(s: AsyncSession, sha256: str) -> dict[str, Any] | None:
    row = (await s.execute(
        text("""
            SELECT id, ulid, sha256, mime_type, size_bytes, width, height,
                   dominant_color, storage_keys
            FROM images WHERE sha256 = :sha
        """),
        {"sha": sha256},
    )).first()
    return _row_to_image(row) if row else None


async def _find_image_by_identifier(
    s: AsyncSession, identifier: str
) -> dict[str, Any] | None:
    """UUID 또는 ULID 둘 다 허용해서 이미지 1건 조회."""
    if _UUID_RE.match(identifier):
        row = (await s.execute(
            text("""
                SELECT id, ulid, sha256, mime_type, size_bytes, width, height,
                       dominant_color, storage_keys
                FROM images WHERE id = CAST(:id AS uuid)
            """),
            {"id": identifier},
        )).first()
    elif _ULID_RE.match(identifier):
        row = (await s.execute(
            text("""
                SELECT id, ulid, sha256, mime_type, size_bytes, width, height,
                       dominant_color, storage_keys
                FROM images WHERE ulid = :u
            """),
            {"u": identifier},
        )).first()
    else:
        return None
    return _row_to_image(row) if row else None


async def _insert_pending(
    s: AsyncSession,
    *,
    upload_id: str,
    uploader_id: str,
    filename: str,
    mime_type: str,
    sha256: str,
    size_bytes: int,
    expires_at: datetime,
) -> None:
    await s.execute(
        text("""
            INSERT INTO images_pending
              (upload_id, uploader_id, filename, mime_type, sha256, size_bytes, expires_at)
            VALUES (:uid, :uploader, :fn, :mt, :sha, :sz, :exp)
        """),
        {
            "uid": upload_id, "uploader": uploader_id, "fn": filename,
            "mt": mime_type, "sha": sha256, "sz": size_bytes, "exp": expires_at,
        },
    )


async def _find_pending(s: AsyncSession, upload_id: str) -> dict[str, Any] | None:
    row = (await s.execute(
        text("""
            SELECT upload_id, uploader_id, filename, mime_type, sha256, size_bytes
            FROM images_pending WHERE upload_id = :uid
        """),
        {"uid": upload_id},
    )).first()
    if not row:
        return None
    return {
        "upload_id": row[0], "uploader_id": str(row[1]),
        "filename": row[2], "mime_type": row[3],
        "sha256": row[4], "size_bytes": int(row[5]),
    }


async def _delete_pending(s: AsyncSession, upload_id: str) -> None:
    await s.execute(
        text("DELETE FROM images_pending WHERE upload_id = :uid"),
        {"uid": upload_id},
    )


async def _purge_expired_pending(s: AsyncSession) -> None:
    await s.execute(text("DELETE FROM images_pending WHERE expires_at < NOW()"))


async def _insert_image(
    s: AsyncSession,
    *,
    new_ulid: str,
    sha256: str,
    original_name: str,
    mime_type: str,
    size_bytes: int,
    width: int,
    height: int,
    dominant_color: str,
    storage_keys: dict[str, str],
    uploaded_by: str,
) -> str:
    row = (await s.execute(
        text("""
            INSERT INTO images
              (ulid, sha256, original_name, mime_type, size_bytes, width, height,
               dominant_color, storage_keys, uploaded_by)
            VALUES (:ulid, :sha, :name, :mt, :sz, :w, :h, :dc, CAST(:keys AS JSONB), :u)
            RETURNING id
        """),
        {
            "ulid": new_ulid, "sha": sha256, "name": original_name, "mt": mime_type,
            "sz": size_bytes, "w": width, "h": height, "dc": dominant_color,
            "keys": json.dumps(storage_keys), "u": uploaded_by,
        },
    )).first()
    assert row is not None
    return str(row[0])


def _new_ulid_str() -> str:
    """Crockford 26-char ULID 문자열 발급."""
    # ulid-py: ulid.new() returns a ULID with .str / __str__
    return str(ulid.new())


# ── init ─────────────────────────────────────────────────────────────
async def init_upload(
    s: AsyncSession,
    *,
    body: dict[str, Any],
    actor_id: str,
) -> dict[str, Any]:
    filename, mime_type, sha256, size = _validate_init_body(body)

    # 만료된 pending 정리 (best-effort)
    await _purge_expired_pending(s)

    existing = await _find_image_by_sha256(s, sha256)
    if existing:
        await s.commit()
        return {
            "deduped": True,
            "image_id": existing["ulid"],
            "image_uuid": existing["id"],
            "urls": _public_urls_for_sha(existing["sha256"]),
        }

    upload_id = _new_ulid_str()
    bucket = get_settings().minio_bucket_images
    key = _staging_key(upload_id, filename)

    # presigned PUT URL 발급 (클라이언트 용 → public_client)
    url = minio_adapter.public_client().generate_presigned_url(
        "put_object",
        Params={"Bucket": bucket, "Key": key, "ContentType": mime_type},
        ExpiresIn=_PRESIGN_TTL_SECONDS,
    )

    expires_at = datetime.now(UTC) + timedelta(seconds=_PENDING_TTL_SECONDS)
    await _insert_pending(
        s,
        upload_id=upload_id,
        uploader_id=actor_id,
        filename=filename,
        mime_type=mime_type,
        sha256=sha256,
        size_bytes=size,
        expires_at=expires_at,
    )
    await document_repo.insert_audit(
        s, user_id=actor_id, action="image.upload.init",
        target=f"image:{sha256[:12]}", payload={"upload_id": upload_id, "size": size},
    )
    await s.commit()
    return {
        "deduped": False,
        "uploadId": upload_id,
        "method": "PUT",
        "url": url,
        "headers": {"Content-Type": mime_type},
        "expiresIn": _PRESIGN_TTL_SECONDS,
    }


# ── finalize: 동기 이미지 처리 (run_in_threadpool 대상) ──────────────
def _process_image_bytes(raw: bytes) -> dict[str, Any]:
    """Pillow 처리: EXIF strip + 3개 사이즈 + dominant color.

    Returns dict with keys: thumb_bytes, view_bytes, orig_bytes,
    width, height, dominant_color.
    """
    src = Image.open(io.BytesIO(raw))
    src.load()
    # EXIF 제거를 위해 새 이미지로 복사 (메타데이터 미보존)
    base = Image.new(src.mode if src.mode in ("RGB", "RGBA", "L") else "RGB", src.size)
    base.paste(src.convert(base.mode))
    if base.mode != "RGB":
        # WebP 인코딩에 alpha 가 필요한 경우는 RGBA, 아니면 RGB.
        if base.mode != "RGBA":
            base = base.convert("RGB")
    width, height = base.size

    def _resize(img: Image.Image, max_w: int) -> Image.Image:
        if img.width <= max_w:
            return img
        ratio = max_w / img.width
        new_h = max(1, round(img.height * ratio))
        return img.resize((max_w, new_h), Image.LANCZOS)  # type: ignore[attr-defined]  # PIL stub lacks legacy LANCZOS alias

    def _to_webp(img: Image.Image) -> bytes:
        buf = io.BytesIO()
        save_img = img if img.mode in ("RGB", "RGBA") else img.convert("RGB")
        save_img.save(buf, format="WEBP", quality=WEBP_QUALITY, method=4)
        return buf.getvalue()

    thumb_bytes = _to_webp(_resize(base, THUMB_MAX_WIDTH))
    view_bytes = _to_webp(_resize(base, VIEW_MAX_WIDTH))
    orig_bytes = _to_webp(base)

    # Dominant color: 50×50 thumbnail → per-channel mean RGB.
    # ImageStat.Stat runs in C — faster than Python iteration over getdata()
    # and side-steps the Pillow 14 deprecation of Image.Image.getdata().
    color_img = base.convert("RGB").copy()
    color_img.thumbnail((50, 50), Image.LANCZOS)  # type: ignore[attr-defined]  # PIL stub lacks legacy LANCZOS alias
    mean = ImageStat.Stat(color_img).mean  # [r, g, b] floats in [0, 255]
    r, g, b = int(mean[0]), int(mean[1]), int(mean[2])
    dominant_color = f"#{r:02x}{g:02x}{b:02x}"

    return {
        "thumb_bytes": thumb_bytes,
        "view_bytes": view_bytes,
        "orig_bytes": orig_bytes,
        "width": width,
        "height": height,
        "dominant_color": dominant_color,
    }


def _fetch_staged_object(bucket: str, prefix: str) -> tuple[str, bytes]:
    """uploads/<uploadId>/ 아래의 단일 객체를 fetch. (key, bytes) 반환."""
    cli = minio_adapter.internal_client()
    listing = cli.list_objects_v2(Bucket=bucket, Prefix=prefix)
    contents = listing.get("Contents") or []
    if not contents:
        raise NotFound("staged upload object not found")
    # 가장 최근 업로드 1건만 사용 (정상 흐름은 1건)
    obj = max(contents, key=lambda c: c.get("LastModified") or 0)
    key = obj["Key"]
    res = cli.get_object(Bucket=bucket, Key=key)
    body = res["Body"].read()
    return key, body


def _put_permanent_objects(
    bucket: str,
    sha256: str,
    *,
    thumb_bytes: bytes,
    view_bytes: bytes,
    orig_bytes: bytes,
) -> dict[str, str]:
    cli = minio_adapter.internal_client()
    pref = _permanent_prefix(sha256)
    keys = {
        "thumb": f"{pref}/thumb.webp",
        "view": f"{pref}/view.webp",
        "orig": f"{pref}/orig.webp",
    }
    bodies = {
        "thumb": thumb_bytes,
        "view": view_bytes,
        "orig": orig_bytes,
    }
    for name, key in keys.items():
        cli.put_object(
            Bucket=bucket,
            Key=key,
            Body=bodies[name],
            ContentType="image/webp",
        )
    return keys


def _delete_staged(bucket: str, key: str) -> None:
    try:
        minio_adapter.internal_client().delete_object(Bucket=bucket, Key=key)
    except Exception:
        # best-effort
        pass


# ── finalize ─────────────────────────────────────────────────────────
async def finalize_upload(
    s: AsyncSession,
    *,
    upload_id: str,
    actor_id: str,
    process_func: Any | None = None,
) -> dict[str, Any]:
    """init 으로 발급한 upload_id 의 객체를 영구 키로 이동 + images 행 등록.

    process_func: 테스트가 무거운 Pillow 처리를 우회할 때 주입 가능. 실제
    호출에서는 None → run_in_threadpool 로 _process_image_bytes 실행.
    """
    if not isinstance(upload_id, str) or not upload_id:
        raise ValidationFailed("uploadId required")

    pending = await _find_pending(s, upload_id)
    if not pending:
        raise NotFound(f"upload not found: {upload_id}")

    bucket = get_settings().minio_bucket_images
    staging_prefix = f"uploads/{upload_id}/"
    staged_key, raw = _fetch_staged_object(bucket, staging_prefix)

    # 사이즈/sha256 검증
    if len(raw) != pending["size_bytes"]:
        raise ValidationFailed(
            "uploaded size does not match init size",
            details={"expected": pending["size_bytes"], "got": len(raw)},
        )
    actual_sha = hashlib.sha256(raw).hexdigest()
    if actual_sha != pending["sha256"]:
        raise ValidationFailed(
            "sha256 mismatch",
            details={"expected": pending["sha256"], "got": actual_sha},
        )

    sha256 = pending["sha256"]

    # 기존 이미지 dedup (init 시점에는 없었지만 race 가능)
    existing = await _find_image_by_sha256(s, sha256)
    if existing:
        _delete_staged(bucket, staged_key)
        await _delete_pending(s, upload_id)
        await s.commit()
        return {
            "image_id": existing["ulid"],
            "image_uuid": existing["id"],
            "urls": _public_urls_for_sha(sha256),
            "dominant_color": existing["dominant_color"],
            "width": existing["width"],
            "height": existing["height"],
            "deduped": True,
        }

    # Pillow 처리
    if process_func is None:
        from fastapi.concurrency import run_in_threadpool
        processed = await run_in_threadpool(_process_image_bytes, raw)
    else:
        processed = process_func(raw)

    # 영구 객체 업로드
    storage_keys = _put_permanent_objects(
        bucket, sha256,
        thumb_bytes=processed["thumb_bytes"],
        view_bytes=processed["view_bytes"],
        orig_bytes=processed["orig_bytes"],
    )

    new_ulid = _new_ulid_str()
    image_uuid = await _insert_image(
        s,
        new_ulid=new_ulid,
        sha256=sha256,
        original_name=pending["filename"],
        mime_type=pending["mime_type"],
        size_bytes=pending["size_bytes"],
        width=processed["width"],
        height=processed["height"],
        dominant_color=processed["dominant_color"],
        storage_keys=storage_keys,
        uploaded_by=actor_id,
    )

    await _delete_pending(s, upload_id)
    await document_repo.insert_audit(
        s, user_id=actor_id, action="image.upload.finalize",
        target=f"image:{sha256[:12]}",
        payload={"image_id": new_ulid, "image_uuid": image_uuid, "upload_id": upload_id},
    )
    await s.commit()

    # staging 정리 (commit 후, 실패해도 무시)
    _delete_staged(bucket, staged_key)

    return {
        "image_id": new_ulid,
        "image_uuid": image_uuid,
        "urls": _public_urls_for_sha(sha256),
        "dominant_color": processed["dominant_color"],
        "width": processed["width"],
        "height": processed["height"],
        "deduped": False,
    }


# ── from-url: SSRF-가드 원격 fetch → 직접 저장 파이프라인 ─────────────
def _host_is_public(host: str) -> bool:
    """host(도메인 또는 IP 리터럴) 를 resolve 해 **모든** 결과 IP 가 공인인지.

    DNS rebinding 대비로 resolve 한 IP 로 차단 판정한다. 사설(10/8, 172.16/12,
    192.168/16), loopback(127/8, ::1), link-local(169.254/16, fe80::/10),
    예약/멀티캐스트/미지정 (fc00::/7 은 is_private 에 포함) 을 차단.
    """
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        return False
    if not infos:
        return False
    for info in infos:
        ip_str = info[4][0]
        try:
            ip = ipaddress.ip_address(ip_str)
        except ValueError:
            return False
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_reserved
            or ip.is_multicast
            or ip.is_unspecified
        ):
            return False
    return True


def _validate_public_url(url: str) -> None:
    """스킴(http/https) + 호스트 공인 여부 검증. 위반 시 ValidationFailed."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise ValidationFailed(
            "url must use http or https scheme", details={"got": parsed.scheme}
        )
    host = parsed.hostname
    if not host:
        raise ValidationFailed("url has no host", details={"got": url})
    if not _host_is_public(host):
        raise ValidationFailed(
            "url resolves to a private or reserved address", details={"host": host}
        )


def _fetch_remote_bytes(url: str, *, max_bytes: int) -> tuple[bytes, str]:
    """SSRF 검증 + 리다이렉트 직접 추적(매 홉 검증) + 크기 상한.

    (raw_bytes, content_type) 반환. 위반/초과 시 ValidationFailed.
    리다이렉트를 urllib 자동 추적에 맡기지 않고 직접 따라가며 매 홉 재검증.
    """
    current = url
    for _ in range(_FETCH_MAX_REDIRECTS + 1):
        _validate_public_url(current)
        req = urllib.request.Request(current, method="GET")

        class _NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *_a: Any, **_k: Any) -> None:
                return None

        opener = urllib.request.build_opener(_NoRedirect)
        try:
            resp = opener.open(req, timeout=_FETCH_TIMEOUT)
        except HTTPError as e:
            if e.code in (301, 302, 303, 307, 308):
                loc = e.headers.get("Location")
                if not loc:
                    raise ValidationFailed("redirect without Location") from e
                current = urljoin(current, loc)
                continue
            raise ValidationFailed(f"download failed: HTTP {e.code}") from e
        except URLError as e:
            raise ValidationFailed(f"download error: {e.reason}") from e

        with resp:
            content_type = (resp.headers.get("Content-Type") or "").split(";")[0].strip()
            clen = resp.headers.get("Content-Length")
            if clen and clen.isdigit() and int(clen) > max_bytes:
                raise ValidationFailed(
                    f"remote file exceeds max bytes ({max_bytes})",
                    details={"content_length": int(clen), "limit": max_bytes},
                )
            buf = bytearray()
            while True:
                chunk = resp.read(_FETCH_CHUNK)
                if not chunk:
                    break
                buf.extend(chunk)
                if len(buf) > max_bytes:
                    raise ValidationFailed(
                        f"remote file exceeds max bytes ({max_bytes})",
                        details={"limit": max_bytes},
                    )
            if not buf:
                raise ValidationFailed("remote file is empty")
            return bytes(buf), content_type
    raise ValidationFailed("too many redirects")


def _verify_is_image(raw: bytes, content_type: str) -> str:
    """Content-Type 또는 Pillow 로 이미지 검증 → mime_type 반환.

    Content-Type 이 image/* 면 그대로, 아니면 Pillow 로 열어 포맷을 확인한다.
    """
    if content_type.startswith("image/"):
        return content_type
    try:
        img = Image.open(io.BytesIO(raw))
        img.verify()
    except Exception as e:
        raise ValidationFailed(
            "remote resource is not a recognized image",
            details={"content_type": content_type},
        ) from e
    fmt = (img.format or "").lower()
    return f"image/{fmt}" if fmt else "application/octet-stream"


async def fetch_and_store_image_from_url(
    s: AsyncSession,
    *,
    url: str,
    actor_id: str,
    max_bytes: int | None = None,
    filename: str | None = None,
) -> dict[str, Any]:
    """원격 URL 의 이미지를 받아 sha256 dedup → WebP 3종 저장 → images INSERT.

    init/finalize 2-phase 를 우회하고 docx preprocess 와 동일한 직접경로
    (_find_image_by_sha256 → _process_image_bytes → _put_permanent_objects →
    _insert_image) 를 탄다. {image_id, image_uuid, urls, deduped} 반환.
    """
    if not isinstance(url, str) or not url:
        raise ValidationFailed("url required")
    limit = max_bytes if max_bytes is not None else get_settings().image_from_url_max_bytes

    from fastapi.concurrency import run_in_threadpool

    raw, content_type = await run_in_threadpool(_fetch_remote_bytes, url, max_bytes=limit)
    mime_type = _verify_is_image(raw, content_type)

    sha256 = hashlib.sha256(raw).hexdigest()

    existing = await _find_image_by_sha256(s, sha256)
    if existing:
        return {
            "image_id": existing["ulid"],
            "image_uuid": existing["id"],
            "urls": _public_urls_for_sha(sha256),
            "deduped": True,
        }

    processed = await run_in_threadpool(_process_image_bytes, raw)

    bucket = get_settings().minio_bucket_images
    storage_keys = _put_permanent_objects(
        bucket, sha256,
        thumb_bytes=processed["thumb_bytes"],
        view_bytes=processed["view_bytes"],
        orig_bytes=processed["orig_bytes"],
    )

    original_name = (filename or urlparse(url).path.rsplit("/", 1)[-1] or "download")[:200]
    new_ulid = _new_ulid_str()
    image_uuid = await _insert_image(
        s,
        new_ulid=new_ulid,
        sha256=sha256,
        original_name=original_name,
        mime_type=mime_type,
        size_bytes=len(raw),
        width=processed["width"],
        height=processed["height"],
        dominant_color=processed["dominant_color"],
        storage_keys=storage_keys,
        uploaded_by=actor_id,
    )
    await document_repo.insert_audit(
        s, user_id=actor_id, action="image.upload.from_url",
        target=f"image:{sha256[:12]}",
        payload={"image_id": new_ulid, "image_uuid": image_uuid, "url": url[:500]},
    )
    await s.commit()

    return {
        "image_id": new_ulid,
        "image_uuid": image_uuid,
        "urls": _public_urls_for_sha(sha256),
        "deduped": False,
    }


# ── read ─────────────────────────────────────────────────────────────
async def get_image_or_404(s: AsyncSession, identifier: str) -> dict[str, Any]:
    img = await _find_image_by_identifier(s, identifier)
    if not img:
        raise NotFound(f"image not found: {identifier}")
    return {
        "image_id": img["ulid"],
        "image_uuid": img["id"],
        "urls": _public_urls_for_sha(img["sha256"]),
        "mime_type": img["mime_type"],
        "size_bytes": img["size_bytes"],
        "width": img["width"],
        "height": img["height"],
        "dominant_color": img["dominant_color"],
        "alt": None,
        "caption": None,
    }
