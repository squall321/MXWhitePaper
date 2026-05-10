import {
  finalizeImageUpload,
  initImageUpload,
  putToPresigned,
  type ImageRecord,
} from './api'
import { hashFile } from './sha256'
import { pushNotification } from '@/features/notifications/store'

export interface UploadImageOptions {
  /**
   * Progress callback fired during the presigned PUT. Skipped entirely on a
   * dedupe short-circuit.
   *
   * stage: 'hashing' (0..100) → 'uploading' (0..100) → 'finalizing' (100).
   */
  onProgress?: (stage: 'hashing' | 'uploading' | 'finalizing', pct: number) => void
  /** Whether to log extra debug info to the console. */
  debug?: boolean
  /**
   * Optional filename to use when uploading a `Blob` (no inherent name).
   * Ignored when the input is already a `File`.
   */
  filename?: string
}

/**
 * Orchestrate the full image upload flow:
 *   1. SHA-256 the file in the browser.
 *   2. POST /uploads/image/init  — returns either a presigned PUT URL or a
 *      `deduped` short-circuit (the file already exists).
 *   3. PUT the bytes to the presigned URL with progress.
 *   4. POST /uploads/image/finalize — server returns the final image record.
 *
 * The dedupe path skips steps 3 and 4: the server returns `deduped` directly.
 *
 * Accepts a `File` for normal uploads OR a `Blob` for re-encoded variants
 * (crop/rotate). For Blobs we synthesise filename + mime from the optional
 * second arg — the BE strips EXIF either way so re-uploaded blobs are safe.
 */
export async function uploadImage(
  source: File | Blob,
  opts: UploadImageOptions = {},
): Promise<ImageRecord> {
  const { onProgress, debug } = opts

  // Normalize Blob → { name, type, size } even when caller passed a raw Blob.
  const file = toUploadable(source, opts)

  onProgress?.('hashing', 0)
  const sha256 = await hashFile(file)
  onProgress?.('hashing', 100)

  if (debug) console.debug('[uploadImage] init', { sha256, size: file.size })

  const init = await initImageUpload({
    sha256,
    size: file.size,
    mime_type: file.type || 'application/octet-stream',
    filename: file.name,
  })

  if (init.deduped) {
    if (debug) console.debug('[uploadImage] dedupe hit', init.image.image_id)
    onProgress?.('uploading', 100)
    onProgress?.('finalizing', 100)
    pushNotification({
      category: 'activity',
      message: '이미지 업로드 완료',
      detail: file.name,
    })
    return init.image
  }

  onProgress?.('uploading', 0)
  await putToPresigned(
    init.putUrl,
    init.putHeaders,
    file,
    (pct) => onProgress?.('uploading', pct),
  )
  onProgress?.('uploading', 100)

  onProgress?.('finalizing', 0)
  const record = await finalizeImageUpload(init.uploadId)
  onProgress?.('finalizing', 100)
  pushNotification({
    category: 'activity',
    message: '이미지 업로드 완료',
    detail: file.name,
  })
  return record
}

/**
 * Wrap a raw `Blob` (e.g. from a canvas re-encode) into a `File` so the rest
 * of the pipeline — which reads `.name`, `.type`, `.size` — can stay on the
 * single upload path.
 */
function toUploadable(
  source: File | Blob,
  opts: UploadImageOptions,
): File {
  if (source instanceof File) return source
  const ext = (source.type.split('/')[1] || 'png').replace(/\W+/g, '')
  const name = opts.filename ?? `edited-image-${Date.now()}.${ext}`
  const type = source.type || 'image/png'
  return new File([source], name, { type })
}
