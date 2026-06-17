"""Import 라우터.

POST /imports/docx (editor+, rate-limit 5/min/user, max 30 MB)
  - multipart/form-data: file (.docx), slug?, title?
  - 결과: DocumentJSON v1.0 + import_summary 통계 (FE 가 받은 후 별도로
    POST /documents 호출해 영구화).

POST /imports/csv (admin-only, max 5 MB, ≤500 rows)
  - multipart/form-data: file (.csv)
  - 행 단위로 DocumentJSON v1.0 을 만들어 즉시 영속화. slug 충돌은 skip.
  - 결과: {created, skipped, errors[]}.

검증:
  - 확장자 .docx
  - zip magic byte (PK\\x03\\x04)
  - zip 안에 word/document.xml 존재
  - 30 MB 이하

Rate-limit 은 files.py 의 in-process 패턴을 그대로 따른다 (5/min/user).
"""
from __future__ import annotations

import csv
import hashlib
import io
import re
import time
import zipfile
from typing import Any

import ulid
from fastapi import APIRouter, Depends, File, Form, Header, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import require_admin, require_editor
from app.core.config import get_settings
from app.core.db import get_db
from app.core.errors import APIError, Conflict, ValidationFailed, envelope
from app.repos import document_repo
from app.services import (
    document_service,
    docx_import,
    pdf_import,
    pptx_import,
    upload_service,
    xlsx_import,
)
from app.services.docx_roundtrip import roundtrip_docx

router = APIRouter(prefix="/api/v1/imports", tags=["imports"])


def _docx_max_bytes() -> int:
    return get_settings().docx_import_max_bytes


def _pptx_max_bytes() -> int:
    return get_settings().pptx_import_max_bytes


def _csv_max_bytes() -> int:
    return get_settings().csv_import_max_bytes


def _csv_max_rows() -> int:
    return get_settings().csv_import_max_rows


# Rate-limit window is fixed at 60s (per-minute); the per-user count
# comes from settings so deployments can loosen / tighten without code.
_RATE_WINDOW_SECONDS = 60.0
_history: dict[str, list[float]] = {}


def _check_rate_limit(user_id: str) -> bool:
    now = time.monotonic()
    cutoff = now - _RATE_WINDOW_SECONDS
    limit = get_settings().import_rate_limit_per_minute
    hist = [t for t in _history.get(user_id, []) if t >= cutoff]
    if len(hist) >= limit:
        _history[user_id] = hist
        return False
    hist.append(now)
    _history[user_id] = hist
    return True


def _reset_rate_limit_for_tests() -> None:
    _history.clear()


class _RateLimited(APIError):
    code = "RATE_LIMITED"
    http_status = 429
    message = "rate limit exceeded — try again in a moment"


async def _resolve_actor(
    s: AsyncSession, x_mxwp_user: str | None, user: dict | None
) -> str:
    if x_mxwp_user:
        uid = await document_repo.fetch_user_by_email(s, x_mxwp_user)
        if uid:
            return uid
    if user and user.get("id"):
        return str(user["id"])
    return await document_repo.fetch_admin_owner_id(s)


def _derive_slug(filename: str) -> str:
    """파일명 → URL-safe slug. 한글 음절도 살린다."""
    import re

    base = filename.rsplit(".", 1)[0]
    base = base.lower().strip()
    # 허용: a-z 0-9 가-힣 -. 그 외는 - 로 치환
    base = re.sub(r"[^a-z0-9가-힣\-]+", "-", base)
    base = re.sub(r"-+", "-", base).strip("-")
    if not base:
        base = "imported"
    return base[:100]


_MEDIA_EXT_TO_MIME = {
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "gif": "image/gif",
    "webp": "image/webp",
    "bmp": "image/bmp",
    "tif": "image/tiff",
    "tiff": "image/tiff",
    "svg": "image/svg+xml",
}


async def _preprocess_zip_images(
    s: AsyncSession,
    buf: bytes,
    actor_id: str,
    *,
    media_prefix: str,
) -> tuple[dict[str, str], list[str]]:
    """Extract every `<media_prefix>/...` image from a docx/pptx zip and run
    the full upload pipeline (sha256 dedup → Pillow → MinIO put → DB INSERT).

    Returns ``(sha→ulid map, skipped_svg_filenames)``. The converter's sync
    image_uploader hits the map by hashing the bytes it receives. We commit
    per-image so a corrupted file doesn't roll back successful uploads.

    SVGs (and other unknown mimes) are skipped because Pillow can't raster
    them and the render pipeline only ships WebP variants. The caller surfaces
    the skipped filenames as a warning in the import summary so users notice
    the missing figures — silent drops bit us before.

    Without this pre-pass the importer used to mint placeholder ULIDs that
    weren't backed by any `images` row, so `useImage` 404'd in the FE and
    every imported figure rendered as a broken icon.
    """
    out: dict[str, str] = {}
    skipped_svgs: list[str] = []
    try:
        zf = zipfile.ZipFile(io.BytesIO(buf))
    except zipfile.BadZipFile:
        return out, skipped_svgs

    bucket = get_settings().minio_bucket_images
    for name in zf.namelist():
        if not name.startswith(media_prefix):
            continue
        try:
            raw = zf.read(name)
        except KeyError:
            continue
        if not raw:
            continue
        sha = hashlib.sha256(raw).hexdigest()
        if sha in out:
            continue
        # Cross-document dedup.
        try:
            existing = await upload_service._find_image_by_sha256(s, sha)
        except Exception:
            existing = None
        if existing:
            out[sha] = existing["ulid"]
            continue

        ext = name.rsplit(".", 1)[-1].lower() if "." in name else "png"
        mime = _MEDIA_EXT_TO_MIME.get(ext)
        if mime is None or mime == "image/svg+xml":
            # Skip SVG / unknown — Pillow can't render SVG and our render
            # pipeline only ships WebP variants. Track SVGs explicitly so
            # the caller can warn the user (silent drops bit us before).
            if mime == "image/svg+xml":
                skipped_svgs.append(name.rsplit("/", 1)[-1])
            continue

        try:
            processed = await run_in_threadpool(
                upload_service._process_image_bytes, raw
            )
        except Exception:
            continue
        try:
            storage_keys = upload_service._put_permanent_objects(
                bucket,
                sha,
                thumb_bytes=processed["thumb_bytes"],
                view_bytes=processed["view_bytes"],
                orig_bytes=processed["orig_bytes"],
            )
        except Exception:
            continue

        new_ulid = upload_service._new_ulid_str()
        try:
            await upload_service._insert_image(
                s,
                new_ulid=new_ulid,
                sha256=sha,
                original_name=name.rsplit("/", 1)[-1][:200],
                mime_type=mime,
                size_bytes=len(raw),
                width=processed["width"],
                height=processed["height"],
                dominant_color=processed["dominant_color"],
                storage_keys=storage_keys,
                uploaded_by=actor_id,
            )
            await s.commit()
        except Exception:
            await s.rollback()
            continue
        out[sha] = new_ulid
    return out, skipped_svgs


def _build_image_uploader(sha_to_ulid: dict[str, str]):
    """Return a sync callable docx_import / pptx_import can call per-image.

    Looks the image up by sha256 against the pre-populated map from
    `_preprocess_zip_images`. Returns None when the bytes aren't recognised
    — the converter then drops the broken figure (or emits a warning)
    instead of writing a dangling ULID.
    """
    def _uploader(data: bytes, _filename: str) -> dict[str, Any] | None:
        if not data:
            return None
        sha = hashlib.sha256(data).hexdigest()
        ulid_val = sha_to_ulid.get(sha)
        if ulid_val:
            return {"image_id": ulid_val}
        return None

    return _uploader


@router.post("/docx")
async def import_docx(
    file: UploadFile = File(...),
    slug: str | None = Form(default=None),
    title: str | None = Form(default=None),
    x_mxwp_user: str | None = Header(default=None, alias="X-MXWP-User"),
    s: AsyncSession = Depends(get_db),
    user: dict = Depends(require_editor),
) -> dict[str, Any]:
    actor = await _resolve_actor(s, x_mxwp_user, user)
    if not _check_rate_limit(actor):
        raise _RateLimited()

    fname = (file.filename or "").lower()
    if not fname.endswith(".docx"):
        raise ValidationFailed(
            "filename must end with .docx",
            details={"got": file.filename},
        )

    # Stream-read with size cap
    chunks: list[bytes] = []
    total = 0
    docx_limit = _docx_max_bytes()
    while True:
        chunk = await file.read(64 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > docx_limit:
            raise ValidationFailed(
                f"file exceeds max size ({docx_limit} bytes)",
                details={"limit": docx_limit},
            )
        chunks.append(chunk)
    buf = b"".join(chunks)

    if not docx_import.is_docx_zip_magic(buf):
        raise ValidationFailed("file is not a valid zip (.docx must be PK zip)")
    if not docx_import.is_docx_content(buf):
        # DRM wrapper 추정: outer zip 안에 진짜 docx 가 들어있는지 한 번 unwrap.
        # 사내 DRM 솔루션이 .docx 를 다시 ZIP 으로 감싸는 경우 호환.
        unwrapped = docx_import.try_unwrap_drm_docx(buf)
        if unwrapped is None:
            raise ValidationFailed("zip does not contain word/document.xml")
        buf = unwrapped

    final_slug = slug or _derive_slug(file.filename or "imported.docx")
    sha_to_ulid, skipped_svgs = await _preprocess_zip_images(
        s, buf, actor, media_prefix="word/media/"
    )
    image_uploader = _build_image_uploader(sha_to_ulid)

    try:
        result = docx_import.docx_to_document(
            buf,
            slug=final_slug,
            title=title or "",
            owner_user_id=actor,
            image_uploader=image_uploader,
        )
    except ValueError as e:
        raise ValidationFailed(str(e)) from e

    document = result["document"]
    summary = result["summary"]
    if skipped_svgs:
        summary.warnings.append(
            f"SVG 이미지 {len(skipped_svgs)}장 처리 안 됨 "
            f"(Pillow 미지원): {', '.join(skipped_svgs[:5])}"
            + (" …" if len(skipped_svgs) > 5 else "")
        )

    # 감사 로그 (best-effort)
    try:
        await document_repo.insert_audit(
            s, user_id=actor, action="docx.import",
            target=f"slug:{final_slug}",
            payload={
                "title": document.get("title"),
                "paragraphs": summary.paragraphs,
                "tables": summary.tables,
                "images": summary.images,
                "equations": summary.equations,
            },
        )
        await s.commit()
    except Exception:
        await s.rollback()

    summary_dict: dict[str, Any] = {
        "paragraphs": summary.paragraphs,
        "headings": summary.headings,
        "tables": summary.tables,
        "images": summary.images,
        "equations": summary.equations,
        "lists": summary.lists,
        "code_blocks": summary.code_blocks,
        "footnotes": summary.footnotes,
        "warnings": list(summary.warnings),
    }

    return envelope(
        data={"document": document, "summary": summary_dict},
        meta={"slug": final_slug},
    )


# ── docx round-trip ──────────────────────────────────────────────────


def _bool_form(value: str | None, default: bool) -> bool:
    """Coerce a multipart form string ('1'/'true'/'on'/...) to a bool.

    Multipart form fields arrive as strings — pydantic's bool coercion
    is FastAPI-internal and inconsistent for `Form()`, so we do it here
    once and reuse across roundtrip params.
    """
    if value is None:
        return default
    return value.strip().lower() in ("1", "true", "yes", "y", "on")


def _safe_header_value(s: str, max_bytes: int = 7000) -> str:
    """Truncate a string to fit a response header.

    Cuts on UTF-8 codepoint boundary so multibyte chars (Korean/CJK) never
    get split, and strips CR/LF to prevent header injection.
    """
    cleaned = s.replace("\r", " ").replace("\n", " ")
    encoded = cleaned.encode("utf-8")
    if len(encoded) <= max_bytes:
        return cleaned
    return encoded[:max_bytes].decode("utf-8", errors="ignore")


@router.post(
    "/docx/roundtrip",
    summary="Word → DocumentJSON → Word 라운드트립 (문서 본문 영속 없음)",
    description=(
        "업로드한 .docx 를 사내 표준 양식으로 변환만 해서 다시 .docx 로 돌려준다. "
        "문서 본문/이미지는 어디에도 저장하지 않으며 (MinIO/Meilisearch 미접근), "
        "DB 에는 `audit_log` 한 줄만 best-effort 로 기록한다. "
        "응답 헤더에 변환 통계가 담긴다. "
        "원본의 수동 목차(`목차`/`차례`/`TOC1` 등)는 옵션에 따라 검출/검증/제거된다 — "
        "Exporter 가 자동 TOC 를 재생성하므로 중복을 막기 위함."
    ),
)
async def roundtrip_docx_endpoint(
    file: UploadFile = File(..., description="원본 .docx 파일"),
    strip_toc: str | None = Form(default=None),
    verify_toc: str | None = Form(default=None),
    aggressive_toc: str | None = Form(default=None),
    x_mxwp_user: str | None = Header(default=None, alias="X-MXWP-User"),
    s: AsyncSession = Depends(get_db),
    user: dict = Depends(require_editor),
) -> Response:
    actor = await _resolve_actor(s, x_mxwp_user, user)
    if not _check_rate_limit(actor):
        raise _RateLimited()

    fname = (file.filename or "").lower()
    if not fname.endswith(".docx"):
        raise ValidationFailed(
            "filename must end with .docx",
            details={"got": file.filename},
        )

    chunks: list[bytes] = []
    total = 0
    docx_limit = _docx_max_bytes()
    while True:
        chunk = await file.read(64 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > docx_limit:
            raise ValidationFailed(
                f"file exceeds max size ({docx_limit} bytes)",
                details={"limit": docx_limit},
            )
        chunks.append(chunk)
    buf = b"".join(chunks)

    if not docx_import.is_docx_zip_magic(buf):
        raise ValidationFailed("file is not a valid zip (.docx must be PK zip)")
    if not docx_import.is_docx_content(buf):
        # DRM unwrap 시도 (사내 솔루션의 ZIP-in-ZIP 패턴).
        unwrapped = docx_import.try_unwrap_drm_docx(buf)
        if unwrapped is None:
            raise ValidationFailed("zip does not contain word/document.xml")
        buf = unwrapped

    strip_toc_b = _bool_form(strip_toc, default=True)
    verify_toc_b = _bool_form(verify_toc, default=True)
    aggressive_toc_b = _bool_form(aggressive_toc, default=False)
    opts = {
        "strip_toc": strip_toc_b,
        "verify_toc": verify_toc_b,
        "aggressive_toc": aggressive_toc_b,
    }

    # The roundtrip itself is CPU-bound (XML parse + Pillow-free docx
    # render). Run it in the thread pool so the event loop stays free
    # for other requests on the same worker.
    try:
        out_bytes, summary = await run_in_threadpool(
            roundtrip_docx,
            buf,
            strip_toc=strip_toc_b,
            verify_toc=verify_toc_b,
            aggressive_toc=aggressive_toc_b,
        )
    except ValueError as e:
        raise ValidationFailed(str(e)) from e

    # best-effort audit (no DB rollback if this fails)
    try:
        await document_repo.insert_audit(
            s, user_id=actor, action="docx.roundtrip",
            target=f"file:{file.filename}",
            payload={
                "input_bytes": total,
                "output_bytes": len(out_bytes),
                "sections": summary.get("sections", 0),
                "images": summary.get("images", 0),
                "tables": summary.get("tables", 0),
                "toc_found": summary.get("toc_found", False),
                "toc_missing": len(summary.get("toc_missing") or []),
                **opts,
            },
        )
        await s.commit()
    except Exception:
        await s.rollback()

    # Build response. Headers carry counters; full summary goes in a
    # `X-MXWP-Roundtrip-Summary` JSON header so callers can opt-in to
    # the full picture without a second round-trip.
    base_name = (file.filename or "document").rsplit(".", 1)[0]
    headers = {
        "Content-Disposition": (
            f'attachment; filename="{base_name}.normalized.docx"'
        ),
        "X-MXWP-Roundtrip-Sections": str(summary.get("sections", 0)),
        "X-MXWP-Roundtrip-Images": str(summary.get("images", 0)),
        "X-MXWP-Roundtrip-Tables": str(summary.get("tables", 0)),
        "X-MXWP-Roundtrip-Toc-Found": "true" if summary.get("toc_found") else "false",
        "X-MXWP-Roundtrip-Toc-Entries": str(len(summary.get("toc_entries") or [])),
        "X-MXWP-Roundtrip-Toc-Missing": str(len(summary.get("toc_missing") or [])),
        "X-MXWP-Roundtrip-Toc-Extra": str(len(summary.get("toc_extra") or [])),
        "X-MXWP-Roundtrip-Toc-Method": summary.get("toc_method") or "",
        "X-MXWP-Roundtrip-Toc-Heuristic": "weak" if summary.get("toc_weak") else "strong",
        "X-MXWP-Roundtrip-Warnings": str(len(summary.get("warnings") or [])),
    }
    # Stash the full JSON summary in a custom header. Browsers cap
    # individual header size around 8 KB so we keep this concise (no
    # blocks/payload — just counters + lists of titles).
    import json as _json
    headers["X-MXWP-Roundtrip-Summary"] = _safe_header_value(
        _json.dumps(summary, ensure_ascii=False, separators=(",", ":")),
    )
    return Response(
        content=out_bytes,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers=headers,
    )


# ── PowerPoint (.pptx) import ────────────────────────────────────────


@router.post("/pptx")
async def import_pptx(
    file: UploadFile = File(...),
    slug: str | None = Form(default=None),
    title: str | None = Form(default=None),
    x_mxwp_user: str | None = Header(default=None, alias="X-MXWP-User"),
    s: AsyncSession = Depends(get_db),
    user: dict = Depends(require_editor),
) -> dict[str, Any]:
    """Import a PowerPoint deck and convert it to DocumentJSON.

    Each slide becomes one section. Slide layout names are best-effort
    mapped to our `Section.layout` enum (`title-only` / `two-col` /
    `image-left` / `stack`). Speaker notes are preserved as paragraphs
    with `meta.note: speaker:N`.

    Same rate-limit (5/min/user) and `actor` resolution as docx import.
    Returns `{document, summary}` so the FE can preview before committing
    via `POST /documents`.
    """
    actor = await _resolve_actor(s, x_mxwp_user, user)
    if not _check_rate_limit(actor):
        raise _RateLimited()

    fname = (file.filename or "").lower()
    if not fname.endswith(".pptx"):
        raise ValidationFailed(
            "filename must end with .pptx",
            details={"got": file.filename},
        )

    chunks: list[bytes] = []
    total = 0
    pptx_limit = _pptx_max_bytes()
    while True:
        chunk = await file.read(64 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > pptx_limit:
            raise ValidationFailed(
                f"file exceeds max size ({pptx_limit} bytes)",
                details={"limit": pptx_limit},
            )
        chunks.append(chunk)
    buf = b"".join(chunks)

    if not pptx_import.is_pptx_zip_magic(buf):
        raise ValidationFailed("file is not a valid zip (.pptx must be PK zip)")
    if not pptx_import.is_pptx_content(buf):
        # DRM unwrap 시도 (사내 솔루션의 ZIP-in-ZIP 패턴).
        unwrapped = pptx_import.try_unwrap_drm_pptx(buf)
        if unwrapped is None:
            raise ValidationFailed("zip does not contain ppt/presentation.xml")
        buf = unwrapped

    final_slug = slug or _derive_slug(file.filename or "imported.pptx")
    sha_to_ulid, skipped_svgs = await _preprocess_zip_images(
        s, buf, actor, media_prefix="ppt/media/"
    )
    image_uploader = _build_image_uploader(sha_to_ulid)

    try:
        result = pptx_import.pptx_to_document(
            buf,
            slug=final_slug,
            title=title or "",
            owner_user_id=actor,
            image_uploader=image_uploader,
        )
    except ValueError as e:
        raise ValidationFailed(str(e)) from e

    document = result["document"]
    summary = result["summary"]
    if skipped_svgs:
        summary.warnings.append(
            f"SVG 이미지 {len(skipped_svgs)}장 처리 안 됨 "
            f"(Pillow 미지원): {', '.join(skipped_svgs[:5])}"
            + (" …" if len(skipped_svgs) > 5 else "")
        )

    try:
        await document_repo.insert_audit(
            s, user_id=actor, action="pptx.import",
            target=f"slug:{final_slug}",
            payload={
                "title": document.get("title"),
                "slides": summary.slides,
                "sections": summary.sections,
                "tables": summary.tables,
                "images": summary.images,
                "speaker_notes": summary.speaker_notes,
            },
        )
        await s.commit()
    except Exception:
        await s.rollback()

    summary_dict: dict[str, Any] = {
        "slides": summary.slides,
        "sections": summary.sections,
        "paragraphs": summary.paragraphs,
        "tables": summary.tables,
        "images": summary.images,
        "speaker_notes": summary.speaker_notes,
        "warnings": list(summary.warnings),
    }

    return envelope(
        data={"document": document, "summary": summary_dict},
        meta={"slug": final_slug},
    )


# ── Bulk CSV import ──────────────────────────────────────────────────
_CSV_COLUMNS = (
    "slug", "title", "summary", "division", "team", "group", "part",
    "tags", "owners", "confidentiality", "body",
)
_REQUIRED_CSV_COLUMNS = ("title",)
_CONFIDENTIALITY_VALUES = {"public", "internal", "restricted"}
_SLUG_RE = re.compile(r"[^a-z0-9가-힣\-]+")


def _slugify_title(title: str) -> str:
    base = (title or "").lower().strip()
    base = _SLUG_RE.sub("-", base)
    base = re.sub(r"-+", "-", base).strip("-")
    if not base:
        base = "imported"
    return base[:100]


def _split_tags(raw: str) -> list[str]:
    if not raw:
        return []
    parts = re.split(r"[|,]", raw)
    return [p.strip() for p in parts if p.strip()]


def _split_owners(raw: str) -> list[str]:
    if not raw:
        return []
    return [p.strip() for p in raw.split("|") if p.strip()]


def _body_to_blocks(body: str) -> list[dict[str, Any]]:
    """`\\n\\n` 로 분리된 문단들을 paragraph block 배열로 변환."""
    if not body:
        return []
    paragraphs = [p.strip() for p in body.split("\n\n")]
    return [
        {"type": "paragraph", "id": str(ulid.new()), "text": p}
        for p in paragraphs
        if p
    ]


def _row_to_documentjson(
    row: dict[str, str], *, owner_email: str
) -> dict[str, Any]:
    """CSV 한 행 → DocumentJSON v1.0 dict.

    title 누락 또는 confidentiality 값이 잘못되면 ValueError 를 던진다 (호출자 행
    번호와 함께 errors 에 기록).
    """
    title = (row.get("title") or "").strip()
    if not title:
        raise ValueError("title is required")
    slug = (row.get("slug") or "").strip().lower() or _slugify_title(title)
    settings = get_settings()
    division = (
        (row.get("division") or "").strip()
        or settings.import_default_division
    )
    confidentiality = (
        (row.get("confidentiality") or "").strip().lower()
        or settings.import_default_confidentiality
    )
    if confidentiality not in _CONFIDENTIALITY_VALUES:
        raise ValueError(
            f"confidentiality must be one of {sorted(_CONFIDENTIALITY_VALUES)}"
        )

    metadata: dict[str, Any] = {
        "division": division,
        "owners": _split_owners(row.get("owners") or "") or [owner_email],
        "tags": _split_tags(row.get("tags") or ""),
        "confidentiality": confidentiality,
    }
    for key in ("team", "group", "part"):
        v = (row.get(key) or "").strip()
        if v:
            metadata[key] = v

    blocks = _body_to_blocks(row.get("body") or "")
    section: dict[str, Any] = {
        "id": str(ulid.new()),
        "level": 1,
        "title": title[:200],
        "blocks": blocks,
        "subsections": [],
    }

    doc: dict[str, Any] = {
        "schema_version": "1.0",
        "id": str(ulid.new()),
        "slug": slug,
        "title": title[:200],
        "metadata": metadata,
        "sections": [section],
    }
    summary = (row.get("summary") or "").strip()
    if summary:
        doc["summary"] = summary[:500]
    return doc


def _normalize_csv_headers(raw: list[str]) -> list[str]:
    return [(h or "").strip().lower() for h in raw]


@router.post(
    "/csv",
    summary="CSV 일괄 문서 가져오기 (admin only)",
    description=(
        "CSV 한 행이 한 문서. 헤더 컬럼 (case-insensitive): "
        "`slug,title,summary,division,team,group,part,tags,owners,"
        "confidentiality,body`. tags 는 ',' 또는 '|' 로 구분, owners 는 '|'. "
        "body 의 `\\n\\n` 단위가 단락. 최대 5 MB / 500 행. "
        "이미 존재하는 slug 는 skipped 로 집계."
    ),
)
async def import_csv(
    file: UploadFile = File(...),
    x_mxwp_user: str | None = Header(default=None, alias="X-MXWP-User"),
    s: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
) -> dict[str, Any]:
    fname = (file.filename or "").lower()
    if not fname.endswith(".csv"):
        raise ValidationFailed(
            "filename must end with .csv",
            details={"got": file.filename},
        )

    chunks: list[bytes] = []
    total = 0
    csv_limit = _csv_max_bytes()
    while True:
        chunk = await file.read(64 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > csv_limit:
            raise ValidationFailed(
                f"file exceeds max size ({csv_limit} bytes)",
                details={"limit": csv_limit},
            )
        chunks.append(chunk)
    raw = b"".join(chunks)

    try:
        text_data = raw.decode("utf-8-sig")
    except UnicodeDecodeError as e:
        raise ValidationFailed(
            "csv must be UTF-8 encoded",
            details={"reason": str(e)},
        ) from e

    reader = csv.reader(io.StringIO(text_data))
    try:
        header = next(reader)
    except StopIteration as e:
        raise ValidationFailed("csv is empty (no header row)") from e

    headers = _normalize_csv_headers(header)
    missing = [c for c in _REQUIRED_CSV_COLUMNS if c not in headers]
    if missing:
        raise ValidationFailed(
            "csv is missing required column(s)",
            details={"missing": missing, "expected": list(_CSV_COLUMNS)},
        )

    # Resolve the default owner email for rows that don't carry an
    # `owners` column. require_admin guarantees `user` exists; we fall
    # through to the x_mxwp_user override when explicitly set. Refuse
    # the import when neither resolves — the previous "admin" string
    # literal landed inside `metadata.owners` as a non-email and broke
    # downstream tooling that assumes owner ids are real users.
    default_owner_email = (x_mxwp_user or "").strip() or (user.get("email") or "").strip()
    if not default_owner_email:
        raise ValidationFailed(
            "no owner email could be resolved from the request",
            details={"reason": "set X-MXWP-User header or sign in with an email"},
        )

    # Pre-validate ALL rows before creating any.
    parsed_rows: list[tuple[int, dict[str, Any]]] = []
    parse_errors: list[dict[str, Any]] = []
    row_limit = _csv_max_rows()
    for row_idx, raw_row in enumerate(reader, start=2):  # row 1 = header
        if len(parsed_rows) + len(parse_errors) >= row_limit:
            raise ValidationFailed(
                f"csv exceeds max rows ({row_limit})",
                details={"limit": row_limit},
            )
        # pad/truncate to header width
        cells = list(raw_row) + [""] * (len(headers) - len(raw_row))
        cells = cells[: len(headers)]
        if not any(c.strip() for c in cells):
            continue  # blank line
        row_dict = dict(zip(headers, cells, strict=False))
        try:
            doc = _row_to_documentjson(
                row_dict,
                owner_email=default_owner_email,
            )
        except ValueError as e:
            parse_errors.append({
                "row": row_idx,
                "slug": (row_dict.get("slug") or "").strip() or None,
                "message": str(e),
            })
            continue
        parsed_rows.append((row_idx, doc))

    # Fail-fast: any parse error → no inserts.
    if parse_errors:
        raise ValidationFailed(
            "csv has parse errors — no rows imported",
            details={"errors": parse_errors},
        )

    actor = await _resolve_actor(s, x_mxwp_user, user)

    created = 0
    skipped = 0
    errors: list[dict[str, Any]] = []
    for row_idx, doc in parsed_rows:
        slug = doc["slug"]
        existing = await document_repo.find_by_slug(s, slug)
        if existing:
            skipped += 1
            continue
        try:
            await document_service.create_document(
                s, payload=doc, owner_id=actor
            )
            created += 1
        except Conflict:
            # Race between find_by_slug and INSERT — count as skipped.
            skipped += 1
        except (ValidationFailed, APIError) as e:
            errors.append({
                "row": row_idx,
                "slug": slug,
                "message": getattr(e, "message", str(e)),
            })

    return envelope(
        data={"created": created, "skipped": skipped, "errors": errors},
        meta={"total_rows": len(parsed_rows)},
    )


# ── xlsx import ──────────────────────────────────────────────────────


def _xlsx_max_bytes() -> int:
    return get_settings().xlsx_import_max_bytes


async def _read_capped(file: UploadFile, limit: int) -> bytes:
    """Stream-read an upload with a hard size cap (docx 패턴 공용화)."""
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(64 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > limit:
            raise ValidationFailed(
                f"file exceeds max size ({limit} bytes)",
                details={"limit": limit},
            )
        chunks.append(chunk)
    return b"".join(chunks)


@router.post("/xlsx")
async def import_xlsx(
    file: UploadFile = File(...),
    slug: str | None = Form(default=None),
    title: str | None = Form(default=None),
    x_mxwp_user: str | None = Header(default=None, alias="X-MXWP-User"),
    s: AsyncSession = Depends(get_db),
    user: dict = Depends(require_editor),
) -> dict[str, Any]:
    actor = await _resolve_actor(s, x_mxwp_user, user)
    if not _check_rate_limit(actor):
        raise _RateLimited()

    fname = (file.filename or "").lower()
    if not fname.endswith(".xlsx"):
        raise ValidationFailed(
            "filename must end with .xlsx", details={"got": file.filename}
        )

    buf = await _read_capped(file, _xlsx_max_bytes())
    if not xlsx_import.is_xlsx_zip_magic(buf):
        raise ValidationFailed("file is not a valid zip (.xlsx must be PK zip)")
    if not xlsx_import.is_xlsx_content(buf):
        raise ValidationFailed("zip does not contain xl/workbook.xml")

    final_slug = slug or _derive_slug(file.filename or "imported.xlsx")
    try:
        result = await run_in_threadpool(
            xlsx_import.xlsx_to_document,
            buf,
            slug=final_slug,
            title=title or "",
            owner_user_id=actor,
        )
    except ValueError as e:
        raise ValidationFailed(str(e)) from e

    document = result["document"]
    summary = result["summary"]

    try:
        await document_repo.insert_audit(
            s, user_id=actor, action="xlsx.import",
            target=f"slug:{final_slug}",
            payload={
                "title": document.get("title"),
                "tables": summary.tables,
                "sections": len(document.get("sections", [])),
            },
        )
        await s.commit()
    except Exception:
        await s.rollback()

    summary_dict: dict[str, Any] = {
        "tables": summary.tables,
        "sections": len(document.get("sections", [])),
        "warnings": list(summary.warnings),
    }
    return envelope(
        data={"document": document, "summary": summary_dict},
        meta={"slug": final_slug},
    )


# ── pdf import ───────────────────────────────────────────────────────


def _pdf_max_bytes() -> int:
    return get_settings().pdf_import_max_bytes


@router.post("/pdf")
async def import_pdf(
    file: UploadFile = File(...),
    slug: str | None = Form(default=None),
    title: str | None = Form(default=None),
    x_mxwp_user: str | None = Header(default=None, alias="X-MXWP-User"),
    s: AsyncSession = Depends(get_db),
    user: dict = Depends(require_editor),
) -> dict[str, Any]:
    actor = await _resolve_actor(s, x_mxwp_user, user)
    if not _check_rate_limit(actor):
        raise _RateLimited()

    fname = (file.filename or "").lower()
    if not fname.endswith(".pdf"):
        raise ValidationFailed(
            "filename must end with .pdf", details={"got": file.filename}
        )

    buf = await _read_capped(file, _pdf_max_bytes())
    if not pdf_import.is_pdf_magic(buf):
        raise ValidationFailed("file is not a valid PDF (missing %PDF- signature)")

    final_slug = slug or _derive_slug(file.filename or "imported.pdf")
    try:
        result = await run_in_threadpool(
            pdf_import.pdf_to_document,
            buf,
            slug=final_slug,
            title=title or "",
            owner_user_id=actor,
        )
    except ValueError as e:
        raise ValidationFailed(str(e)) from e

    document = result["document"]
    summary = result["summary"]

    try:
        await document_repo.insert_audit(
            s, user_id=actor, action="pdf.import",
            target=f"slug:{final_slug}",
            payload={
                "title": document.get("title"),
                "paragraphs": summary.paragraphs,
                "headings": summary.headings,
                "tables": summary.tables,
                "images": summary.images,
            },
        )
        await s.commit()
    except Exception:
        await s.rollback()

    summary_dict: dict[str, Any] = {
        "paragraphs": summary.paragraphs,
        "headings": summary.headings,
        "tables": summary.tables,
        "images": summary.images,
        "sections": len(document.get("sections", [])),
        "warnings": list(summary.warnings),
    }
    return envelope(
        data={"document": document, "summary": summary_dict},
        meta={"slug": final_slug},
    )
