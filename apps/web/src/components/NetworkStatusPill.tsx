import { useEffect, useState } from 'react'
import { useConnectionStore, deriveStatus } from '@/features/auth/connectionStore'
import { useConnectionStore as useEditorConnectionStore } from '@/features/editor/connectionStore'

// 주의: Zustand v5 의 기본 selector 비교는 Object.is.
// `(s) => ({ ...slice })` 처럼 매 렌더에서 새 객체를 만들어 반환하면
// 항상 prev !== next 로 판정되어 무한 리렌더 → "Maximum update depth"
// → 흰 화면. 따라서 아래에서는 반드시 *스칼라* 필드만 개별 selector 로 읽는다.

const UNSTABLE_PING_MS = 30_000

/**
 * Compact connection-status pill rendered inside the TopBar. Four visual
 * states (Sprint 5 expansion):
 *
 *   online    → 🟢  hidden (no noise on happy path)
 *   unstable  → 🟡  amber pill "응답이 늦습니다…"  (last heartbeat > 30s ago)
 *   offline   → 🔴  red pill "오프라인 — 마지막 데이터 표시 중"
 *
 * Combines three signals:
 *   1. `navigator.onLine` (hard offline — OS-level drop).
 *   2. `useEditorConnectionStore.online` / `lastPing` (heartbeat-based).
 *   3. `useConnectionStore` from auth (soft failures from axios interceptors).
 *
 * Tooltip exposes "마지막 동기화: HH:mm:ss" so users can sanity-check freshness.
 */
export function NetworkStatusPill() {
  const [browserOnline, setBrowserOnline] = useState<boolean>(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  )
  const lastSuccessAt = useConnectionStore((s) => s.lastSuccessAt)
  const lastFailureAt = useConnectionStore((s) => s.lastFailureAt)
  const consecutiveFailures = useConnectionStore((s) => s.consecutiveFailures)
  const editorOnline = useEditorConnectionStore((s) => s.online)
  const lastPing = useEditorConnectionStore((s) => s.lastPing)

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

  const now = Date.now()
  const lastSync = lastPing ?? lastSuccessAt
  const stalePing = lastSync != null && now - lastSync > UNSTABLE_PING_MS

  const status: 'online' | 'unstable' | 'offline' = !browserOnline || !editorOnline
    ? 'offline'
    : stalePing
      ? 'unstable'
      : deriveStatus({ lastSuccessAt, lastFailureAt, consecutiveFailures }) === 'reconnecting'
        ? 'unstable'
        : 'online'

  if (status === 'online') return null

  const isOffline = status === 'offline'
  const tooltip = lastSync
    ? `마지막 동기화: ${new Date(lastSync).toLocaleTimeString('ko-KR', { hour12: false })}`
    : '마지막 동기화: 없음'

  return (
    <span
      role="status"
      aria-live="polite"
      title={tooltip}
      data-status={status}
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
