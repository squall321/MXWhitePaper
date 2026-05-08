"""Word (.docx) → DocumentJSON import 라우터.

POST /imports/docx (editor+, rate-limit 5/min/user, max 30 MB)
  - multipart/form-data: file (.docx), slug?, title?
  - 결과: DocumentJSON v1.0 + import_summary 통계 (FE 가 받은 후 별도로
    POST /documents 호출해 영구화).

검증:
  - 확장자 .docx
  - zip magic byte (PK\\x03\\x04)
  - zip 안에 word/document.xml 존재
  - 30 MB 이하

Rate-limit 은 files.py 의 in-process 패턴을 그대로 따른다 (5/min/user).
"""
from __future__ import annotations

import time
from typing import Any

from fastapi import APIRouter, Depends, File, Form, Header, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import require_editor
from app.core.db import get_db
from app.core.errors import APIError, ValidationFailed, envelope
from app.repos import document_repo
from app.services import docx_import, upload_service

router = APIRouter(prefix="/api/v1/imports", tags=["imports"])


# ── 30 MB 사이즈 캡 (스트림 read 시 비교) ────────────────────────────
MAX_DOCX_BYTES = 30 * 1024 * 1024


# ── 5/min/user rate-limit (files.py 패턴) ────────────────────────────
_RATE_WINDOW_SECONDS = 60.0
_RATE_LIMIT_PER_WINDOW = 5
_history: dict[str, list[float]] = {}


def _check_rate_limit(user_id: str) -> bool:
    now = time.monotonic()
    cutoff = now - _RATE_WINDOW_SECONDS
    hist = [t for t in _history.get(user_id, []) if t >= cutoff]
    if len(hist) >= _RATE_LIMIT_PER_WINDOW:
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


def _build_image_uploader(s: AsyncSession, actor_id: str):
    """upload_service 의 helpers 를 inline 호출하는 image_uploader 콜러블 반환.

    업로드는 docx 파싱 도중 동기 흐름 안에서 일어난다. 비-async 콜러블이
    필요하므로 기존 finalize_upload (async) 대신 sha256 dedup → Pillow →
    MinIO put → images row INSERT 를 inline 으로 수행한다. SQLAlchemy
    AsyncSession 은 sync 컨텍스트에서 사용할 수 없으므로, 이 콜러블은
    바이트만 처리해 placeholder image_id 를 반환하고 실제 DB 행 작성은
    별도 await 단계가 필요. 현 구현에선 단순화 — 영속 row 없이
    `_new_ulid_str()` placeholder 를 imageId 로 삽입한다.

    실제 production 통합은 별도 백그라운드 잡으로 처리하는 것이 안전.
    """
    def _uploader(_data: bytes, _filename: str) -> dict[str, Any] | None:
        return {"image_id": upload_service._new_ulid_str()}

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
    while True:
        chunk = await file.read(64 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > MAX_DOCX_BYTES:
            raise ValidationFailed(
                f"file exceeds max size ({MAX_DOCX_BYTES} bytes)",
                details={"limit": MAX_DOCX_BYTES},
            )
        chunks.append(chunk)
    buf = b"".join(chunks)

    if not docx_import.is_docx_zip_magic(buf):
        raise ValidationFailed("file is not a valid zip (.docx must be PK zip)")
    if not docx_import.is_docx_content(buf):
        raise ValidationFailed("zip does not contain word/document.xml")

    final_slug = slug or _derive_slug(file.filename or "imported.docx")
    image_uploader = _build_image_uploader(s, actor)

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
