import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import type { Block, Slug } from '@/types/document'
import { patchBlock, isPreconditionFailed } from '../api'
import { useEditorStore } from '../state'

/**
 * BlockResizeWrapper — wraps any block widget with optional pixel-precise
 * width/height (`block.meta.width`, `block.meta.height`). When `active` and
 * the type is in `RESIZEABLE_TYPES`, renders 3 drag handles (right edge,
 * bottom edge, bottom-right corner) so the user can drag-resize the block.
 *
 * Persistence flow:
 *   1. pointerdown on a handle → record origin + show "active" outline
 *   2. pointermove (after a 4px lift-off threshold) → update local state
 *      so the user gets pixel-by-pixel visual feedback. Backend untouched.
 *   3. pointerup → fire `patchBlock` ONCE with the snapped final size.
 *   4. Esc during drag → restore the original size, no backend call.
 *
 * Sizes are snapped to an 8px grid for visually-clean values, clamped to
 * sane min/max bounds (120/60 minimum, 4000 maximum from schema).
 *
 * Non-resizeable types (paragraph, list, etc.) still respect a stored
 * width/height if present in `meta` but don't render handles. This lets
 * future tools or imports set sizes without the UI letting users drag.
 */

export const SNAP = 8
export const MIN_W = 120
export const MIN_H = 60
export const MAX_W = 4000
export const MAX_H = 4000
export const LIFT_OFF = 4 // px the pointer must move before we treat it as a resize

/** Block types that show resize handles. Others can still carry meta.width/height
 *  but won't render the drag affordances. Exported so the block-collapse
 *  feature can derive its own (overlapping but stricter) "tall" set without
 *  drifting silently from this one. */
export const RESIZEABLE_TYPES: ReadonlySet<Block['type']> = new Set<Block['type']>([
  'image',
  'gallery',
  'video',
  'iframe',
  'chart',
  'table',
  'flow',
  'gantt',
  'org-chart',
  'math',
  'code',
  'kpi-cards',
  'dashboard-embed',
  'calculator',
  'file',
])

/**
 * Block types that get the per-block "접기" toggle in BlockRenderer.
 *
 * Subset of RESIZEABLE_TYPES — image/video/iframe/file are typically
 * controlled by the user with explicit dimensions, so collapsing them adds
 * little value. Containers (tabs/accordion/columns) have their own collapse
 * semantics (AccordionBlock has per-item state) so they're excluded here.
 */
export const COLLAPSIBLE_BLOCK_TYPES: ReadonlySet<Block['type']> = new Set<Block['type']>([
  'chart',
  'table',
  'code',
  'gallery',
  'gantt',
  'flow',
  'kpi-cards',
  'calculator',
  'dashboard-embed',
  'math',
  'org-chart',
])

export function snap(px: number): number {
  return Math.round(px / SNAP) * SNAP
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi)
}

/**
 * Pure version of the pointer-move math used by `BlockResizeWrapper`. Given
 * the active drag and a delta, return the next snapped+clamped (w,h) and
 * whether the pointer has crossed the lift-off threshold yet. Returning
 * `liftedOff: false` means the caller should NOT update local draft state
 * and the eventual pointerup must NOT call `patchBlock`.
 *
 * Exported so the unit-test can verify the threshold + snap behaviour
 * without spinning up a DOM (the project intentionally has no jsdom — see
 * the existing `auto-save.test.ts` rationale).
 */
export interface ResizeDragInput {
  kind: 'right' | 'bottom' | 'corner'
  startW: number
  startH: number
  liftedOff: boolean
}

export interface ResizeDragMoveResult {
  liftedOff: boolean
  w?: number
  h?: number
}

export function computeDragMove(
  drag: ResizeDragInput,
  dx: number,
  dy: number,
): ResizeDragMoveResult {
  const liftedOff =
    drag.liftedOff || Math.abs(dx) >= LIFT_OFF || Math.abs(dy) >= LIFT_OFF
  if (!liftedOff) return { liftedOff: false }
  const out: ResizeDragMoveResult = { liftedOff: true }
  if (drag.kind !== 'bottom') {
    out.w = clamp(snap(drag.startW + dx), MIN_W, MAX_W)
  }
  if (drag.kind !== 'right') {
    out.h = clamp(snap(drag.startH + dy), MIN_H, MAX_H)
  }
  return out
}

/**
 * Pure decision helper for `endDrag`: returns `true` only when the wrapper
 * should fire `patchBlock`. The two no-persist branches are:
 *   - `cancel === true` (user pressed Esc)
 *   - the pointer never moved past `LIFT_OFF` (an accidental click)
 */
export function shouldPersistOnEnd(
  drag: ResizeDragInput,
  cancel: boolean,
): boolean {
  if (cancel) return false
  return drag.liftedOff
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

interface Props {
  slug: Slug
  block: Block
  /** Whether the editor is in fullEdit mode — handles only render when true. */
  active: boolean
  children: ReactNode
}

type DragKind = 'right' | 'bottom' | 'corner'

interface DragState {
  kind: DragKind
  startX: number
  startY: number
  startW: number
  startH: number
  /** Did the pointer move past LIFT_OFF? Until then, we don't update state. */
  liftedOff: boolean
  /** Original meta values to restore on Esc-cancel. */
  origW: number | undefined
  origH: number | undefined
}

export function BlockResizeWrapper({ slug, block, active, children }: Props) {
  const etag = useEditorStore((s) => s.etag)
  const apply = useEditorStore((s) => s.applyServerSnapshot)
  const setConflict = useEditorStore((s) => s.setConflict)

  const metaW = typeof block.meta?.width === 'number' && block.meta.width > 0 ? block.meta.width : undefined
  const metaH = typeof block.meta?.height === 'number' && block.meta.height > 0 ? block.meta.height : undefined

  // Local override during a drag — null when the wrapper is just rendering meta.
  const [draftW, setDraftW] = useState<number | undefined>(undefined)
  const [draftH, setDraftH] = useState<number | undefined>(undefined)
  const dragRef = useRef<DragState | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [isResizing, setIsResizing] = useState(false)

  // When meta changes externally (e.g., another tab), drop any stale draft.
  useEffect(() => {
    if (!isResizing) {
      setDraftW(undefined)
      setDraftH(undefined)
    }
    // We deliberately depend only on meta values: we want to drop drafts when
    // the persisted size changes, not on every render.
  }, [metaW, metaH, isResizing])

  const showHandles = active && RESIZEABLE_TYPES.has(block.type)

  const effectiveW = draftW ?? metaW
  const effectiveH = draftH ?? metaH

  const persist = useCallback(
    async (w: number | undefined, h: number | undefined) => {
      if (!etag) return
      const nextMeta: Record<string, unknown> = { ...(block.meta ?? {}) }
      if (typeof w === 'number') nextMeta.width = w
      else delete nextMeta.width
      if (typeof h === 'number') nextMeta.height = h
      else delete nextMeta.height
      // Send the full block; PATCH /blocks/:id replaces the block. We mirror
      // the existing pattern (BlockHoverInserter etc.) of passing the merged
      // block as the patch body.
      const patched = { ...block, meta: nextMeta } as Block
      try {
        const result = await patchBlock(slug, block.id, patched, etag, '크기 조정')
        apply(result.document, result.etag)
      } catch (err) {
        if (isPreconditionFailed(err)) setConflict(null)
      }
    },
    [block, etag, slug, apply, setConflict],
  )

  const endDrag = useCallback(
    (cancel: boolean) => {
      const drag = dragRef.current
      dragRef.current = null
      setIsResizing(false)
      if (!drag) return
      if (!shouldPersistOnEnd(drag, cancel)) {
        // Esc or accidental click → restore original visuals, no BE call.
        setDraftW(undefined)
        setDraftH(undefined)
        return
      }
      // Compute final values from the latest container size (in case the
      // last move event hadn't flushed yet).
      const el = containerRef.current
      const finalW =
        drag.kind === 'bottom'
          ? drag.origW
          : el
            ? clamp(snap(el.offsetWidth), MIN_W, MAX_W)
            : undefined
      const finalH =
        drag.kind === 'right'
          ? drag.origH
          : el
            ? clamp(snap(el.offsetHeight), MIN_H, MAX_H)
            : undefined
      // Local immediate snap so there's no "jump" while we wait for BE.
      setDraftW(finalW)
      setDraftH(finalH)
      void persist(finalW, finalH).finally(() => {
        // After persist completes the meta will reflect the new size; clear
        // the draft so we re-read from meta.
        setDraftW(undefined)
        setDraftH(undefined)
      })
    },
    [persist],
  )

  // Global pointer/key listeners attached only while a drag is in progress.
  useEffect(() => {
    if (!isResizing) return
    const onMove = (e: PointerEvent) => {
      const drag = dragRef.current
      if (!drag) return
      const dx = e.clientX - drag.startX
      const dy = e.clientY - drag.startY
      const result = computeDragMove(drag, dx, dy)
      if (!result.liftedOff) return
      drag.liftedOff = true
      if (result.w !== undefined) setDraftW(result.w)
      if (result.h !== undefined) setDraftH(result.h)
    }
    const onUp = () => endDrag(false)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        endDrag(true)
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      window.removeEventListener('keydown', onKey)
    }
  }, [isResizing, endDrag])

  const startDrag = useCallback(
    (kind: DragKind) => (e: ReactPointerEvent<HTMLButtonElement>) => {
      if (!showHandles) return
      e.preventDefault()
      e.stopPropagation()
      const el = containerRef.current
      const startW = el?.offsetWidth ?? metaW ?? 0
      const startH = el?.offsetHeight ?? metaH ?? 0
      dragRef.current = {
        kind,
        startX: e.clientX,
        startY: e.clientY,
        startW,
        startH,
        liftedOff: false,
        origW: metaW,
        origH: metaH,
      }
      setIsResizing(true)
    },
    [showHandles, metaW, metaH],
  )

  // Style merging: width/height when set, max-width:100% so a too-wide stored
  // value can never overflow the editor column. overflow:auto when height is
  // set so users can scroll if they shrunk past the content.
  const reduceMotion = prefersReducedMotion()
  const wrapperStyle: CSSProperties = {
    width: typeof effectiveW === 'number' ? `${effectiveW}px` : undefined,
    height: typeof effectiveH === 'number' ? `${effectiveH}px` : undefined,
    maxWidth: typeof effectiveW === 'number' ? '100%' : undefined,
    overflow: typeof effectiveH === 'number' ? 'auto' : undefined,
    transition: isResizing || reduceMotion ? 'none' : 'width 120ms ease, height 120ms ease',
    position: 'relative',
  }

  return (
    <div
      ref={containerRef}
      data-block-resize-wrapper
      data-block-id={block.id}
      data-resizing={isResizing ? 'true' : undefined}
      className="group/resize relative"
      style={wrapperStyle}
    >
      {children}
      {showHandles && (
        <>
          {/* Right edge — drag horizontally */}
          <button
            type="button"
            aria-label="블록 너비 조정"
            tabIndex={-1}
            onPointerDown={startDrag('right')}
            className={`absolute top-0 right-0 bottom-0 z-[5] w-2 cursor-ew-resize touch-none select-none transition-opacity ${
              isResizing ? 'opacity-100' : 'opacity-0 group-hover/resize:opacity-100'
            }`}
          >
            <span
              aria-hidden="true"
              className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 h-10 w-1 rounded-full bg-smsg-400/70 shadow-sm"
            />
          </button>
          {/* Bottom edge — drag vertically */}
          <button
            type="button"
            aria-label="블록 높이 조정"
            tabIndex={-1}
            onPointerDown={startDrag('bottom')}
            className={`absolute bottom-0 left-0 right-0 z-[5] h-2 cursor-ns-resize touch-none select-none transition-opacity ${
              isResizing ? 'opacity-100' : 'opacity-0 group-hover/resize:opacity-100'
            }`}
          >
            <span
              aria-hidden="true"
              className="pointer-events-none absolute bottom-0 left-1/2 -translate-x-1/2 h-1 w-10 rounded-full bg-smsg-400/70 shadow-sm"
            />
          </button>
          {/* Bottom-right corner — drag both */}
          <button
            type="button"
            aria-label="블록 크기 조정"
            tabIndex={-1}
            onPointerDown={startDrag('corner')}
            className={`absolute bottom-0 right-0 z-[5] h-3 w-3 cursor-nwse-resize touch-none select-none transition-opacity ${
              isResizing ? 'opacity-100' : 'opacity-0 group-hover/resize:opacity-100'
            }`}
          >
            <span
              aria-hidden="true"
              className="pointer-events-none absolute bottom-0 right-0 h-2.5 w-2.5 rounded-sm border-r-2 border-b-2 border-smsg-500 bg-white shadow-sm"
            />
          </button>
          {isResizing && effectiveW != null && effectiveH != null && (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute -top-6 right-0 z-[5] rounded bg-smsg-700 px-1.5 py-0.5 text-[10px] font-mono text-white shadow"
            >
              {effectiveW}×{effectiveH}
            </span>
          )}
        </>
      )}
    </div>
  )
}
