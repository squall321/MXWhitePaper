import {
  finalizeImageUpload,
  initImageUpload,
  putToPresigned,
  type ImageRecord,
} from './api'
import { hashFile } from './sha256'

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
 */
export async function uploadImage(
  file: File,
  opts: UploadImageOptions = {},
): Promise<ImageRecord> {
  const { onProgress, debug } = opts

  onProgress?.('hashing', 0)
  const sha256 = await hashFile(file)
  onProgress?.('hashing', 100)

  if (debug) console.debug('[uploadImage] init', { sha256, size: file.size })

  const init = await initImageUpload({
    sha256,
    size: file.size,
    mime: file.type || 'application/octet-stream',
    filename: file.name,
  })

  if (init.deduped) {
    if (debug) console.debug('[uploadImage] dedupe hit', init.image.image_id)
    onProgress?.('uploading', 100)
    onProgress?.('finalizing', 100)
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
  return record
}
