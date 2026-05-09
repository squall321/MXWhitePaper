import type { Block } from '@/types/document'

/**
 * Possible block-types we route a dropped file into.
 *   image → ImageBlock (uploaded via uploadImage → image_id)
 *   pdf   → PdfBlock   (uploaded via uploadFile  → file_id)
 *   video → VideoBlock (uploaded via uploadFile  → BE download URL)
 *   file  → FileBlock  (everything else)
 */
export type DroppedBlockKind = Extract<Block['type'], 'image' | 'pdf' | 'video' | 'file'>

/** Which uploader to call for a given dropped file. */
export type Uploader = 'image' | 'file'

export interface DispatchDecision {
  kind: DroppedBlockKind
  uploader: Uploader
}

/**
 * Pure routing decision for a dropped file. The MIME type is the primary
 * signal, the filename extension is the fallback for the cases where the
 * browser leaves `file.type` empty (some Linux browsers do this for
 * application/* types).
 *
 * Rules:
 *   - `image/*`              → ImageBlock via uploadImage.
 *   - `application/pdf`      → PdfBlock   via uploadFile.
 *   - `video/*`              → VideoBlock via uploadFile.
 *   - everything else        → FileBlock  via uploadFile.
 */
export function dispatchByMime(file: File): DispatchDecision {
  const mime = (file.type || '').toLowerCase()
  const name = (file.name || '').toLowerCase()
  if (mime.startsWith('image/')) return { kind: 'image', uploader: 'image' }
  if (mime === 'application/pdf' || name.endsWith('.pdf')) {
    return { kind: 'pdf', uploader: 'file' }
  }
  if (mime.startsWith('video/') || /\.(mp4|webm|mov|m4v|avi)$/.test(name)) {
    return { kind: 'video', uploader: 'file' }
  }
  return { kind: 'file', uploader: 'file' }
}
