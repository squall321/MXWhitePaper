import { useState, useCallback, type ReactNode, type MouseEvent as ReactMouseEvent } from 'react'
import type { Block, Slug, Ulid } from '@/types/document'
import { insertBlock, isPreconditionFailed } from '../api'
import { useEditorStore } from '../state'
import { BlockInsertPalette, type PaletteItem } from './BlockInsertPalette'
import { BlockResizeWrapper } from './BlockResizeWrapper'

/**
 * BlockHoverInserter — wraps a single block with Notion-style affordances:
 *
 *   ┌──────── + (top) ────────┐
 *   │                         │
 *   │   ⋮  [original block]   │  ← left drag handle
 *   │                         │
 *   └──────── + (bottom) ─────┘
 *
 * Clicking either + opens a small `BlockInsertPalette` anchored to the click
 * position. Picking a block fires `insertBlock` with the right `index`
 * (top → before, bottom → after this block). The user no longer has to learn
 * the "/" slash menu.
 *
 * The `+` rails appear on hover OR focus-within so keyboard users get them
 * too. Drag-to-reorder is provided by the parent (`SimpleStackEditor`) via
 * dnd-kit; this component just renders a `data-drag-handle` button that the
 * parent's `useSortable` hook attaches to.
 */
interface Props {
  slug: Slug
  /** Section that owns this block (where insertBlock posts to). */
  sectionId: Ulid
  /** Current index of this block inside its section. */
  index: number
  /** Whether the editor is in fullEdit mode — when false we render children as-is. */
  active: boolean
  /** The block being wrapped — needed by BlockResizeWrapper for meta + patch. */
  block: Block
  children: ReactNode
  /** Drag handle: parent passes the dnd-kit listeners + setNodeRef when sortable. */
  dragListeners?: Record<string, unknown>
  dragSetActivatorRef?: (el: HTMLElement | null) => void
  /** Optional: when present, palette also offers a "delete" action via this callback. */
  onRequestDelete?: () => void
}

export function BlockHoverInserter({
  slug,
  sectionId,
  index,
  active,
  block,
  children,
  dragListeners,
  dragSetActivatorRef,
  onRequestDelete,
}: Props) {
  const etag = useEditorStore((s) => s.etag)
  const apply = useEditorStore((s) => s.applyServerSnapshot)
  const setConflict = useEditorStore((s) => s.setConflict)

  // Either null (closed) or { side, anchor } describing which rail the user
  // clicked. We keep one piece of state so only one palette can be open per
  // block at a time.
  type Open = { side: 'before' | 'after'; anchor: { x: number; y: number } }
  const [open, setOpen] = useState<Open | null>(null)

  const onPick = useCallback(
    async (it: PaletteItem) => {
      if (!open) return
      // For "image" the palette returns null — delegate to the existing
      // image-picker dropzone (Sprint 4) which the toolbar already wires up
      // via the same custom event.
      if (it.kind === 'image') {
        window.dispatchEvent(new CustomEvent('mxwp:open-image-picker'))
        setOpen(null)
        return
      }
      const block = it.build()
      if (!block || !etag) {
        setOpen(null)
        return
      }
      const insertIdx = open.side === 'before' ? index : index + 1
      try {
        const result = await insertBlock(
          slug,
          { section_id: sectionId, index: insertIdx, block },
          etag,
          `${it.label} 추가`,
        )
        apply(result.document, result.etag)
      } catch (err) {
        if (isPreconditionFailed(err)) setConflict(null)
      } finally {
        setOpen(null)
      }
    },
    [open, etag, slug, sectionId, index, apply, setConflict],
  )

  const onRailClick = useCallback(
    (side: 'before' | 'after') => (e: ReactMouseEvent) => {
      // Anchor the palette to the click coords so it pops up exactly where
      // the user looked. Falls back to the rail's bounding rect for keyboard.
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      setOpen({
        side,
        anchor: { x: e.clientX || rect.left + rect.width / 2, y: e.clientY || rect.bottom },
      })
    },
    [],
  )

  if (!active) {
    // Reader / quick-edit mode: skip the +/drag/delete affordances. Still apply
    // any persisted width/height via the resize wrapper (handles disabled when
    // !active) so the rendered size is consistent across modes.
    return (
      <BlockResizeWrapper slug={slug} block={block} active={false}>
        {children}
      </BlockResizeWrapper>
    )
  }

  return (
    <div
      data-block-hover-inserter
      data-block-index={index}
      className="group/block relative"
    >
      {/* Top + rail. Visible on hover/focus-within OR while the palette is
          open, so the rail doesn't disappear under the cursor when the user
          moves to the popover. */}
      <button
        type="button"
        aria-label="이 블록 위에 추가"
        data-rail="top"
        onClick={onRailClick('before')}
        className={`absolute -top-3 left-0 right-0 z-10 flex h-3 items-center justify-center opacity-0 transition-opacity group-hover/block:opacity-100 group-focus-within/block:opacity-100 focus-visible:opacity-100 ${
          open?.side === 'before' ? 'opacity-100' : ''
        }`}
      >
        <span className="pointer-events-none flex h-3 w-full items-center">
          <span className="h-px flex-1 bg-smsg-300" />
          <span className="mx-1 inline-flex h-5 w-5 items-center justify-center rounded-full border border-smsg-500 bg-white text-xs font-bold text-smsg-700 shadow-sm dark:bg-gray-900">
            +
          </span>
          <span className="h-px flex-1 bg-smsg-300" />
        </span>
      </button>

      {/* Left drag handle. Only meaningful when dndListeners are passed in. */}
      {dragListeners && (
        <button
          type="button"
          ref={(el) => dragSetActivatorRef?.(el)}
          aria-label="블록 이동 (드래그)"
          data-drag-handle
          {...(dragListeners as Record<string, never>)}
          className="absolute -left-7 top-1 inline-flex h-6 w-6 cursor-grab items-center justify-center rounded text-gray-400 opacity-0 transition-opacity hover:bg-gray-100 hover:text-smsg-700 group-hover/block:opacity-100 active:cursor-grabbing dark:hover:bg-gray-800"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <circle cx="3" cy="3" r="1" fill="currentColor" />
            <circle cx="9" cy="3" r="1" fill="currentColor" />
            <circle cx="3" cy="6" r="1" fill="currentColor" />
            <circle cx="9" cy="6" r="1" fill="currentColor" />
            <circle cx="3" cy="9" r="1" fill="currentColor" />
            <circle cx="9" cy="9" r="1" fill="currentColor" />
          </svg>
        </button>
      )}

      {/* Optional delete on the right edge. Only renders when the parent
          provided `onRequestDelete`. */}
      {onRequestDelete && (
        <button
          type="button"
          aria-label="블록 삭제"
          onClick={onRequestDelete}
          className="absolute -right-7 top-1 inline-flex h-6 w-6 items-center justify-center rounded text-gray-400 opacity-0 transition-opacity hover:bg-red-50 hover:text-red-600 group-hover/block:opacity-100"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      )}

      <BlockResizeWrapper slug={slug} block={block} active>
        {children}
      </BlockResizeWrapper>

      {/* Bottom + rail. */}
      <button
        type="button"
        aria-label="이 블록 아래에 추가"
        data-rail="bottom"
        onClick={onRailClick('after')}
        className={`absolute -bottom-3 left-0 right-0 z-10 flex h-3 items-center justify-center opacity-0 transition-opacity group-hover/block:opacity-100 group-focus-within/block:opacity-100 focus-visible:opacity-100 ${
          open?.side === 'after' ? 'opacity-100' : ''
        }`}
      >
        <span className="pointer-events-none flex h-3 w-full items-center">
          <span className="h-px flex-1 bg-smsg-300" />
          <span className="mx-1 inline-flex h-5 w-5 items-center justify-center rounded-full border border-smsg-500 bg-white text-xs font-bold text-smsg-700 shadow-sm dark:bg-gray-900">
            +
          </span>
          <span className="h-px flex-1 bg-smsg-300" />
        </span>
      </button>

      {open && (
        <BlockInsertPalette
          anchor={open.anchor}
          onPick={(it) => void onPick(it)}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  )
}
