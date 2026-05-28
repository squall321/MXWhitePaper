/**
 * Polling-hook integration test.
 *
 * The repo has no `@testing-library/react`, so React-side rendering is done
 * via `renderToStaticMarkup` (the established pattern). The pure
 * `syncRowsIntoStore` helper is exercised directly to cover the merge logic
 * (new row → push, existing read=false→true, dedupe).
 *
 * The hook itself is sanity-checked with `renderToStaticMarkup` to confirm
 * mounting it with `enabled: false` does NOT call `listNotifications` (the
 * unauthenticated guard).
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('@/lib/api/client', () => ({
  apiClient: { get: vi.fn(), post: vi.fn() },
}))

class MemoryStorage {
  private data = new Map<string, string>()
  getItem(k: string): string | null {
    return this.data.has(k) ? this.data.get(k)! : null
  }
  setItem(k: string, v: string): void {
    this.data.set(k, String(v))
  }
  removeItem(k: string): void {
    this.data.delete(k)
  }
  clear(): void {
    this.data.clear()
  }
  key(i: number): string | null {
    return Array.from(this.data.keys())[i] ?? null
  }
  get length(): number {
    return this.data.size
  }
}

const originalWindow = (globalThis as { window?: unknown }).window

beforeAll(() => {
  ;(globalThis as { window?: unknown }).window = {
    localStorage: new MemoryStorage(),
  }
})

afterAll(() => {
  if (originalWindow === undefined) {
    delete (globalThis as { window?: unknown }).window
  } else {
    ;(globalThis as { window?: unknown }).window = originalWindow
  }
})

import { apiClient } from '@/lib/api/client'
import { useNotificationsStore } from '../store'
import {
  syncRowsIntoStore,
  useNotificationPolling,
} from '../hooks/useNotificationPolling'
import type { NotificationServerItem } from '../api'

const get = apiClient.get as unknown as ReturnType<typeof vi.fn>

const newRow = (
  over: Partial<NotificationServerItem> = {},
): NotificationServerItem => ({
  id: '11111111-1111-1111-1111-111111111111',
  user_id: 'u-1',
  kind: 'comment_mention',
  payload: { slug: 'alpha', actor_name: '홍' },
  read_at: null,
  created_at: '2026-05-25T10:00:00Z',
  ...over,
})

describe('syncRowsIntoStore', () => {
  beforeEach(() => {
    ;(globalThis as unknown as { window: { localStorage: MemoryStorage } }).window.localStorage.clear()
    useNotificationsStore.getState().clear()
    get.mockReset()
  })

  it('pushes a brand-new server row into the store', () => {
    syncRowsIntoStore([newRow()])
    const s = useNotificationsStore.getState()
    expect(s.items).toHaveLength(1)
    expect(s.items[0]?.id).toBe('11111111-1111-1111-1111-111111111111')
    expect(s.unread).toBe(1)
  })

  it('preserves pre-existing local events (no wipe)', () => {
    useNotificationsStore.getState().push({
      category: 'system',
      message: '로컬 이벤트',
    })
    syncRowsIntoStore([newRow()])
    const s = useNotificationsStore.getState()
    // 1 local + 1 server.
    expect(s.items).toHaveLength(2)
    const ids = s.items.map((it) => it.id)
    expect(ids).toContain('11111111-1111-1111-1111-111111111111')
  })

  it('does not re-push when the same id arrives again', () => {
    syncRowsIntoStore([newRow()])
    syncRowsIntoStore([newRow()])
    expect(useNotificationsStore.getState().items).toHaveLength(1)
  })

  it('flips local read flag when server reports read_at', () => {
    syncRowsIntoStore([newRow()])
    expect(useNotificationsStore.getState().unread).toBe(1)
    syncRowsIntoStore([newRow({ read_at: '2026-05-25T11:00:00Z' })])
    expect(useNotificationsStore.getState().unread).toBe(0)
  })
})

describe('useNotificationPolling', () => {
  beforeEach(() => {
    ;(globalThis as unknown as { window: { localStorage: MemoryStorage } }).window.localStorage.clear()
    useNotificationsStore.getState().clear()
    get.mockReset()
  })

  it('does not call the BE when enabled=false (anonymous tab)', () => {
    function Probe() {
      useNotificationPolling({ enabled: false })
      return null
    }
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    renderToStaticMarkup(
      <QueryClientProvider client={qc}>
        <Probe />
      </QueryClientProvider>,
    )
    expect(get).not.toHaveBeenCalled()
  })
})
