import { useEffect, useState } from 'react'

/**
 * One-line "📡 오프라인 — 캐시된 마지막 버전을 보고 있습니다" banner.
 * Appears when `navigator.onLine === false` (the cheap check). The SW
 * also stamps `X-Mxwp-Cache: hit` on cached doc fallbacks but we don't
 * read response headers from React Query in this slice — the connectivity
 * check is good enough for the visual indicator.
 *
 * SSR-safe: starts hidden, flips to visible on the client when offline.
 */
export function OfflineBanner() {
  const [offline, setOffline] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const sync = () => setOffline(!navigator.onLine)
    sync()
    window.addEventListener('online', sync)
    window.addEventListener('offline', sync)
    return () => {
      window.removeEventListener('online', sync)
      window.removeEventListener('offline', sync)
    }
  }, [])

  if (!offline) return null
  return (
    <div
      data-testid="pwa-offline-banner"
      role="status"
      className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900"
    >
      📡 오프라인 — 캐시된 마지막 버전을 보고 있습니다
    </div>
  )
}
