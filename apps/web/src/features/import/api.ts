/**
 * Word(.docx) 가져오기 API 클라이언트.
 *
 * `importDocx(file, opts)` — multipart/form-data 로 POST /imports/docx.
 * 응답: `{ document, summary }`. document 는 DocumentJSON v1.0; summary 는
 * FE 가 사용자에게 통계를 보여줄 때 사용 (단락 N개, 표 M개, …).
 *
 * 호출 측은 받은 document 를 `postDocument()` 로 한 번 더 영구화해야 한다.
 * (BE 의 import 엔드포인트 자체는 DB 미기록 — FE 가 사용자 확인 후 저장.)
 */
import { apiClient } from '@/lib/api/client'
import type { ApiEnvelope } from '@/lib/api/envelope'
import type { DocumentJSONV10 } from '@/types/document'

export interface ImportSummary {
  paragraphs: number
  headings: number
  tables: number
  images: number
  equations: number
  lists: number
  code_blocks: number
  footnotes: number
  warnings: string[]
}

export interface ImportDocxResult {
  document: DocumentJSONV10
  summary: ImportSummary
}

export interface ImportDocxOptions {
  slug?: string
  title?: string
  /** 0..1 progress for the upload phase. */
  onProgress?: (fraction: number) => void
}

export async function importDocx(
  file: File,
  opts: ImportDocxOptions = {},
): Promise<ImportDocxResult> {
  const form = new FormData()
  form.append('file', file)
  if (opts.slug) form.append('slug', opts.slug)
  if (opts.title) form.append('title', opts.title)

  const res = await apiClient.post<ApiEnvelope<ImportDocxResult>>(
    `/imports/docx`,
    form,
    {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (e: { loaded: number; total?: number }) => {
        if (!opts.onProgress) return
        const total = e.total ?? 0
        if (total > 0) {
          opts.onProgress(Math.min(1, e.loaded / total))
        }
      },
    },
  )
  const data = res.data?.data
  if (!data || !data.document || !data.summary) {
    throw new Error('서버 응답이 비어 있습니다.')
  }
  return data
}

// ── Bulk CSV import (admin only) ────────────────────────────────────
export interface BulkImportError {
  row: number
  slug: string | null
  message: string
}

export interface BulkImportResult {
  created: number
  skipped: number
  errors: BulkImportError[]
}

/** POST /imports/csv — CSV 일괄 업로드. admin 전용. */
export async function importBulkCsv(file: File): Promise<BulkImportResult> {
  const form = new FormData()
  form.append('file', file)
  const res = await apiClient.post<ApiEnvelope<BulkImportResult>>(
    '/imports/csv',
    form,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  )
  const data = res.data?.data
  if (!data) {
    throw new Error('서버 응답이 비어 있습니다.')
  }
  return data
}

// ── PowerPoint (.pptx) import ──────────────────────────────────────────
export interface ImportPptxSummary {
  slides: number
  sections: number
  paragraphs: number
  tables: number
  images: number
  speaker_notes: number
  warnings: string[]
}

export interface ImportPptxResult {
  document: DocumentJSONV10
  summary: ImportPptxSummary
}

export interface ImportPptxOptions {
  slug?: string
  title?: string
  onProgress?: (fraction: number) => void
}

/**
 * Upload a `.pptx` file. Slides are converted into Sections — each slide
 * becomes one section, with `Section.layout` heuristically derived from
 * the slide-master name. Returns the same `{document, summary}` envelope
 * as `importDocx` so the FE can preview before persisting.
 */
export async function importPptx(
  file: File,
  opts: ImportPptxOptions = {},
): Promise<ImportPptxResult> {
  const form = new FormData()
  form.append('file', file)
  if (opts.slug) form.append('slug', opts.slug)
  if (opts.title) form.append('title', opts.title)

  const res = await apiClient.post<ApiEnvelope<ImportPptxResult>>(
    `/imports/pptx`,
    form,
    {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (e: { loaded: number; total?: number }) => {
        if (!opts.onProgress) return
        const total = e.total ?? 0
        if (total > 0) opts.onProgress(Math.min(1, e.loaded / total))
      },
    },
  )
  const data = res.data?.data
  if (!data || !data.document || !data.summary) {
    throw new Error('서버 응답이 비어 있습니다.')
  }
  return data
}
