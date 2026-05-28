/**
 * Poll BE notifications every 30 s and replay new rows into the zustand
 * store so the bell badge + drawer reflect server-pushed events
 * (mentions, review requests/decisions, reactions, read-ack reminders,
 * reminders, retention warnings, …).
 *
 * Design notes:
 *   - Only polls when the auth store has a `user` — anonymous tabs make
 *     no requests.
 *   - TanStack Query pauses `refetchInterval` automatically when the tab
 *     is hidden / window blurred, so we don't add manual guards.
 *   - We dedupe by server id: only ids not already present in the store
 *     trigger a `push()`. Existing rows get their `read` flag synced when
 *     the BE flips `read_at`.
 *   - This hook should be mounted ONCE at the layout root (AppShell) —
 *     mounting it next to NotificationBell would reset polling whenever
 *     the bell re-renders.
 */
import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@/features/auth/store'
import { listNotifications, type NotificationServerItem } from '../api'
import { useNotificationsStore } from '../store'
import { serverItemToStoreItem } from '../kindToMessage'

const POLL_INTERVAL_MS = 30_000
const POLL_LIMIT = 30

export const notificationsQueryKey = ['notifications', 'list'] as const

export interface UseNotificationPollingOptions {
  /** Override the poll cadence (used by tests). */
  intervalMs?: number
  /** Force-disable polling (used by tests). */
  enabled?: boolean
}

export function useNotificationPolling(
  opts: UseNotificationPollingOptions = {},
): void {
  const userId = useAuthStore((s) => s.user?.id ?? null)
  const enabled = opts.enabled ?? Boolean(userId)

  const query = useQuery<NotificationServerItem[]>({
    queryKey: notificationsQueryKey,
    queryFn: () => listNotifications({ limit: POLL_LIMIT }),
    enabled,
    refetchInterval: opts.intervalMs ?? POLL_INTERVAL_MS,
    // 4xx/5xx 는 retry 안 함 — interceptor 가 이미 401 처리.
    retry: false,
    refetchOnWindowFocus: true,
    staleTime: 10_000,
  })

  const rows = query.data
  useEffect(() => {
    if (!rows || rows.length === 0) return
    syncRowsIntoStore(rows)
  }, [rows])
}

/**
 * Pure helper extracted so the test can drive it without spinning up
 * a React tree. Idempotent — re-calling with the same rows is a no-op
 * because the store's `push()` dedupes by id.
 */
export function syncRowsIntoStore(rows: NotificationServerItem[]): void {
  const store = useNotificationsStore.getState()
  const existing = new Map(store.items.map((it) => [it.id, it]))
  for (const row of rows) {
    const mapped = serverItemToStoreItem(row)
    const prev = existing.get(mapped.id)
    if (!prev) {
      store.push(mapped)
      continue
    }
    // 서버에서 read_at 가 채워졌으면 로컬 read 도 맞춰 준다.
    if (mapped.read && !prev.read) {
      store.markRead(mapped.id)
    }
  }
}
