/**
 * useAnchorBlockTracker — find the topmost block currently in the
 * "middle slice" of the viewport (40% top / 40% bottom margins) and pipe
 * its block id into the presence module's anchor cache.
 *
 * Pure observer — does no network. `usePresence` reads the cache value on
 * each heartbeat tick.
 */
import { useEffect } from 'react'
import { setAnchorBlockId } from './usePresence'

export interface UseAnchorBlockTrackerOptions {
  /** Optional CSS selector — defaults to `[data-block-id]`. */
  selector?: string
}

export function useAnchorBlockTracker(
  slug: string | undefined,
  opts: UseAnchorBlockTrackerOptions = {},
): void {
  useEffect(() => {
    if (!slug) return
    if (typeof document === 'undefined' || typeof IntersectionObserver === 'undefined') {
      return
    }
    const selector = opts.selector ?? '[data-block-id]'
    const visible = new Map<string, number>()

    const recompute = () => {
      // Topmost (smallest top) wins.
      let bestId: string | null = null
      let bestTop = Number.POSITIVE_INFINITY
      for (const [id, top] of visible.entries()) {
        if (top < bestTop) {
          bestTop = top
          bestId = id
        }
      }
      setAnchorBlockId(slug, bestId)
    }

    const obs = new IntersectionObserver(
      (entries) => {
        for (const ent of entries) {
          const id = (ent.target as HTMLElement).getAttribute('data-block-id')
          if (!id) continue
          if (ent.isIntersecting) {
            visible.set(id, ent.boundingClientRect.top)
          } else {
            visible.delete(id)
          }
        }
        recompute()
      },
      {
        // Middle 20% slice — 40% top, 40% bottom margins crop the viewport.
        rootMargin: '-40% 0px -40% 0px',
        threshold: 0,
      },
    )

    const watched = new Set<Element>()
    const wireUp = () => {
      const els = document.querySelectorAll(selector)
      for (const el of Array.from(els)) {
        if (!watched.has(el)) {
          watched.add(el)
          obs.observe(el)
        }
      }
    }
    wireUp()
    // Re-attach when blocks are added/removed (dnd reorder, full edit toggle).
    const mutObs = new MutationObserver(wireUp)
    mutObs.observe(document.body, { childList: true, subtree: true })

    return () => {
      obs.disconnect()
      mutObs.disconnect()
      visible.clear()
      setAnchorBlockId(slug, null)
    }
  }, [slug, opts.selector])
}
