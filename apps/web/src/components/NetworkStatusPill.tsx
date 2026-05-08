import { useEffect, useState } from 'react'
import { useConnectionStore, deriveStatus } from '@/features/auth/connectionStore'

// 주의: Zustand v5 의 기본 selector 비교는 Object.is.
// `(s) => ({ ...slice })` 처럼 매 렌더에서 새 객체를 만들어 반환하면
// 항상 prev !== next 로 판정되어 무한 리렌더 → "Maximum update depth"
// → 흰 화면. 따라서 아래에서는 반드시 *스칼라* 필드만 개별 selector 로 읽는다.

/**
 * Compact connection-status pill rendered inside the TopBar. Three states:
 *
 *   online       → nothing rendered (avoid noise on the happy path)
 *   reconnecting → amber pill "응답이 늦습니다…"
 *   offline      → red pill "오프라인 — 마지막 데이터 표시 중"
 *
 * Combines two signals:
 *   1. `navigator.onLine` for the hard offline case (the OS just dropped wifi).
 *   2. `useConnectionStore` for soft failures (5xx / network lag detected by
 *      the axios interceptor).
 */
export function NetworkStatusPill() {
  const [browserOnline, setBrowserOnline] = useState<boolean>(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  )
  const lastSuccessAt = useConnectionStore((s) => s.lastSuccessAt)
  const lastFailureAt = useConnectionStore((s) => s.lastFailureAt)
  const consecutiveFailures = useConnectionStore((s) => s.consecutiveFailures)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const onOnline = () => setBrowserOnline(true)
    const onOffline = () => setBrowserOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  const status = !browserOnline
    ? 'offline'
    : deriveStatus({ lastSuccessAt, lastFailureAt, consecutiveFailures })
  if (status === 'online') return null

  const isOffline = status === 'offline'
  return (
    <span
      role="status"
      aria-live="polite"
      className={
        isOffline
          ? 'inline-flex items-center gap-1 rounded-full border border-red-300 bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-800'
          : 'inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-900'
      }
    >
      <span
        aria-hidden="true"
        className={isOffline ? 'h-1.5 w-1.5 rounded-full bg-red-500' : 'h-1.5 w-1.5 rounded-full bg-amber-500'}
      />
      {isOffline ? '오프라인 — 마지막 데이터 표시 중' : '응답이 늦습니다…'}
    </span>
  )
}
