import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest'

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

import {
  useNotificationsStore,
  pushNotification,
  STORAGE_KEY,
  MAX_ENTRIES,
} from '../store'

describe('notifications/store', () => {
  beforeEach(() => {
    ;(globalThis as unknown as { window: { localStorage: MemoryStorage } }).window.localStorage.clear()
    useNotificationsStore.getState().clear()
  })

  it('starts empty', () => {
    expect(useNotificationsStore.getState().items).toEqual([])
    expect(useNotificationsStore.getState().unread).toBe(0)
  })

  it('push() inserts a new unread entry and bumps the unread count', () => {
    pushNotification({ category: 'activity', message: '저장되었습니다', slug: 'foo' })
    const s = useNotificationsStore.getState()
    expect(s.items).toHaveLength(1)
    expect(s.items[0]?.message).toBe('저장되었습니다')
    expect(s.items[0]?.read).toBe(false)
    expect(s.unread).toBe(1)
  })

  it('caps the queue at MAX_ENTRIES (50)', () => {
    expect(MAX_ENTRIES).toBe(50)
    for (let i = 0; i < 60; i++) {
      pushNotification({ category: 'system', message: `n-${i}` })
    }
    const s = useNotificationsStore.getState()
    expect(s.items).toHaveLength(50)
    expect(s.items[0]?.message).toBe('n-59') // newest at the head
  })

  it('markRead() flips a single notification', () => {
    const a = pushNotification({ category: 'activity', message: 'A' })
    const b = pushNotification({ category: 'activity', message: 'B' })
    useNotificationsStore.getState().markRead(a.id)
    const s = useNotificationsStore.getState()
    expect(s.unread).toBe(1)
    expect(s.items.find((x) => x.id === a.id)?.read).toBe(true)
    expect(s.items.find((x) => x.id === b.id)?.read).toBe(false)
  })

  it('markAllRead() clears the unread badge', () => {
    pushNotification({ category: 'activity', message: 'A' })
    pushNotification({ category: 'system', message: 'B' })
    useNotificationsStore.getState().markAllRead()
    const s = useNotificationsStore.getState()
    expect(s.unread).toBe(0)
    expect(s.items.every((it) => it.read)).toBe(true)
  })

  it('clear() empties everything', () => {
    pushNotification({ category: 'activity', message: 'A' })
    useNotificationsStore.getState().clear()
    const s = useNotificationsStore.getState()
    expect(s.items).toEqual([])
    expect(s.unread).toBe(0)
  })

  it('persists to localStorage under mxwp.notifications', () => {
    pushNotification({ category: 'comment', message: '댓글이 달렸습니다' })
    const raw = (globalThis as unknown as { window: { localStorage: MemoryStorage } }).window.localStorage.getItem(STORAGE_KEY)
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw!) as Array<{ message: string }>
    expect(parsed[0]?.message).toBe('댓글이 달렸습니다')
  })

  it('hydrate() reads back from localStorage', () => {
    ;(globalThis as unknown as { window: { localStorage: MemoryStorage } }).window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        { id: 'n-1', message: 'old', category: 'system', createdAt: 1, read: false },
      ]),
    )
    useNotificationsStore.getState().hydrate()
    const s = useNotificationsStore.getState()
    expect(s.items).toHaveLength(1)
    expect(s.unread).toBe(1)
  })

  it('discards entries that fail the schema check on hydrate', () => {
    ;(globalThis as unknown as { window: { localStorage: MemoryStorage } }).window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        { id: 'good', message: 'ok', category: 'system', createdAt: 1, read: false },
        { id: 'bad-cat', message: 'x', category: 'NOT_A_CAT', createdAt: 2, read: false },
        { message: 'no-id', category: 'system', createdAt: 3, read: false },
      ]),
    )
    useNotificationsStore.getState().hydrate()
    expect(useNotificationsStore.getState().items).toHaveLength(1)
  })

  it('truncates pathological message lengths', () => {
    const long = 'x'.repeat(1000)
    pushNotification({ category: 'system', message: long })
    const m = useNotificationsStore.getState().items[0]?.message ?? ''
    expect(m.length).toBeLessThanOrEqual(280)
  })
})
