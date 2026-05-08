import { useEffect, useState } from 'react'

/**
 * `useSlowFetch(isFetching, thresholdMs?)` returns `true` when a query has
 * been in-flight longer than `thresholdMs` (default 5s). Components use the
 * flag to render a quiet "응답이 늦습니다…" mini banner so the user knows the
 * spinner isn't stuck.
 *
 * Safe to call unconditionally: when `isFetching` flips to false the timer
 * is cleared and `slow` resets.
 */
export function useSlowFetch(isFetching: boolean, thresholdMs = 5000): boolean {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    if (!isFetching) {
      setSlow(false)
      return
    }
    const handle = window.setTimeout(() => setSlow(true), thresholdMs)
    return () => window.clearTimeout(handle)
  }, [isFetching, thresholdMs])
  return slow
}

/**
 * Tiny inline banner — caller renders it conditionally via `useSlowFetch`.
 * Stateless on purpose so it's trivial to drop into existing components.
 */
export function SlowFetchBanner({ label = '응답이 늦습니다…' }: { label?: string }) {
  return (
    <p
      role="status"
      aria-live="polite"
      className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-900"
    >
      {label}
    </p>
  )
}
