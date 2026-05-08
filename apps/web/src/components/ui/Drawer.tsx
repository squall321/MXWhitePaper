import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { cn } from './cn'

export interface DrawerProps {
  open: boolean
  onClose: () => void
  side?: 'left' | 'right' | 'bottom'
  width?: string
  className?: string
  ariaLabel: string
  children: ReactNode
  /** Disable touch swipe-to-close on mobile (left/right drawers only). */
  disableSwipe?: boolean
  /** Disable the drag handle / fullscreen expansion (bottom drawer only). */
  disableDragHandle?: boolean
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Slide-in side panel. Used as the mobile equivalent of the AppShell's
 * left tree and right TOC rails.
 *
 * - Click backdrop or press Esc to close.
 * - Focus is moved into the drawer on open and returned on close.
 * - Tab traps cycle focus inside the drawer.
 * - Mobile left/right drawers support swipe-to-close in their natural axis.
 * - Bottom drawer ships with a drag handle that toggles fullscreen.
 * - Sets `body.overflow=hidden` while open.
 * - `prefers-reduced-motion` is respected via global tokens.css rule.
 */
export function Drawer({
  open,
  onClose,
  side = 'left',
  width = '85vw',
  className,
  ariaLabel,
  children,
  disableSwipe = false,
  disableDragHandle = false,
}: DrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const lastFocusRef = useRef<Element | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [dragOffset, setDragOffset] = useState(0)
  const dragStateRef = useRef<{ x: number; y: number; pointerId: number } | null>(null)

  useEffect(() => {
    if (!open) return
    lastFocusRef.current = document.activeElement
    setFullscreen(false)
    setDragOffset(0)
    const r = requestAnimationFrame(() => {
      const panel = panelRef.current
      if (!panel) return
      const focusable = panel.querySelector<HTMLElement>(FOCUSABLE)
      ;(focusable ?? panel).focus()
    })
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      if (e.key === 'Tab' && panelRef.current) {
        trapTab(e, panelRef.current)
      }
    }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      cancelAnimationFrame(r)
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
      const last = lastFocusRef.current
      if (last instanceof HTMLElement) last.focus()
    }
  }, [open, onClose])

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (disableSwipe || side === 'bottom') return
      // Pointer events from buttons, inputs, links should not start a drag.
      const target = e.target as HTMLElement
      if (target.closest('input, textarea, select, button, a')) return
      dragStateRef.current = { x: e.clientX, y: e.clientY, pointerId: e.pointerId }
    },
    [disableSwipe, side],
  )
  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const s = dragStateRef.current
      if (!s || s.pointerId !== e.pointerId) return
      const dx = e.clientX - s.x
      // Constrain drag to the closing axis only.
      if (side === 'left' && dx < 0) setDragOffset(dx)
      else if (side === 'right' && dx > 0) setDragOffset(dx)
    },
    [side],
  )
  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const s = dragStateRef.current
      if (!s || s.pointerId !== e.pointerId) return
      dragStateRef.current = null
      const THRESHOLD = 80
      if (Math.abs(dragOffset) > THRESHOLD) {
        onClose()
      }
      setDragOffset(0)
    },
    [dragOffset, onClose],
  )

  if (!open) return null

  const panelPos =
    side === 'left'
      ? 'left-0 top-0 h-full anim-slideL'
      : side === 'right'
        ? 'right-0 top-0 h-full anim-slideR'
        : 'bottom-0 left-0 right-0 anim-slideUp'

  const panelSize =
    side === 'bottom'
      ? fullscreen
        ? { width: '100%', maxHeight: '100vh', height: '100vh' }
        : { width: '100%', maxHeight: '85vh' }
      : { width, maxWidth: '420px' }

  const transform = dragOffset === 0 ? undefined : `translateX(${dragOffset}px)`

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      className="fixed inset-0 z-drawer bg-black/40 anim-fade"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className={cn(
          'absolute bg-white shadow-lg overflow-y-auto outline-none',
          panelPos,
          className,
        )}
        style={{ ...panelSize, transform }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          dragStateRef.current = null
          setDragOffset(0)
        }}
      >
        {side === 'bottom' && !disableDragHandle && (
          <DragHandle
            fullscreen={fullscreen}
            onToggle={() => setFullscreen((v) => !v)}
            onCollapseClose={onClose}
          />
        )}
        {children}
      </div>
    </div>
  )
}

function DragHandle({
  fullscreen,
  onToggle,
  onCollapseClose,
}: {
  fullscreen: boolean
  onToggle: () => void
  onCollapseClose: () => void
}) {
  // Tracks vertical drag distance so the handle behaves like a sheet on mobile.
  const startY = useRef<number | null>(null)
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      data-testid="drawer-drag-handle"
      onPointerDown={(e) => {
        startY.current = e.clientY
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        if (startY.current == null) return
        const dy = e.clientY - startY.current
        if (dy < -40 && !fullscreen) {
          startY.current = null
          onToggle()
        } else if (dy > 60 && fullscreen) {
          startY.current = null
          onToggle()
        } else if (dy > 80 && !fullscreen) {
          startY.current = null
          onCollapseClose()
        }
      }}
      onPointerUp={() => {
        startY.current = null
      }}
      onClick={() => onToggle()}
      className="flex w-full cursor-ns-resize items-center justify-center py-2"
    >
      <span aria-hidden="true" className="h-1 w-10 rounded-full bg-gray-300" />
    </div>
  )
}

function trapTab(e: KeyboardEvent, container: HTMLElement) {
  const focusables = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute('disabled'),
  )
  if (focusables.length === 0) {
    e.preventDefault()
    container.focus()
    return
  }
  const first = focusables[0]!
  const last = focusables[focusables.length - 1]!
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault()
    first.focus()
  }
}
