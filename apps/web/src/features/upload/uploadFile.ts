import { apiClient } from '@/lib/api/client'
import { unwrap, type ApiEnvelope } from '@/lib/api/envelope'
import type { Ulid } from '@/types/document'
import { putToPresigned } from './api'
import { pushNotification } from '@/features/notifications/store'
import { withBase } from '@/lib/basePath'

/**
 * Generic (non-image) file upload. Mirrors `uploadImage.ts`:
 *
 *   1. POST /files/presign-put → returns `{ file_id, key, presigned_url, ... }`
 *   2. PUT raw bytes to the presigned URL with progress.
 *   3. POST /files/finalize → BE HEADs the object, INSERTs `files` row,
 *      returns `{ file_id, filename, size, mime, download_url }`.
 *
 * Throws `Error` with a Korean-friendly message on size-too-big / network /
 * blocked-mime / cancellation. Reports progress via `onProgress(fraction)`
 * where fraction ∈ [0, 1].
 */
export interface FileUploadResult {
  fileId: Ulid
  filename: string
  size: number
  mime: string
  downloadUrl: string
}

export interface UploadFileOptions {
  /** Progress 0..1 (covers the PUT only; presign and finalize are near-instant). */
  onProgress?: (fraction: number) => void
}

interface PresignResponse {
  file_id: Ulid
  key: string
  presigned_url: string
  method?: string
  headers?: Record<string, string>
  expires_in?: number
}

interface FinalizeResponse {
  file_id: Ulid
  filename: string
  size: number
  mime: string
  download_url: string
}

export async function uploadFile(
  file: File,
  opts: UploadFileOptions = {},
): Promise<FileUploadResult> {
  const { onProgress } = opts

  const mime = file.type || 'application/octet-stream'
  // --- 1. presign-put -----------------------------------------------------
  let presign: PresignResponse
  try {
    const res = await apiClient.post<ApiEnvelope<PresignResponse>>(
      '/files/presign-put',
      { filename: file.name, mime, size: file.size },
    )
    presign = unwrap(res)
  } catch (e) {
    throw normalizeUploadError(e, file)
  }

  // --- 2. PUT bytes -------------------------------------------------------
  onProgress?.(0)
  try {
    await putToPresigned(
      presign.presigned_url,
      presign.headers ?? { 'Content-Type': mime },
      file,
      (pct) => onProgress?.(pct / 100),
    )
  } catch (e) {
    throw new Error(
      `파일 업로드 실패: ${(e as Error).message ?? '네트워크 오류'}`,
    )
  }
  onProgress?.(1)

  // --- 3. finalize --------------------------------------------------------
  let finalized: FinalizeResponse
  try {
    const res = await apiClient.post<ApiEnvelope<FinalizeResponse>>(
      '/files/finalize',
      {
        file_id: presign.file_id,
        filename: file.name,
        mime,
        size: file.size,
      },
    )
    finalized = unwrap(res)
  } catch (e) {
    throw normalizeUploadError(e, file)
  }

  pushNotification({
    category: 'activity',
    message: '파일 업로드 완료',
    detail: file.name,
  })

  return {
    fileId: finalized.file_id,
    filename: finalized.filename,
    size: finalized.size,
    mime: finalized.mime,
    downloadUrl: finalized.download_url,
  }
}

function normalizeUploadError(e: unknown, file: File): Error {
  // axios error envelope → useful message.
  const err = e as {
    response?: {
      status?: number
      data?: { error?: { code?: string; message?: string } }
    }
    message?: string
  }
  const status = err.response?.status
  const apiCode = err.response?.data?.error?.code
  const apiMsg = err.response?.data?.error?.message
  if (apiCode === 'VALIDATION_ERROR' && apiMsg) {
    return new Error(apiMsg)
  }
  if (status === 413 || apiCode === 'VALIDATION_ERROR') {
    return new Error(
      `파일이 너무 큽니다 (${(file.size / (1024 * 1024)).toFixed(1)} MB).`,
    )
  }
  if (status === 429 || apiCode === 'RATE_LIMITED') {
    return new Error('업로드 요청이 너무 빈번합니다. 잠시 후 다시 시도해주세요.')
  }
  if (status === 401 || status === 403) {
    return new Error('파일 업로드 권한이 없습니다.')
  }
  return new Error(apiMsg ?? err.message ?? '파일 업로드에 실패했습니다.')
}

/** GET /api/v1/files/:id/download — server 302's to a fresh presigned URL. */
export function fileDownloadUrl(fileId: string): string {
  return withBase(`/api/v1/files/${encodeURIComponent(fileId)}/download`)
}
