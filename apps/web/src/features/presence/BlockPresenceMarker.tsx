/**
 * BlockPresenceMarker — fixed-position dots in the right margin showing
 * which blocks other users currently anchor on.
 *
 * Approach: render one absolute-positioned dot per `anchor_block_id` reported
 * by `usePresence`. Position is derived from `getBoundingClientRect` of the
 * matching `[data-block-id="..."]` element, polled every 200ms. We keep the
 * overlay layer outside any block subtree so no internal block component is
 * touched.
 */
import { useEffect, useState } from 'react'
import { usePresence } from './usePresence'

const POLL_MS = 200

interface MarkerSpec {
  blockId: string
  top: number
  /** How many users anchor on this block. */
  count: number
}

export interface BlockPresenceMarkerProps {
  slug: string | undefined
}

function findBlockTop(blockId: string): number | null {
  if (typeof document === 'undefined') return null
  const el = document.querySelector(`[data-block-id="${blockId}"]`)
  if (!el) return null
  const rect = (el as HTMLElement).getBoundingClientRect()
  // Convert viewport-relative top → document-relative so the dot doesn't
  // jump as the user scrolls.
  return rect.top + window.scrollY
}

export function BlockPresenceMarker({ slug }: BlockPresenceMarkerProps) {
  const { others } = usePresence(slug)
  const [markers, setMarkers] = useState<MarkerSpec[]>([])

  useEffect(() => {
    if (!others || others.length === 0) {
      setMarkers([])
      return
    }
    const counts = new Map<string, number>()
    for (const u of others) {
      if (!u.anchor_block_id) continue
      counts.set(u.anchor_block_id, (counts.get(u.anchor_block_id) ?? 0) + 1)
    }
    if (counts.size === 0) {
      setMarkers([])
      return
    }

    let cancelled = false
    const tick = () => {
      if (cancelled) return
      const next: MarkerSpec[] = []
      for (const [blockId, count] of counts.entries()) {
        const top = findBlockTop(blockId)
        if (top != null) next.push({ blockId, top, count })
      }
      // Avoid pointless setState churn — only update when something changed.
      setMarkers((prev) => {
        if (
          prev.length === next.length &&
          prev.every(
            (m, i) =>
              next[i] &&
              m.blockId === next[i]!.blockId &&
              Math.abs(m.top - next[i]!.top) < 1 &&
              m.count === next[i]!.count,
          )
        ) {
          return prev
        }
        return next
      })
    }
    tick()
    const id = window.setInterval(tick, POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [others])

  if (markers.length === 0) return null

  return (
    <div
      data-testid="block-presence-overlay"
      aria-hidden="true"
      style={{
        position: 'absolute',
        top: 0,
        right: 4,
        width: 12,
        height: 0,
        pointerEvents: 'none',
        zIndex: 30,
      }}
    >
      {markers.map((m) => (
        <span
          key={m.blockId}
          data-testid={`block-presence-${m.blockId}`}
          title={`${m.count}명이 이 블록을 보고 있습니다`}
          style={{
            position: 'absolute',
            top: m.top,
            right: 0,
            width: 8,
            height: 8,
            borderRadius: 9999,
            background:
              m.count > 1 ? 'rgb(244 63 94)' : 'rgb(16 185 129)',
            boxShadow: '0 0 0 2px rgba(255,255,255,0.85)',
          }}
        />
      ))}
    </div>
  )
}
