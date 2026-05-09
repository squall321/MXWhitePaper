/**
 * NotificationBell — TopBar bell icon + badge.
 *
 * The localStorage-backed store is the source of truth. We render the bell
 * shell (testid only) under SSR + verify the store-driven state transitions
 * directly. zustand 의 React 통합은 useSyncExternalStore 기반이라 SSR 에서
 * 초기 snapshot 만 잡히기 때문에, 변화 후 markup 을 assert 하는 대신 store 의
 * `unread` count + `markRead/markAllRead` 동작을 검증한다.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'

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

import { NotificationBell } from '../components/NotificationBell'
import { useNotificationsStore, pushNotification } from '../store'

describe('<NotificationBell />', () => {
  beforeEach(() => {
    ;(globalThis as unknown as { window: { localStorage: MemoryStorage } }).window.localStorage.clear()
    useNotificationsStore.getState().clear()
  })

  it('renders the bell button with the expected aria/testid', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <NotificationBell />
      </MemoryRouter>,
    )
    expect(html).toContain('data-testid="topbar-bell"')
    expect(html).toContain('aria-label="알림"')
  })

  it('pushes a comment-mention notification and tracks unread count', () => {
    pushNotification({ category: 'comment', message: '@you 멘션' })
    pushNotification({ category: 'system', message: '저장됨' })
    const s = useNotificationsStore.getState()
    expect(s.unread).toBe(2)
    expect(s.items[0]?.category).toBe('system') // newest at head
    expect(s.items[1]?.category).toBe('comment')
  })

  it('markRead clears a single unread + drops the count', () => {
    const a = pushNotification({ category: 'comment', message: 'A' })
    pushNotification({ category: 'system', message: 'B' })
    useNotificationsStore.getState().markRead(a.id)
    const s = useNotificationsStore.getState()
    expect(s.unread).toBe(1)
    expect(s.items.find((it) => it.id === a.id)?.read).toBe(true)
  })

  it('markAllRead drops the badge entirely', () => {
    pushNotification({ category: 'comment', message: '@you' })
    pushNotification({ category: 'comment', message: '@you2' })
    useNotificationsStore.getState().markAllRead()
    expect(useNotificationsStore.getState().unread).toBe(0)
    // 다시 렌더해도 badge 가 없다.
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <NotificationBell />
      </MemoryRouter>,
    )
    expect(html).not.toContain('data-testid="topbar-bell-badge"')
  })
})
