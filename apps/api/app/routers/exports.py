"""문서 내보내기 라우터 — Markdown / PDF.

기존 `/api/v1/documents/{slug}/export.html` (HTML) 와 별도로,
git 커밋 가능한 Markdown 과 인쇄/공유용 PDF 출력을 제공한다.

PDF 는 WeasyPrint 가 환경에 설치되어 있을 때만 활성화된다.
설치되지 않은 경우 `/exports/pdf` 호출은 501 을 돌려준다 — FE 는 이때
`/docs/:slug?print=1` 같은 print-friendly 라우트로 폴백해 `window.print()` 를 띄운다.
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
from app.services.markdown_export import render_markdown

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
    md = render_markdown(content, include_metadata=include_metadata)
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

    pdf_bytes = render_pdf(doc["content_json"])
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
