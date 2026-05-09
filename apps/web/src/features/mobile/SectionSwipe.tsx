import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useGestures } from './useGestures'

/**
 * SectionSwipe — invisible overlay that wraps a wiki article on mobile and
 * converts horizontal swipes into level-1 section navigation.
 *
 * Design notes
 *  - Only listens on viewports < `MOBILE_MAX_PX`. Desktop / tablet ignore
 *    the gesture entirely.
 *  - Skips when the swipe origin is inside a `[data-no-swipe]` element so
 *    horizontally-scrollable surfaces (TableBlock, CodeBlock) don't get
 *    hijacked.
 *  - Animates the article via a brief `translateX` flash so the swipe feels
 *    like a page turn, then scrolls the new heading into view.
 */

export const MOBILE_MAX_PX = 768
export const SWIPE_FLASH_MS = 200

export interface SectionSwipeProps {
  /** Ordered list of level-1 section IDs (used to look up `#section-...`). */
  sectionIds: string[]
  children: ReactNode
}

/** Pure helper: which `sectionIds` index is the new target after a swipe? */
export function nextSectionIndex(
  current: number,
  total: number,
  dir: 'left' | 'right',
): number | null {
  if (total === 0) return null
  // 'left' = swipe finger leftward = advance to *next* section.
  const target = dir === 'left' ? current + 1 : current - 1
  if (target < 0 || target >= total) return null
  return target
}

/**
 * Should this swipe be skipped? True when the gesture began inside a marked
 * scrollable element (table / code block).
 */
export function isSwipeBlocked(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return target.closest('[data-no-swipe]') != null
}

export function SectionSwipe({ sectionIds, children }: SectionSwipeProps) {
  const ref = useRef<HTMLDivElement>(null)
  const indexRef = useRef(0)
  // Track the most recent pointerdown target to feed isSwipeBlocked.
  const lastDownTargetRef = useRef<EventTarget | null>(null)
  const [flash, setFlash] = useState<'left' | 'right' | null>(null)

  // Capture the original target — useGestures only surfaces the cardinal
  // direction. A capture-phase pointerdown fires before useGestures resolves
  // its swipe, so the latest value is always the right one.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onDown = (e: PointerEvent) => {
      lastDownTargetRef.current = e.target
    }
    el.addEventListener('pointerdown', onDown, true)
    return () => el.removeEventListener('pointerdown', onDown, true)
  }, [])

  useGestures(ref, {
    onSwipe: (dir) => {
      if (typeof window === 'undefined') return
      if (window.innerWidth >= MOBILE_MAX_PX) return
      if (dir !== 'left' && dir !== 'right') return
      if (isSwipeBlocked(lastDownTargetRef.current)) return

      const target = nextSectionIndex(indexRef.current, sectionIds.length, dir)
      if (target == null) return
      indexRef.current = target
      setFlash(dir)
      // Tiny 200ms slide reset → CSS does the actual transition.
      window.setTimeout(() => setFlash(null), SWIPE_FLASH_MS)

      // Scroll the new section's heading into view.
      const id = sectionIds[target]
      const node = id ? document.getElementById(id) ?? document.getElementById(`section-${id}`) : null
      if (node) node.scrollIntoView({ behavior: 'smooth', block: 'start' })
    },
  })

  return (
    <div
      ref={ref}
      data-section-swipe
      data-flash={flash ?? ''}
      style={{
        transition: `transform ${SWIPE_FLASH_MS}ms ease-out`,
        transform:
          flash === 'left'
            ? 'translateX(-12px)'
            : flash === 'right'
              ? 'translateX(12px)'
              : 'translateX(0)',
      }}
    >
      {children}
    </div>
  )
}
