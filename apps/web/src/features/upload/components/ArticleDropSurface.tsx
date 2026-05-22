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

  const fallbackSectionId = document.sections[0]?.id

  /**
   * 삽입 위치 — `document.activeElement` 에서 가장 가까운 `[data-block-id]`
   * 를 찾아, 그 블록 *바로 다음* 에 끼워넣는다. 포커스가 없거나 (또는 articleroot
   * 빈 영역에 paste) 블록을 못 찾으면 첫 섹션 끝으로 폴백.
   *
   * BlockCollapseWrapper 가 모든 블록을 감싸며 data-block-id 를 달고,
   * SimpleStackEditor root 가 data-section-id 를 갖고 있어 DOM 조회로 충분.
   */
  const resolveInsertTarget = (): { sectionId: string; index?: number } => {
    const active = (typeof globalThis !== 'undefined' ? globalThis.document : null)?.activeElement
    if (active instanceof HTMLElement) {
      const blockEl = active.closest('[data-block-id]') as HTMLElement | null
      const sectionEl = active.closest('[data-section-id]') as HTMLElement | null
      const blockId = blockEl?.getAttribute('data-block-id')
      const sectionId = sectionEl?.getAttribute('data-section-id')
      if (blockId && sectionId) {
        const sec = document.sections.find((s) => s.id === sectionId)
        if (sec) {
          const idx = sec.blocks.findIndex((b) => b.id === blockId)
          if (idx >= 0) return { sectionId, index: idx + 1 }
        }
      }
      // 블록은 못 찾았지만 섹션은 안다 — 그 섹션 끝.
      if (sectionId) return { sectionId }
    }
    return { sectionId: fallbackSectionId ?? '' }
  }

  const insert = useCallback(
    async (block: Block, focusBlockId?: string) => {
      if (!etag) return
      const target = resolveInsertTarget()
      if (!target.sectionId) return
      try {
        const result = await insertBlock(
          slug,
          { section_id: target.sectionId, index: target.index, block },
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
    // resolveInsertTarget 는 매 호출 시 DOM 을 직접 읽으므로 deps 에 없어도 됨.
    // document.sections 가 바뀌면 다음 호출에서 자연스럽게 최신을 본다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [etag, slug, fallbackSectionId, applySnapshot, setConflict, setPendingCaptionFocus, document.sections],
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
