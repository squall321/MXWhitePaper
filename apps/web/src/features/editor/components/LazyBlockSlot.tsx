import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Block } from '@/types/document'

/**
 * LazyBlockSlot — IntersectionObserver-driven hydration for long block lists.
 *
 * Long sections (>50 blocks) render every block lazily: the wrapper renders a
 * fixed-height `<div>` placeholder until the slot enters the viewport (or
 * within 200px of it). On entry, `children` is mounted and the real block
 * paints. When the slot stays out-of-view for >5s the children unmount again
 * and we revert to a placeholder sized at the last-measured height — this
 * keeps the document's total scroll height stable so dnd-kit's drop-target
 * math doesn't drift.
 *
 * dnd-kit compatibility: the slot is purely the *content* of a sortable item.
 * The parent (SortableBlock) owns the draggable ref + `data-sortable-block-id`
 * and that wrapper stays mounted regardless of whether children are hydrated.
 * That means drag still picks up the right block when its content is napping.
 *
 * SSR / node-test path: `useEffect` does not run, so the initial render shows
 * a placeholder. That's what the long-doc integration test asserts on. Small
 * docs never instantiate LazyBlockSlot (the parent only wraps when blocks > 50)
 * so SSR for normal-sized sections is unaffected.
 */

interface Props {
  block: Block
  children: ReactNode
  /** Override estimated height. Default looks up by block.type. */
  estimatedHeight?: number
}

/**
 * Per-block-type estimated initial heights. Used until the slot has been
 * hydrated once — after that we switch to the last-measured cached height
 * so re-entering the viewport doesn't flicker.
 *
 * Numbers come from the spec sheet — a coarse "reasonable median" per kind.
 */
const HEIGHT_BY_TYPE: ReadonlyMap<string, number> = new Map([
  ['paragraph', 80],
  ['heading-4', 80],
  ['quote', 80],
  ['callout', 80],
  ['math', 80],
  ['list', 120],
  ['code', 200],
  ['kpi-cards', 200],
  ['table', 300],
  ['image', 300],
  ['video', 300],
  ['iframe', 300],
  ['chart', 400],
  ['gantt', 400],
  ['flow', 400],
  ['org-chart', 400],
  ['whiteboard', 400],
])

const DEFAULT_HEIGHT = 200

/** Module-level cache of measured heights keyed by block id. */
const measuredHeights = new Map<string, number>()

/** Test-only — clear the measured-height cache between cases. */
export function __resetMeasuredHeightsForTests(): void {
  measuredHeights.clear()
}

/** Look up an estimate (caller may override). Falls back to DEFAULT_HEIGHT. */
export function estimateBlockHeight(block: Block, override?: number): number {
  if (typeof override === 'number') return override
  const cached = measuredHeights.get(block.id)
  if (typeof cached === 'number' && cached > 0) return cached
  const fromType = HEIGHT_BY_TYPE.get(block.type)
  return typeof fromType === 'number' ? fromType : DEFAULT_HEIGHT
}

/**
 * Threshold (px) before/after the viewport edge — a slot within this margin
 * starts hydrating. Generous so a fast scroll doesn't outrun the IO event.
 */
export const ROOT_MARGIN = '200px 0px 200px 0px'

/** IO threshold — fire on the first pixel of overlap. */
export const THRESHOLD = 0

/** Out-of-view delay (ms) before we tear down children to free memory. */
export const UNMOUNT_DELAY_MS = 5_000

export function LazyBlockSlot({ block, children, estimatedHeight }: Props) {
  const ref = useRef<HTMLDivElement | null>(null)
  // Start un-hydrated. The IO callback flips this to true on first entry.
  // Note: in SSR / node-test environment useEffect won't run so the slot
  // stays at the placeholder — that's the desired initial state.
  const [hydrated, setHydrated] = useState<boolean>(false)
  const unmountTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') {
      // Older browsers / jsdom without polyfill — fall back to "always
      // hydrated" so the slot at least renders. We still keep the wrapper
      // div so the DOM shape matches the lazy path.
      setHydrated(true)
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            // Cancel any pending tear-down — we're back in view.
            if (unmountTimerRef.current !== null) {
              clearTimeout(unmountTimerRef.current)
              unmountTimerRef.current = null
            }
            setHydrated(true)
            // Snapshot the rendered height so the next placeholder paints
            // at the right size. We read on intersection rather than every
            // frame to keep this cheap.
            const h = entry.boundingClientRect.height
            if (h > 0) measuredHeights.set(block.id, h)
          } else {
            // Schedule a tear-down. If we re-enter before the timer fires
            // the intersecting branch above clears it.
            if (unmountTimerRef.current === null) {
              unmountTimerRef.current = setTimeout(() => {
                // Final height snapshot before we strip children — useful
                // for blocks whose height changed since last measurement.
                const node = ref.current
                if (node) {
                  const h = node.getBoundingClientRect().height
                  if (h > 0) measuredHeights.set(block.id, h)
                }
                setHydrated(false)
                unmountTimerRef.current = null
              }, UNMOUNT_DELAY_MS)
            }
          }
        }
      },
      { rootMargin: ROOT_MARGIN, threshold: THRESHOLD },
    )
    observer.observe(el)

    return () => {
      observer.disconnect()
      if (unmountTimerRef.current !== null) {
        clearTimeout(unmountTimerRef.current)
        unmountTimerRef.current = null
      }
    }
    // We intentionally re-observe when the block id changes (different block
    // moved into this slot key — rare, but cheap to re-observe).
  }, [block.id])

  const placeholderHeight = estimateBlockHeight(block, estimatedHeight)

  return (
    <div
      ref={ref}
      data-lazy-slot
      data-lazy-block-id={block.id}
      data-lazy-hydrated={hydrated ? 'true' : 'false'}
      style={hydrated ? undefined : { minHeight: `${placeholderHeight}px` }}
    >
      {hydrated ? children : null}
    </div>
  )
}

/** Long-section threshold — only kick in lazy hydration when blocks > THIS. */
export const LAZY_THRESHOLD = 50
