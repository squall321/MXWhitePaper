import { useEffect, useState } from 'react'

/**
 * PerformanceBadge — dev-mode only counter for the LazyBlockSlot wrapper.
 *
 * Mounts inside the SimpleStackEditor (and is therefore present once per
 * level-1 section in full-edit mode). Only renders visible content when the
 * URL contains `?perf=1` so production users never see it.
 *
 * What it does: every 1s, scans the DOM for `[data-lazy-slot]` markers and
 * counts how many are hydrated (`data-lazy-hydrated="true"`) vs out-of-view
 * placeholders. Surfaces a tiny pill in the bottom-right corner so QA can
 * verify the virtualization is actually doing its job.
 */
export function PerformanceBadge() {
  const enabled = useIsPerfEnabled()
  const [counts, setCounts] = useState<{ hydrated: number; total: number }>({
    hydrated: 0,
    total: 0,
  })

  useEffect(() => {
    if (!enabled) return
    if (typeof document === 'undefined') return
    const tick = () => {
      const all = document.querySelectorAll<HTMLElement>('[data-lazy-slot]')
      let hydrated = 0
      all.forEach((el) => {
        if (el.dataset.lazyHydrated === 'true') hydrated += 1
      })
      setCounts({ hydrated, total: all.length })
    }
    tick()
    const id = window.setInterval(tick, 1_000)
    return () => window.clearInterval(id)
  }, [enabled])

  if (!enabled) return null

  const offscreen = Math.max(0, counts.total - counts.hydrated)

  return (
    <div
      data-perf-badge
      // Pinned to viewport bottom-right; high z-index so it floats above
      // any block content. Inline styles to avoid touching tokens.css.
      style={{
        position: 'fixed',
        right: '12px',
        bottom: '12px',
        zIndex: 9999,
        background: 'rgba(15, 23, 42, 0.85)',
        color: '#fff',
        padding: '6px 10px',
        borderRadius: '999px',
        font: '12px system-ui, sans-serif',
        pointerEvents: 'none',
      }}
      aria-live="polite"
    >
      초기 렌더 {counts.hydrated}개 / 화면 밖 {offscreen}개
    </div>
  )
}

/**
 * Read `?perf=1` from the URL once on mount. Re-checks when the location
 * changes (so SPA nav into a `?perf=1` URL flips it on without a reload).
 */
function useIsPerfEnabled(): boolean {
  const [enabled, setEnabled] = useState<boolean>(() => readPerfFromLocation())
  useEffect(() => {
    function refresh() {
      setEnabled(readPerfFromLocation())
    }
    window.addEventListener('popstate', refresh)
    return () => window.removeEventListener('popstate', refresh)
  }, [])
  return enabled
}

function readPerfFromLocation(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const sp = new URLSearchParams(window.location.search)
    return sp.get('perf') === '1'
  } catch {
    return false
  }
}
