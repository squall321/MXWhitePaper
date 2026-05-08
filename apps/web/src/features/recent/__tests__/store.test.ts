import { describe, it, expect, beforeEach, vi, afterEach, beforeAll, afterAll } from 'vitest'

// Vitest runs in node by default — no DOM. Install a tiny in-memory
// localStorage shim on globalThis.window so the store's
// `typeof window !== 'undefined'` branches actually fire and the test can
// inspect the persisted blob.
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

import { useRecentStore, pushRecent, STORAGE_KEY, MAX_ENTRIES } from '../store'

describe('recent/store', () => {
  beforeEach(() => {
    ;(globalThis as unknown as { window: { localStorage: MemoryStorage } }).window.localStorage.clear()
    useRecentStore.getState().clear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts empty', () => {
    expect(useRecentStore.getState().items).toEqual([])
  })

  it('push() inserts a new entry', () => {
    pushRecent('foo', 'Foo Doc')
    const items = useRecentStore.getState().items
    expect(items).toHaveLength(1)
    expect(items[0]?.slug).toBe('foo')
    expect(items[0]?.title).toBe('Foo Doc')
    expect(typeof items[0]?.viewedAt).toBe('number')
  })

  it('push() dedupes by slug and refreshes viewedAt to the top', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-08T00:00:00Z'))
    pushRecent('a', 'A')
    vi.setSystemTime(new Date('2026-05-08T00:01:00Z'))
    pushRecent('b', 'B')
    vi.setSystemTime(new Date('2026-05-08T00:02:00Z'))
    pushRecent('a', 'A revisited')

    const items = useRecentStore.getState().items
    expect(items).toHaveLength(2)
    expect(items[0]?.slug).toBe('a')
    expect(items[0]?.title).toBe('A revisited')
    expect(items[1]?.slug).toBe('b')
  })

  it('caps the list at 20 entries (MAX_ENTRIES)', () => {
    expect(MAX_ENTRIES).toBe(20)
    for (let i = 0; i < 25; i++) {
      pushRecent(`slug-${i}`, `Doc ${i}`)
    }
    const items = useRecentStore.getState().items
    expect(items).toHaveLength(20)
    // Most recent push (slug-24) is at the head.
    expect(items[0]?.slug).toBe('slug-24')
    // Oldest survivors should be slug-5 .. slug-24 (5 was the first kept).
    expect(items[items.length - 1]?.slug).toBe('slug-5')
  })

  it('items are sorted by viewedAt DESC', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    pushRecent('old', 'Old')
    vi.setSystemTime(new Date('2026-01-02T00:00:00Z'))
    pushRecent('mid', 'Mid')
    vi.setSystemTime(new Date('2026-01-03T00:00:00Z'))
    pushRecent('new', 'New')

    const items = useRecentStore.getState().items.map((it) => it.slug)
    expect(items).toEqual(['new', 'mid', 'old'])
  })

  it('persists to localStorage under mxwp.recentDocs', () => {
    pushRecent('persist', 'Persist Doc')
    const raw = (globalThis as unknown as { window: { localStorage: MemoryStorage } }).window.localStorage.getItem(STORAGE_KEY)
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw!) as Array<{ slug: string }>
    expect(parsed[0]?.slug).toBe('persist')
  })

  it('hydrate() reads back from localStorage', () => {
    ;(globalThis as unknown as { window: { localStorage: MemoryStorage } }).window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([{ slug: 'a', title: 'A', viewedAt: 1 }]),
    )
    useRecentStore.getState().hydrate()
    expect(useRecentStore.getState().items).toEqual([
      { slug: 'a', title: 'A', viewedAt: 1 },
    ])
  })

  it('remove() drops a single entry', () => {
    pushRecent('a', 'A')
    pushRecent('b', 'B')
    useRecentStore.getState().remove('a')
    const items = useRecentStore.getState().items
    expect(items).toHaveLength(1)
    expect(items[0]?.slug).toBe('b')
  })

  it('clear() empties everything (and storage)', () => {
    pushRecent('a', 'A')
    useRecentStore.getState().clear()
    expect(useRecentStore.getState().items).toEqual([])
    const raw = (globalThis as unknown as { window: { localStorage: MemoryStorage } }).window.localStorage.getItem(STORAGE_KEY)
    expect(raw).toBe('[]')
  })

  it('ignores empty slug', () => {
    pushRecent('', 'no slug')
    expect(useRecentStore.getState().items).toEqual([])
  })

  it('truncates pathologically long titles to 200 chars', () => {
    const longTitle = 'x'.repeat(500)
    pushRecent('longy', longTitle)
    const items = useRecentStore.getState().items
    expect(items[0]?.title.length).toBe(200)
  })
})
