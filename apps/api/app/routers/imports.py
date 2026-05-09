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
import io
import re
import time
from typing import Any

import ulid
from fastapi import APIRouter, Depends, File, Form, Header, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import require_admin, require_editor
from app.core.db import get_db
from app.core.errors import APIError, Conflict, ValidationFailed, envelope
from app.repos import document_repo
from app.services import docx_import, document_service, upload_service

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


# ── Bulk CSV import ──────────────────────────────────────────────────
MAX_CSV_BYTES = 5 * 1024 * 1024
MAX_CSV_ROWS = 500
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
    division = (row.get("division") or "").strip() or "기타"
    confidentiality = (row.get("confidentiality") or "internal").strip().lower()
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
    while True:
        chunk = await file.read(64 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > MAX_CSV_BYTES:
            raise ValidationFailed(
                f"file exceeds max size ({MAX_CSV_BYTES} bytes)",
                details={"limit": MAX_CSV_BYTES},
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

    # Pre-validate ALL rows before creating any.
    parsed_rows: list[tuple[int, dict[str, Any]]] = []
    parse_errors: list[dict[str, Any]] = []
    for row_idx, raw_row in enumerate(reader, start=2):  # row 1 = header
        if len(parsed_rows) + len(parse_errors) >= MAX_CSV_ROWS:
            raise ValidationFailed(
                f"csv exceeds max rows ({MAX_CSV_ROWS})",
                details={"limit": MAX_CSV_ROWS},
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
                owner_email=(x_mxwp_user or user.get("email") or "admin"),
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
