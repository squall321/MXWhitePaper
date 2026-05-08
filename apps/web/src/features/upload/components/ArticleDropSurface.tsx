import { useCallback, useRef } from 'react'
import type { Block, DocumentJSONV10, GalleryBlock, ImageBlock, Slug } from '@/types/document'
import { useEditorStore } from '@/features/editor/state'
import { insertBlock, isPreconditionFailed } from '@/features/editor/api'
import { ulid } from '@/features/editor/ulid'
import {
  ImageDropzone,
  type ImageDropzoneHandle,
} from './ImageDropzone'
import type { ImageRecord } from '../api'

interface ArticleDropSurfaceProps {
  slug: Slug
  document: DocumentJSONV10
  children: React.ReactNode
}

/**
 * Article-root drop surface, mounted on the editor page when the document is
 * in fullEdit mode. Handles the three implicit insertion triggers:
 *
 *   1. Drag & drop anywhere over the article body.
 *   2. Clipboard paste while the editor is active.
 *   3. Multi-file flows that the dropzone bundled into a gallery.
 *
 * Inserted blocks land at the END of the FIRST top-level section — Sprint 5
 * doesn't track an editor cursor yet, so this is the predictable choice
 * (matches the spec's "article root" mount point). After insertion, the
 * fresh image block is marked for caption auto-focus so the user lands in
 * the caption input within ≤ 5s of the drop.
 */
export function ArticleDropSurface({ slug, document, children }: ArticleDropSurfaceProps) {
  const etag = useEditorStore((s) => s.etag)
  const applySnapshot = useEditorStore((s) => s.applyServerSnapshot)
  const setConflict = useEditorStore((s) => s.setConflict)
  const setPendingCaptionFocus = useEditorStore((s) => s.setPendingCaptionFocus)
  const dropzoneRef = useRef<ImageDropzoneHandle>(null)

  const targetSectionId = document.sections[0]?.id

  const insert = useCallback(
    async (block: Block, focusBlockId?: string) => {
      if (!etag || !targetSectionId) return
      try {
        const result = await insertBlock(
          slug,
          { section_id: targetSectionId, block },
          etag,
          '이미지 추가',
        )
        applySnapshot(result.document, result.etag)
        if (focusBlockId) setPendingCaptionFocus(focusBlockId)
      } catch (err) {
        if (isPreconditionFailed(err)) setConflict(null)
        else console.error('[ArticleDropSurface] insertBlock failed', err)
      }
    },
    [etag, slug, targetSectionId, applySnapshot, setConflict, setPendingCaptionFocus],
  )

  const onSingle = useCallback(
    async (rec: ImageRecord, ctx: { mode: 'inline' | 'replace' | 'gallery'; index: number; total: number }) => {
      // For gallery mode we batch in onBatchReady, so skip per-image inserts.
      if (ctx.mode === 'gallery' && ctx.total > 1) return
      const id = ulid()
      const block: ImageBlock = {
        type: 'image',
        id,
        imageId: rec.image_id,
      }
      await insert(block, id)
    },
    [insert],
  )

  const onBatch = useCallback(
    async (records: ImageRecord[]) => {
      if (records.length <= 1) return // single images already inserted
      const id = ulid()
      const items = records.map((r) => ({ imageId: r.image_id })) as GalleryBlock['items']
      const block: GalleryBlock = {
        type: 'gallery',
        id,
        layout: 'grid',
        items,
      }
      await insert(block)
    },
    [insert],
  )

  return (
    <ImageDropzone
      ref={dropzoneRef}
      surface
      onImageReady={onSingle}
      onBatchReady={onBatch}
    >
      {children}
    </ImageDropzone>
  )
}
