import { useEffect, useRef, type RefObject } from 'react'

/**
 * useGestures — pointer-event based gesture detector for mobile UX.
 *
 * Why Pointer Events: a single API covers mouse / touch / pen and avoids the
 * dual `touchstart` + `mousedown` listener split most legacy code does.
 * Crucially, `pointerType` lets us only act on `'touch'` so desktop drag
 * interactions (text selection, link click) stay unaffected.
 *
 * Detected gestures (only on `pointerType === 'touch'`):
 *   - long-press   : single pointer held for ≥ LONG_PRESS_MS with movement < LONG_PRESS_SLOP
 *   - pinch        : 2 pointers; emits scale = currentDistance / startDistance
 *   - swipe        : single pointer, distance ≥ SWIPE_MIN_RATIO * viewport, duration ≤ SWIPE_MAX_MS
 *   - double-tap   : two `pointerup` taps within DOUBLE_TAP_MS at < DOUBLE_TAP_SLOP px apart
 *
 * The hook is a thin pointer-event harness around 4 *pure* decision helpers
 * (exported below) which are unit-tested in isolation. The same approach as
 * BlockResizeWrapper — keeps tests free of jsdom.
 */

export interface GestureHandlers {
  onLongPress?: (point: { x: number; y: number }) => void
  onPinch?: (scale: number) => void
  onSwipe?: (direction: 'left' | 'right' | 'up' | 'down') => void
  onDoubleTap?: (point: { x: number; y: number }) => void
}

// ---- Thresholds (exported for tests + downstream tuning) -------------------

/** Time the user must hold a single pointer for a long-press, in ms. */
export const LONG_PRESS_MS = 600
/** Max movement (CSS px) allowed during a long-press before it's cancelled. */
export const LONG_PRESS_SLOP = 8
/** Swipe must travel ≥ this fraction of the viewport's *short* axis. */
export const SWIPE_MIN_RATIO = 0.4
/** Swipe must complete within this many ms. */
export const SWIPE_MAX_MS = 600
/** Two `pointerup` events within this window (ms) qualify as a double-tap. */
export const DOUBLE_TAP_MS = 300
/** Max distance (CSS px) between the two taps of a double-tap. */
export const DOUBLE_TAP_SLOP = 24

// ---- Pure helpers ----------------------------------------------------------

export interface SwipeInput {
  dx: number
  dy: number
  durationMs: number
  /** Use the smaller axis so a portrait-mode short side still demands enough travel. */
  viewportShortPx: number
}

/**
 * Decide whether (and which way) a single-pointer release qualifies as a
 * swipe. Returns the cardinal direction or `null` to reject.
 *
 * Math: dominant axis wins; magnitude on the dominant axis must clear
 * `SWIPE_MIN_RATIO * viewportShortPx`; total time must be ≤ `SWIPE_MAX_MS`.
 */
export function classifySwipe(input: SwipeInput): 'left' | 'right' | 'up' | 'down' | null {
  const { dx, dy, durationMs, viewportShortPx } = input
  if (durationMs > SWIPE_MAX_MS || durationMs < 0) return null
  const minTravel = SWIPE_MIN_RATIO * viewportShortPx
  const absX = Math.abs(dx)
  const absY = Math.abs(dy)
  if (absX < minTravel && absY < minTravel) return null
  if (absX >= absY) return dx < 0 ? 'left' : 'right'
  return dy < 0 ? 'up' : 'down'
}

export interface DoubleTapState {
  /** Timestamp of the previous tap, or null if there's no pending first tap. */
  lastTapAt: number | null
  lastX: number
  lastY: number
}

export interface DoubleTapTap {
  at: number
  x: number
  y: number
}

/**
 * Stateless double-tap classifier. Returns either:
 *   - `{ kind: 'double', point }` when the new tap completes a double-tap; OR
 *   - `{ kind: 'first', state }` to stash the new tap as the pending first
 *     tap (caller persists this until the next tap or expiry).
 */
export function classifyTap(
  prev: DoubleTapState,
  tap: DoubleTapTap,
):
  | { kind: 'double'; point: { x: number; y: number } }
  | { kind: 'first'; state: DoubleTapState } {
  if (prev.lastTapAt != null) {
    const dt = tap.at - prev.lastTapAt
    const dx = tap.x - prev.lastX
    const dy = tap.y - prev.lastY
    const dist = Math.hypot(dx, dy)
    if (dt <= DOUBLE_TAP_MS && dt >= 0 && dist <= DOUBLE_TAP_SLOP) {
      return { kind: 'double', point: { x: tap.x, y: tap.y } }
    }
  }
  return {
    kind: 'first',
    state: { lastTapAt: tap.at, lastX: tap.x, lastY: tap.y },
  }
}

/** Euclidean distance between two pointer positions. */
export function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/**
 * Compute the pinch scale factor. Returns `null` if either distance is too
 * small to be meaningful (avoids divide-by-near-zero blow-ups when fingers
 * land on top of each other).
 */
export function pinchScale(startDist: number, currentDist: number): number | null {
  if (startDist < 1) return null
  return currentDist / startDist
}

// ---- The hook itself -------------------------------------------------------

interface ActivePointer {
  id: number
  startX: number
  startY: number
  curX: number
  curY: number
  startedAt: number
}

/**
 * useGestures — wires pointer events on the supplied ref. No-op on SSR.
 *
 * Why we don't `event.preventDefault()` aggressively: the surface above us
 * still wants to scroll vertically. We only call `preventDefault()` when a
 * pinch is active (2 pointers), to keep the browser from triggering its own
 * page-zoom while the user is two-finger-zooming our element.
 */
export function useGestures(
  ref: RefObject<HTMLElement>,
  handlers: GestureHandlers,
): void {
  // Keep handlers fresh across renders without re-binding listeners.
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (typeof window === 'undefined') return

    const pointers = new Map<number, ActivePointer>()
    let longPressTimer: ReturnType<typeof setTimeout> | null = null
    let pinchStartDist: number | null = null
    let lastTap: DoubleTapState = { lastTapAt: null, lastX: 0, lastY: 0 }

    const cancelLongPress = () => {
      if (longPressTimer != null) {
        clearTimeout(longPressTimer)
        longPressTimer = null
      }
    }

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return
      pointers.set(e.pointerId, {
        id: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        curX: e.clientX,
        curY: e.clientY,
        startedAt: e.timeStamp,
      })

      if (pointers.size === 1) {
        // Arm the long-press timer. Cancelled by movement or release.
        const x = e.clientX
        const y = e.clientY
        cancelLongPress()
        longPressTimer = setTimeout(() => {
          longPressTimer = null
          handlersRef.current.onLongPress?.({ x, y })
        }, LONG_PRESS_MS)
      } else if (pointers.size === 2) {
        cancelLongPress()
        const arr = Array.from(pointers.values())
        pinchStartDist = distance(
          { x: arr[0]!.curX, y: arr[0]!.curY },
          { x: arr[1]!.curX, y: arr[1]!.curY },
        )
      }
    }

    const onPointerMove = (e: PointerEvent) => {
      const p = pointers.get(e.pointerId)
      if (!p) return
      p.curX = e.clientX
      p.curY = e.clientY

      if (pointers.size === 1) {
        const dx = p.curX - p.startX
        const dy = p.curY - p.startY
        if (Math.hypot(dx, dy) > LONG_PRESS_SLOP) cancelLongPress()
      } else if (pointers.size === 2 && pinchStartDist != null) {
        // Active pinch: stop the browser from hijacking with native zoom.
        if (e.cancelable) e.preventDefault()
        const arr = Array.from(pointers.values())
        const cur = distance(
          { x: arr[0]!.curX, y: arr[0]!.curY },
          { x: arr[1]!.curX, y: arr[1]!.curY },
        )
        const scale = pinchScale(pinchStartDist, cur)
        if (scale != null) handlersRef.current.onPinch?.(scale)
      }
    }

    const onPointerEnd = (e: PointerEvent) => {
      const p = pointers.get(e.pointerId)
      if (!p) return
      pointers.delete(e.pointerId)
      cancelLongPress()

      // 2→1 pointer transition: pinch session ends. Don't classify the lone
      // remaining pointer as a swipe — it was part of the pinch.
      if (pinchStartDist != null) {
        if (pointers.size < 2) pinchStartDist = null
        return
      }

      // Single-pointer release: maybe a swipe, maybe a tap.
      if (pointers.size === 0) {
        const dx = p.curX - p.startX
        const dy = p.curY - p.startY
        const durationMs = e.timeStamp - p.startedAt

        // Swipe takes priority over tap (because it crossed the slop).
        if (Math.hypot(dx, dy) > LONG_PRESS_SLOP) {
          const dir = classifySwipe({
            dx,
            dy,
            durationMs,
            viewportShortPx: Math.min(window.innerWidth, window.innerHeight),
          })
          if (dir) {
            handlersRef.current.onSwipe?.(dir)
            // Reset double-tap memory — a swipe is not a tap.
            lastTap = { lastTapAt: null, lastX: 0, lastY: 0 }
            return
          }
        }

        // Tap candidate → feed the double-tap classifier.
        const result = classifyTap(lastTap, {
          at: e.timeStamp,
          x: p.curX,
          y: p.curY,
        })
        if (result.kind === 'double') {
          handlersRef.current.onDoubleTap?.(result.point)
          lastTap = { lastTapAt: null, lastX: 0, lastY: 0 }
        } else {
          lastTap = result.state
        }
      }
    }

    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointermove', onPointerMove)
    el.addEventListener('pointerup', onPointerEnd)
    el.addEventListener('pointercancel', onPointerEnd)
    el.addEventListener('pointerleave', onPointerEnd)

    return () => {
      cancelLongPress()
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('pointerup', onPointerEnd)
      el.removeEventListener('pointercancel', onPointerEnd)
      el.removeEventListener('pointerleave', onPointerEnd)
    }
  }, [ref])
}
