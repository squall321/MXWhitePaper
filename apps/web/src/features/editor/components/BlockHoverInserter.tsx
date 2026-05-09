import { useState, useCallback, useEffect, useRef, type ReactNode, type MouseEvent as ReactMouseEvent } from 'react'
import type { Block, Slug, Ulid } from '@/types/document'
import { insertBlock, isPreconditionFailed } from '../api'
import { useEditorStore } from '../state'
import { useUxHintStore } from '../uxHintStore'
import { BlockInsertPalette, type PaletteItem } from './BlockInsertPalette'
import { BlockResizeWrapper } from './BlockResizeWrapper'
import { SnippetPicker } from '@/features/block-library/SnippetPicker'

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
 *
 * The first hover (per browser) also pops a 4-second hint chip explaining
 * the three affordances — once dismissed, it never returns.
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
  // Snippet picker side-channel — opening keeps the rail context (side) so we
  // know which index to insert at when the user picks a snippet.
  const [snippetSide, setSnippetSide] = useState<'before' | 'after' | null>(null)

  // First-time-only affordance hint. The chip auto-fades after 4s.
  const [hintVisible, setHintVisible] = useState(false)
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (hintTimer.current) clearTimeout(hintTimer.current)
    }
  }, [])

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
      if (it.kind === 'snippet') {
        // Defer to the snippet picker — preserve `open.side` so we know
        // whether to insert before or after the wrapped block.
        setSnippetSide(open.side)
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

  const onInsertSnippetBlocks = useCallback(
    async (blocks: Block[]) => {
      const side = snippetSide
      if (!side) return
      // Insert sequentially so the etag chain stays consistent — each
      // insertBlock returns a fresh doc + etag. Start index depends on the
      // rail; subsequent blocks land after the previously-inserted one.
      let cursor = side === 'before' ? index : index + 1
      for (const b of blocks) {
        const tag = useEditorStore.getState().etag
        if (!tag) break
        try {
          const result = await insertBlock(
            slug,
            { section_id: sectionId, index: cursor, block: b },
            tag,
            '스니펫 삽입',
          )
          apply(result.document, result.etag)
          cursor++
        } catch (err) {
          if (isPreconditionFailed(err)) setConflict(null)
          break
        }
      }
      setSnippetSide(null)
    },
    [snippetSide, index, slug, sectionId, apply, setConflict],
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

  const onWrapperEnter = useCallback(() => {
    if (!active) return
    // shouldShow returns true the very first time and persists the dismissal.
    const fire = useUxHintStore.getState().shouldShow('block-affordances')
    if (!fire) return
    setHintVisible(true)
    hintTimer.current = setTimeout(() => setHintVisible(false), 4000)
  }, [active])

  const dismissHint = useCallback(() => {
    setHintVisible(false)
    if (hintTimer.current) {
      clearTimeout(hintTimer.current)
      hintTimer.current = null
    }
  }, [])

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
      onMouseEnter={onWrapperEnter}
      className="group/block relative"
    >
      {/* Top + rail. Visible on hover/focus-within OR while the palette is
          open, so the rail doesn't disappear under the cursor when the user
          moves to the popover. */}
      <button
        type="button"
        aria-label="이 블록 위에 추가"
        title="이 블록 위에 새 블록을 추가합니다"
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
          title="끌어서 블록 순서 변경"
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
          title="이 블록 삭제"
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
        title="이 블록 아래에 새 블록을 추가합니다"
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

      {/* First-time-only hint chip. Sits above the block so it doesn't
          obscure the content. Auto-fades after 4s; the X dismisses early.
          We render two stacked lines: one for the affordance row, one for
          the resize handles below. */}
      {hintVisible && (
        <div
          role="status"
          aria-live="polite"
          data-testid="block-affordance-hint"
          className="pointer-events-none absolute -top-10 left-0 right-0 z-20 flex justify-center"
        >
          <div className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-smsg-300 bg-white/95 px-3 py-1 text-[11px] text-smsg-900 shadow-md backdrop-blur dark:border-gray-700 dark:bg-gray-900/95 dark:text-gray-100">
            <span aria-hidden>💡</span>
            <span>← 클릭으로 위에 추가  ·  끌어 옮기기  ·  삭제 →</span>
            <button
              type="button"
              aria-label="힌트 닫기"
              onClick={dismissHint}
              className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800"
            >
              ✕
            </button>
          </div>
        </div>
      )}
      {hintVisible && (
        <div
          aria-hidden="true"
          data-testid="block-affordance-hint-resize"
          className="pointer-events-none absolute -bottom-10 left-0 right-0 z-20 flex justify-center"
        >
          <div className="inline-flex items-center gap-2 rounded-full border border-smsg-200 bg-white/95 px-3 py-1 text-[11px] text-smsg-700 shadow-md backdrop-blur dark:border-gray-700 dark:bg-gray-900/95 dark:text-gray-300">
            ↗ 모서리 끌어서 크기 조정
          </div>
        </div>
      )}

      {open && (
        <BlockInsertPalette
          anchor={open.anchor}
          onPick={(it) => void onPick(it)}
          onClose={() => setOpen(null)}
        />
      )}

      {snippetSide && (
        <SnippetPicker
          onClose={() => setSnippetSide(null)}
          onInsert={(blocks) => void onInsertSnippetBlocks(blocks)}
        />
      )}
    </div>
  )
}
