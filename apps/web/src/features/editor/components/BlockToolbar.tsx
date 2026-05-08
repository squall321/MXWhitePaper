import { useState, useCallback } from 'react'
import type { Block, Slug, Ulid } from '@/types/document'
import { deleteBlock, moveBlock, patchBlock, isPreconditionFailed } from '../api'
import { useEditorStore } from '../state'

interface BlockToolbarProps {
  slug: Slug
  block: Block
  /** The section this block currently belongs to. */
  sectionId: Ulid
  /** Block's index inside that section. */
  index: number
  /** Total number of blocks in the section (for ↑↓ disable). */
  total: number
}

/**
 * Hover toolbar shown above each block in fullEdit mode. Supports:
 *
 *   - ↑/↓        move within section (POST /blocks/:id/move)
 *   - 🔒/🔓      lock/unlock (PATCH /blocks/:id with meta.locked)
 *   - 🗑          delete (DELETE /blocks/:id)
 *
 * "Move to other section" is shown but stubbed in Sprint 4 — full picker
 * arrives in Sprint 5.
 */
export function BlockToolbar({ slug, block, sectionId, index, total }: BlockToolbarProps) {
  const etag = useEditorStore((s) => s.etag)
  const applySnapshot = useEditorStore((s) => s.applyServerSnapshot)
  const setConflict = useEditorStore((s) => s.setConflict)
  const [busy, setBusy] = useState(false)

  const wrap = useCallback(
    async (fn: () => Promise<{ document: import('@/types/document').DocumentJSONV10; etag: string }>) => {
      if (!etag) return
      setBusy(true)
      try {
        const r = await fn()
        applySnapshot(r.document, r.etag)
      } catch (err) {
        if (isPreconditionFailed(err)) setConflict(null)
      } finally {
        setBusy(false)
      }
    },
    [etag, applySnapshot, setConflict],
  )

  const moveUp = () =>
    wrap(() =>
      moveBlock(slug, block.id, { to_section_id: sectionId, to_index: Math.max(0, index - 1) }, etag!, '블록 ↑'),
    )
  const moveDown = () =>
    wrap(() =>
      moveBlock(
        slug,
        block.id,
        { to_section_id: sectionId, to_index: Math.min(total - 1, index + 1) },
        etag!,
        '블록 ↓',
      ),
    )
  const removeBlock = () => wrap(() => deleteBlock(slug, block.id, etag!, '블록 삭제'))
  const toggleLock = () => {
    const meta = { ...(block.meta ?? {}), locked: !block.meta?.locked }
    return wrap(() => patchBlock(slug, block.id, { meta } as Partial<Block>, etag!, '블록 잠금 변경'))
  }

  return (
    <div className="absolute -top-3 right-1 hidden gap-0.5 rounded border border-gray-200 bg-white px-1 py-0.5 text-xs shadow-sm group-hover:flex">
      <button
        type="button"
        onClick={moveUp}
        disabled={busy || index === 0}
        title="위로"
        className="px-1 hover:bg-smsg-100 disabled:opacity-30"
      >
        ↑
      </button>
      <button
        type="button"
        onClick={moveDown}
        disabled={busy || index >= total - 1}
        title="아래로"
        className="px-1 hover:bg-smsg-100 disabled:opacity-30"
      >
        ↓
      </button>
      <button
        type="button"
        onClick={toggleLock}
        disabled={busy}
        title={block.meta?.locked ? '잠금 해제' : '잠금'}
        className="px-1 hover:bg-smsg-100"
      >
        {block.meta?.locked ? '🔒' : '🔓'}
      </button>
      <button
        type="button"
        onClick={removeBlock}
        disabled={busy}
        title="삭제"
        className="px-1 hover:bg-red-50"
      >
        🗑
      </button>
    </div>
  )
}
