/**
 * imageRehydrate — async helper that pulls remote image URLs into the local
 * MinIO bucket after a rich-paste produced ImageBlocks with `meta.note =
 * "src:<url>"`.
 *
 * Policy:
 *   - Fire-and-forget per block; do NOT block the paste itself.
 *   - On success: `patchBlock` with the new imageId and clear the `meta.note`.
 *   - On failure (CORS / 404 / non-image MIME / over-size): leave the block as
 *     is and surface a one-time toast so the user knows to upload manually.
 *   - Same-origin URLs that already point at our MinIO bucket are NOT
 *     re-uploaded — we just trust the URL and clear the note (FE can't know
 *     the imageId for those without an extra round-trip; we leave imageId
 *     empty and rely on the caption + note for now).
 *
 * This module has zero direct DOM dependencies aside from `fetch` + `Blob`,
 * so it stays unit-test friendly.
 */
import type { Block, ImageBlock, Slug, Ulid } from '@/types/document'
import { patchBlock } from '../api'
import { useEditorStore } from '../state'
import { uploadImage } from '@/features/upload/uploadImage'
import { toast } from '@/components/ui/Toast'

const SRC_PREFIX = 'src:'

/**
 * Extract the original src URL from a paste-tagged image block.
 * Returns null when the block is already rehydrated or has no note.
 */
export function pendingSrc(block: ImageBlock): string | null {
  const note = block.meta?.note ?? ''
  if (!note.startsWith(SRC_PREFIX)) return null
  const url = note.slice(SRC_PREFIX.length).trim()
  return url.length > 0 ? url : null
}

/**
 * Walk a Block[] (post-paste) and start a background fetch for each
 * paste-tagged image. We resolve each in parallel; one rotten URL doesn't
 * block the others. The first failure across the batch surfaces the
 * fallback toast (subsequent failures stay silent so we don't spam).
 */
export function rehydratePastedImages(slug: Slug, blocks: Block[]): void {
  const targets: { blockId: Ulid; src: string }[] = []
  for (const b of blocks) {
    if (b.type !== 'image') continue
    const src = pendingSrc(b)
    if (!src) continue
    targets.push({ blockId: b.id, src })
  }
  if (targets.length === 0) return

  let warnedOnce = false
  for (const { blockId, src } of targets) {
    void rehydrateOne(slug, blockId, src).catch(() => {
      if (warnedOnce) return
      warnedOnce = true
      toast.warn('이미지 일부를 가져오지 못했습니다 — 직접 업로드해 주세요')
    })
  }
}

/**
 * Single-image rehydration. Throws on failure so the caller can decide
 * whether to surface a toast.
 */
async function rehydrateOne(
  slug: Slug,
  blockId: Ulid,
  src: string,
): Promise<void> {
  // Skip data URLs that are absurdly large (Word can paste 10MB inline PNGs).
  if (src.startsWith('data:') && src.length > 8 * 1024 * 1024) {
    throw new Error('data URL too large')
  }

  // Pull bytes. Errors here include CORS, 404, network failures.
  const res = await fetch(src, { credentials: 'omit', mode: 'cors' })
  if (!res.ok) throw new Error(`fetch ${res.status}`)
  const blob = await res.blob()
  if (!blob.type.startsWith('image/')) {
    throw new Error(`non-image mime: ${blob.type}`)
  }

  // Synthesise a filename from the URL path (or fall back to a timestamp).
  const filename = filenameFromUrl(src) ?? `pasted-${Date.now()}.png`
  const file = new File([blob], filename, { type: blob.type })

  const record = await uploadImage(file, { filename })

  // Patch the block with the fresh imageId. We use the editor store's
  // current etag — patchBlock returns a fresh doc snapshot which we apply.
  const tag = useEditorStore.getState().etag
  if (!tag) return // editor unmounted while we were uploading
  const patch: Partial<ImageBlock> = {
    type: 'image',
    id: blockId,
    imageId: record.image_id,
    // Clear the src note now that it's rehydrated.
    meta: { note: undefined },
  }
  try {
    const result = await patchBlock(slug, blockId, patch as never, tag, '붙여넣은 이미지 가져오기')
    useEditorStore.getState().applyServerSnapshot(result.document, result.etag)
  } catch {
    // ETag drift / 404 — silently swallow. Worst case the user sees a stale
    // image-with-broken-thumbnail until their next save.
  }
}

function filenameFromUrl(src: string): string | null {
  if (src.startsWith('data:')) return null
  try {
    const u = new URL(src, 'http://localhost')
    const last = u.pathname.split('/').pop()
    if (!last) return null
    return decodeURIComponent(last)
  } catch {
    return null
  }
}
