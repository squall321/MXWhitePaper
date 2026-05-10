import type { Block, Slug } from '@/types/document'
import { useEditorStore } from '../state'
import { deleteBlock, isPreconditionFailed } from '../api'
import { BlockRenderer } from '@/components/blocks/BlockRenderer'

/**
 * Wraps a child block rendered inside a container (columns / tabs /
 * accordion) and surfaces a hover-only ✕ button so nested blocks can be
 * deleted individually. Without this, BE happily deletes nested blocks
 * via `deleteBlock` (its `_walk_blocks_in_section` already recurses
 * through containers) — but the FE only renders X buttons on
 * section-level blocks, so users have no way to fire that path on a
 * column-internal paragraph.
 *
 * The component delegates rendering to `BlockRenderer` so editor /
 * collapse / resize affordances all keep working; we only add an
 * absolutely-positioned delete affordance.
 */
export function NestedBlockControls({
  slug,
  block,
}: {
  slug: Slug
  block: Block
}) {
  const etag = useEditorStore((s) => s.etag)
  const apply = useEditorStore((s) => s.applyServerSnapshot)
  const setConflict = useEditorStore((s) => s.setConflict)

  const onDelete = async () => {
    if (!etag) return
    try {
      const result = await deleteBlock(slug, block.id, etag, '중첩 블록 삭제')
      apply(result.document, result.etag)
    } catch (err) {
      if (isPreconditionFailed(err)) setConflict(null)
    }
  }

  return (
    <div className="group/nested relative">
      <BlockRenderer block={block} />
      <button
        type="button"
        aria-label="블록 삭제"
        title="이 블록 삭제"
        onClick={() => void onDelete()}
        className="absolute -right-2 -top-2 z-20 hidden h-5 w-5 items-center justify-center rounded-full border border-gray-200 bg-white text-[10px] text-gray-400 shadow-sm transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600 group-hover/nested:flex"
      >
        <span aria-hidden="true">✕</span>
      </button>
    </div>
  )
}
