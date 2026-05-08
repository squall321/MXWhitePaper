import { apiClient } from '@/lib/api/client'
import { unwrap, type ApiEnvelope } from '@/lib/api/envelope'
import type { Ulid } from '@/types/document'

/** Body sent to `/uploads/image/init`. */
export interface InitImageInput {
  /** Lowercase 64-char hex digest of the file content. */
  sha256: string
  /** Total content length in bytes. */
  size: number
  /** MIME type as reported by the browser (e.g. `image/png`). */
  mime: string
  /** Original filename (UTF-8). */
  filename?: string
}

export interface ImageRecord {
  image_id: Ulid
  /** UUID variant returned by BE alongside the ULID (Sprint 6 dual lookup). */
  image_uuid?: string
  urls: { thumb: string; view: string; orig: string }
  width?: number
  height?: number
  /** CSS-color hex (e.g. `#a3b1c4`) used as a placeholder background. */
  dominant_color?: string
}

/**
 * `POST /uploads/image/init` response (BE contract — Sprint 5/6).
 *
 *   1. Need-upload: `{ deduped: false, uploadId, method:"PUT", url, headers, expiresIn }`.
 *   2. Deduplicated: `{ deduped: true, image_id, image_uuid, urls }` — no PUT.
 *
 * The FE flattens these into a single discriminated object so call sites can
 * branch on `result.deduped` cleanly.
 */
export interface InitImageRaw {
  deduped: boolean
  uploadId?: Ulid
  method?: string
  url?: string
  headers?: Record<string, string>
  expiresIn?: number
  // Dedupe path:
  image_id?: Ulid
  image_uuid?: string
  urls?: { thumb: string; view: string; orig: string }
}

export interface InitImageNeedUpload {
  deduped: false
  uploadId: Ulid
  putUrl: string
  putHeaders: Record<string, string>
  expiresIn?: number
}

export interface InitImageDeduped {
  deduped: true
  image: ImageRecord
}

export type InitImageResult = InitImageNeedUpload | InitImageDeduped

/** POST /api/v1/uploads/image/init. */
export async function initImageUpload(
  body: InitImageInput,
): Promise<InitImageResult> {
  const res = await apiClient.post<ApiEnvelope<InitImageRaw>>(
    '/uploads/image/init',
    body,
  )
  const raw = unwrap(res)
  if (raw.deduped) {
    if (!raw.image_id || !raw.urls) {
      throw new Error('이미지 dedup 응답이 불완전합니다.')
    }
    return {
      deduped: true,
      image: {
        image_id: raw.image_id,
        image_uuid: raw.image_uuid,
        urls: raw.urls,
      },
    }
  }
  if (!raw.uploadId || !raw.url) {
    throw new Error('이미지 업로드 응답이 불완전합니다.')
  }
  return {
    deduped: false,
    uploadId: raw.uploadId,
    putUrl: raw.url,
    putHeaders: raw.headers ?? {},
    expiresIn: raw.expiresIn,
  }
}

/**
 * Raw PUT to a presigned URL. Reports progress via the optional callback.
 * Resolves on HTTP 200/201/204; rejects otherwise.
 */
export function putToPresigned(
  url: string,
  headers: Record<string, string>,
  file: Blob,
  onProgress?: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url, true)
    for (const [k, v] of Object.entries(headers)) {
      xhr.setRequestHeader(k, v)
    }
    if (onProgress && xhr.upload) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && e.total > 0) {
          onProgress(Math.round((e.loaded / e.total) * 100))
        }
      }
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve()
      else reject(new Error(`presigned PUT failed: ${xhr.status}`))
    }
    xhr.onerror = () => reject(new Error('presigned PUT network error'))
    xhr.send(file)
  })
}

/** POST /api/v1/uploads/image/finalize — confirm a successful PUT.
 *
 * BE expects camelCase `uploadId`. Returns the `ImageRecord` shape directly.
 */
export async function finalizeImageUpload(
  uploadId: Ulid,
): Promise<ImageRecord> {
  const res = await apiClient.post<ApiEnvelope<ImageRecord>>(
    '/uploads/image/finalize',
    { uploadId },
  )
  return unwrap(res)
}

/** GET /api/v1/images/:imageId — used by ImageBlock view to resolve URLs. */
export async function getImage(imageId: Ulid): Promise<ImageRecord> {
  const res = await apiClient.get<ApiEnvelope<ImageRecord>>(
    `/images/${encodeURIComponent(imageId)}`,
  )
  return unwrap(res)
}
