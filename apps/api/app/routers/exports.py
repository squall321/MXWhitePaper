"""문서 내보내기 라우터 — Markdown / PDF / PPTX.

기존 `/api/v1/documents/{slug}/export.html` (HTML) 와 별도로,
git 커밋 가능한 Markdown / 인쇄/공유용 PDF / 발표용 PowerPoint 출력을 제공한다.

PDF 는 WeasyPrint 가 환경에 설치되어 있을 때만 활성화된다.
설치되지 않은 경우 `/exports/pdf` 호출은 501 을 돌려준다 — FE 는 이때
`/docs/:slug?print=1` 같은 print-friendly 라우트로 폴백해 `window.print()` 를 띄운다.

PPTX 는 python-pptx 만 사용하므로 시스템 라이브러리 의존이 없어 항상 가용.
"""
from __future__ import annotations

from typing import Any
from urllib.parse import quote

from fastapi import APIRouter, Depends
from fastapi.responses import Response as FastAPIResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import require_reader
from app.core.db import get_db
from app.core.errors import APIError
from app.services import document_service
from app.services.docx_export import DocxOptions, render_docx
from app.services.markdown_export import render_markdown
from app.services.pptx_export import PptxOptions, render_pptx

router = APIRouter(prefix="/api/v1/exports", tags=["exports"])


class _PdfExportUnavailable(APIError):
    code = "PDF_EXPORT_UNAVAILABLE"
    http_status = 501
    message = (
        "WeasyPrint 가 설치되어 있지 않아 BE PDF 변환을 사용할 수 없습니다. "
        "FE 의 인쇄 미리보기(window.print) 경로를 사용하세요."
    )


# ── WeasyPrint 가용성 (모듈 로드 시 1회 평가) ─────────────────────────


def _detect_weasyprint() -> Any:
    try:
        import weasyprint  # type: ignore[import-untyped]

        return weasyprint
    except Exception:
        return None


_WEASYPRINT = _detect_weasyprint()


# ── Markdown export ─────────────────────────────────────────────────


@router.post(
    "/markdown",
    summary="문서를 Markdown 으로 내보내기",
    description=(
        "DocumentJSON 본문을 GitHub-flavoured Markdown 으로 변환해 다운로드.\n"
        "차트/Gantt/Flow 는 mermaid 코드블록으로, 그 외 동적 블록은 텍스트 요약으로 보존된다."
    ),
)
async def export_markdown(
    payload: dict[str, Any],
    s: AsyncSession = Depends(get_db),
    _user: dict = Depends(require_reader),
) -> FastAPIResponse:
    slug = (payload or {}).get("slug")
    if not slug or not isinstance(slug, str):
        from app.core.errors import ValidationFailed

        raise ValidationFailed(
            "slug 가 필요합니다.",
            details={"required": ["slug"]},
        )
    include_metadata = bool(payload.get("include_metadata", True))

    doc = await document_service.get_document_or_404(s, slug)
    content = doc["content_json"]
    md = render_markdown(
        content,
        include_metadata=include_metadata,
        requester_role=_user.get("role"),
    )
    filename = f"{slug}.md"
    return FastAPIResponse(
        content=md.encode("utf-8"),
        media_type="text/markdown; charset=utf-8",
        headers={
            "Content-Disposition": (
                f'attachment; filename="{quote(filename)}"; '
                f"filename*=UTF-8''{quote(filename)}"
            ),
            "Cache-Control": "private, no-store",
        },
    )


# ── PDF export (WeasyPrint 의존) ────────────────────────────────────


@router.post(
    "/pdf",
    summary="문서를 PDF 로 내보내기 (WeasyPrint)",
    description=(
        "WeasyPrint 가 설치된 환경에서만 동작한다.\n"
        "설치되지 않은 경우 501 을 돌려주며, FE 는 print-friendly 페이지로 폴백한다."
    ),
)
async def export_pdf(
    payload: dict[str, Any],
    s: AsyncSession = Depends(get_db),
    _user: dict = Depends(require_reader),
) -> FastAPIResponse:
    if _WEASYPRINT is None:
        raise _PdfExportUnavailable()

    slug = (payload or {}).get("slug")
    if not slug or not isinstance(slug, str):
        from app.core.errors import ValidationFailed

        raise ValidationFailed("slug 가 필요합니다.", details={"required": ["slug"]})

    doc = await document_service.get_document_or_404(s, slug)
    # Lazy import — only hit when WeasyPrint is actually present.
    from app.services.pdf_export import render_pdf

    pdf_bytes = render_pdf(
        doc["content_json"], requester_role=_user.get("role")
    )
    filename = f"{slug}.pdf"
    return FastAPIResponse(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": (
                f'attachment; filename="{quote(filename)}"; '
                f"filename*=UTF-8''{quote(filename)}"
            ),
            "Cache-Control": "private, no-store",
        },
    )


# ── PPTX export (python-pptx) ───────────────────────────────────────


_PPTX_MEDIA_TYPE = (
    "application/vnd.openxmlformats-officedocument.presentationml.presentation"
)


@router.post(
    "/pptx",
    summary="문서를 PowerPoint (.pptx) 로 내보내기",
    description=(
        "DocumentJSON 본문을 발표용 .pptx 로 변환한다.\n\n"
        "- level-1 섹션 1개 = 슬라이드 1장 (제목 슬라이드 포함).\n"
        "- level-2 sub-section 은 분량이 ≤500자면 inline bullets,"
        " 초과하면 별도 슬라이드로 분리.\n"
        "- chart 는 line/bar/pie 만 네이티브 차트로, 그 외는 텍스트 요약 fallback.\n"
        "- ``meta.note: \"speaker: …\"`` prefix 를 만난 블록은 슬라이드 노트에 누적."
    ),
)
async def export_pptx(
    payload: dict[str, Any],
    s: AsyncSession = Depends(get_db),
    _user: dict = Depends(require_reader),
) -> FastAPIResponse:
    slug = (payload or {}).get("slug")
    if not slug or not isinstance(slug, str):
        from app.core.errors import ValidationFailed

        raise ValidationFailed("slug 가 필요합니다.", details={"required": ["slug"]})

    doc = await document_service.get_document_or_404(s, slug)
    content = doc["content_json"]

    # 이미지 resolver — documents.py 의 헬퍼를 재사용 (slide 내 add_picture 용 bytes).
    from app.routers.documents import (
        _collect_image_ids,
        _fetch_image_bytes,
        _fetch_image_urls,
    )

    image_ids = _collect_image_ids(content)
    image_blob_lookup: dict[str, dict[str, Any]] = {}
    if image_ids:
        urls = await _fetch_image_urls(s, image_ids)
        image_blob_lookup = await _fetch_image_bytes(s, urls)

    def resolver(image_id: str) -> dict[str, Any] | None:
        info = image_blob_lookup.get(image_id)
        if not info:
            return None
        return {"bytes": info.get("bytes"), "mime": info.get("mime")}

    pptx_bytes = render_pptx(
        content,
        options=PptxOptions(image_resolver=resolver),
        requester_role=_user.get("role"),
    )
    filename = f"{slug}.pptx"
    return FastAPIResponse(
        content=pptx_bytes,
        media_type=_PPTX_MEDIA_TYPE,
        headers={
            "Content-Disposition": (
                f'attachment; filename="{quote(filename)}"; '
                f"filename*=UTF-8''{quote(filename)}"
            ),
            "Cache-Control": "private, no-store",
        },
    )


# ── DOCX export (python-docx) ───────────────────────────────────────


_DOCX_MEDIA_TYPE = (
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
)


@router.post(
    "/docx",
    summary="문서를 Word (.docx) 로 내보내기",
    description=(
        "DocumentJSON 본문을 Word 문서(.docx) 로 변환한다. cycle 1 의 .docx import "
        "와 round-trip 가능 (스타일/구조를 importer 가 인식하는 형태로 출력).\n\n"
        "- Heading 1/2/3 = section level, Heading 4/5/6 = `heading-4` block.\n"
        "- markdown-lite (bold/italic/strike/underline/code/link/wiki/footnote) 보존.\n"
        "- table / list / quote / callout / code 는 네이티브 도형/스타일로.\n"
        "- chart / gantt / flow / org-chart 는 텍스트 요약 + 데이터 표 fallback.\n"
        "- speaker note (`meta.note=\"speaker:…\"`) 는 DOCX 노트 페인이 없어 drop."
    ),
)
async def export_docx(
    payload: dict[str, Any],
    s: AsyncSession = Depends(get_db),
    _user: dict = Depends(require_reader),
) -> FastAPIResponse:
    slug = (payload or {}).get("slug")
    if not slug or not isinstance(slug, str):
        from app.core.errors import ValidationFailed

        raise ValidationFailed("slug 가 필요합니다.", details={"required": ["slug"]})

    doc = await document_service.get_document_or_404(s, slug)
    content = doc["content_json"]

    # 이미지 resolver — pptx_export 와 동일하게 documents.py 헬퍼 재사용.
    from app.routers.documents import (
        _collect_image_ids,
        _fetch_image_bytes,
        _fetch_image_urls,
    )

    image_ids = _collect_image_ids(content)
    image_blob_lookup: dict[str, dict[str, Any]] = {}
    if image_ids:
        urls = await _fetch_image_urls(s, image_ids)
        image_blob_lookup = await _fetch_image_bytes(s, urls)

    def resolver(image_id: str) -> dict[str, Any] | None:
        info = image_blob_lookup.get(image_id)
        if not info:
            return None
        return {"bytes": info.get("bytes"), "mime": info.get("mime")}

    docx_bytes = render_docx(
        content,
        options=DocxOptions(image_resolver=resolver),
        requester_role=_user.get("role"),
    )
    filename = f"{slug}.docx"
    return FastAPIResponse(
        content=docx_bytes,
        media_type=_DOCX_MEDIA_TYPE,
        headers={
            "Content-Disposition": (
                f'attachment; filename="{quote(filename)}"; '
                f"filename*=UTF-8''{quote(filename)}"
            ),
            "Cache-Control": "private, no-store",
        },
    )
