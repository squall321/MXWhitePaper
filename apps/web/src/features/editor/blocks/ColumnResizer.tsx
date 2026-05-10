import { useEffect, useRef } from 'react'

interface Props {
  /** Column index (used for aria-label only). */
  col: number
  /**
   * Live "what's this column currently sized at" reader. We measure on
   * mousedown so the drag delta is added to the actual rendered width
   * (not whatever stale value the schema has). Pass the parent <th>'s
   * `getBoundingClientRect().width` getter.
   */
  getCurrentWidth: () => number
  /**
   * Fired continuously while the user drags so the parent can update the
   * column-width style for live visual feedback. The parent's debounced
   * save then ships the final value.
   */
  onResize: (widthPx: number) => void
}

const MIN_W = 40
const MAX_W = 1200

/**
 * Drag-handle grip rendered on the right edge of a column header. Mouse
 * down → enter drag state, attach window-level move/up listeners so the
 * pointer can leave the cell without breaking the gesture; mouse up →
 * detach. Uses pointer events so touch-on-trackpad works too. Keyboard
 * left/right resize is also wired in (a11y).
 */
export function ColumnResizer({ col, getCurrentWidth, onResize }: Props) {
  const stateRef = useRef<{ startX: number; startW: number } | null>(null)

  // Always keep window listeners detached when the component unmounts mid-drag.
  useEffect(() => {
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onMove = (e: PointerEvent) => {
    const s = stateRef.current
    if (!s) return
    const next = Math.max(MIN_W, Math.min(MAX_W, s.startW + (e.clientX - s.startX)))
    onResize(next)
  }
  const onUp = () => {
    stateRef.current = null
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }
  const onDown = (e: React.PointerEvent<HTMLSpanElement>) => {
    // Don't let a drag-start bubble up to the column header (which would
    // open the column menu) or steal focus from any cell input.
    e.stopPropagation()
    e.preventDefault()
    stateRef.current = { startX: e.clientX, startW: getCurrentWidth() }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    // Hint cursor + lock selection so dragging across the table doesn't
    // accidentally select a bunch of text.
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }
  const onKey = (e: React.KeyboardEvent<HTMLSpanElement>) => {
    // Keyboard a11y — left/right adjusts width by 8 px.
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      const cur = getCurrentWidth()
      const step = e.shiftKey ? 32 : 8
      const next = Math.max(MIN_W, Math.min(MAX_W, cur + (e.key === 'ArrowRight' ? step : -step)))
      onResize(next)
    }
  }
  return (
    <span
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label={`${col + 1}열 너비 조정`}
      data-action="resize-column"
      onPointerDown={onDown}
      onKeyDown={onKey}
      // Sit on the right edge — wide-ish hit target so users don't have to
      // be pixel-perfect. The visible bar is centred; the hover region
      // extends ~6 px each side via padding for forgiveness.
      className="absolute right-0 top-0 z-10 flex h-full w-2 cursor-col-resize touch-none items-center justify-center select-none opacity-0 transition-opacity hover:opacity-100 group-hover/col:opacity-100 focus:opacity-100"
    >
      <span aria-hidden="true" className="block h-4 w-0.5 rounded bg-smsg-500" />
    </span>
  )
}
