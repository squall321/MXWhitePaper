/**
 * 문서 내보내기 API 클라이언트.
 *
 * - `downloadHtml(slug)`  → 기존 GET /documents/{slug}/export.html 새 창.
 * - `downloadMarkdown(slug)` → POST /exports/markdown 후 파일 다운로드.
 * - `downloadPdf(slug)` → POST /exports/pdf, 501 이면 print-friendly fallback.
 * - `downloadPptx(slug)` → POST /exports/pptx 후 .pptx 다운로드.
 * - `downloadDocx(slug)` → POST /exports/docx 후 .docx 다운로드.
 *
 * 모든 다운로드는 Blob → object URL → anchor click → revoke 패턴으로 통일.
 */
import { apiClient } from '@/lib/api/client'
import { withBase } from '@/lib/basePath'

export interface ExportOptions {
  /** 마크다운 메타데이터(slug/owners/tags) 표 포함 여부. 기본 true. */
  includeMetadata?: boolean
}

export interface PdfFallbackHint {
  fallback: 'print'
  /** Print 페이지 URL — FE 가 새 창으로 띄우면 된다. */
  url: string
}

export type PdfDownloadResult =
  | { kind: 'pdf' }
  | { kind: 'fallback'; hint: PdfFallbackHint }

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // Defer revoke so Safari has time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1500)
}

export async function downloadMarkdown(
  slug: string,
  opts: ExportOptions = {},
): Promise<void> {
  const res = await apiClient.post(
    '/exports/markdown',
    { slug, include_metadata: opts.includeMetadata ?? true },
    { responseType: 'blob' },
  )
  const blob = res.data instanceof Blob
    ? res.data
    : new Blob([res.data as ArrayBuffer], { type: 'text/markdown' })
  triggerDownload(blob, `${slug}.md`)
}

export async function downloadPdf(slug: string): Promise<PdfDownloadResult> {
  try {
    const res = await apiClient.post(
      '/exports/pdf',
      { slug },
      { responseType: 'blob' },
    )
    const blob = res.data instanceof Blob
      ? res.data
      : new Blob([res.data as ArrayBuffer], { type: 'application/pdf' })
    triggerDownload(blob, `${slug}.pdf`)
    return { kind: 'pdf' }
  } catch (err) {
    // 501 → fallback to FE-side print page.
    const status = (err as { response?: { status?: number } } | undefined)
      ?.response?.status
    if (status === 501) {
      const url = `/docs/${encodeURIComponent(slug)}?print=1`
      return { kind: 'fallback', hint: { fallback: 'print', url } }
    }
    throw err
  }
}

export async function downloadPptx(slug: string): Promise<void> {
  const res = await apiClient.post(
    '/exports/pptx',
    { slug },
    { responseType: 'blob' },
  )
  const blob = res.data instanceof Blob
    ? res.data
    : new Blob([res.data as ArrayBuffer], {
        type:
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      })
  triggerDownload(blob, `${slug}.pptx`)
}

export async function downloadDocx(slug: string): Promise<void> {
  const res = await apiClient.post(
    '/exports/docx',
    { slug },
    { responseType: 'blob' },
  )
  const blob = res.data instanceof Blob
    ? res.data
    : new Blob([res.data as ArrayBuffer], {
        type:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      })
  triggerDownload(blob, `${slug}.docx`)
}

/** HTML export 는 기존 GET 엔드포인트가 직접 다운로드 attachment 로 응답한다. */
export function htmlExportUrl(slug: string): string {
  return withBase(`/api/v1/documents/${encodeURIComponent(slug)}/export.html?style=namuwiki`)
}
