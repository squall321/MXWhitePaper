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

import { useFavoritesStore, STORAGE_KEY, isFavorited } from '../store'

describe('favorites/store', () => {
  beforeEach(() => {
    ;(globalThis as unknown as {
      window: { localStorage: MemoryStorage }
    }).window.localStorage.clear()
    useFavoritesStore.getState().clear()
  })

  it('add() inserts a new bookmark', () => {
    useFavoritesStore.getState().add('alpha', 'Alpha 문서')
    const items = useFavoritesStore.getState().items
    expect(items).toHaveLength(1)
    expect(items[0]?.slug).toBe('alpha')
    expect(items[0]?.title).toBe('Alpha 문서')
    expect(typeof items[0]?.starredAt).toBe('number')
  })

  it('add() dedupes by slug and keeps the newest title', () => {
    useFavoritesStore.getState().add('alpha', 'Old')
    useFavoritesStore.getState().add('alpha', 'New')
    const items = useFavoritesStore.getState().items
    expect(items).toHaveLength(1)
    expect(items[0]?.title).toBe('New')
  })

  it('remove() drops the matching slug', () => {
    useFavoritesStore.getState().add('alpha', 'A')
    useFavoritesStore.getState().add('beta', 'B')
    useFavoritesStore.getState().remove('alpha')
    const slugs = useFavoritesStore.getState().items.map((it) => it.slug)
    expect(slugs).toEqual(['beta'])
  })

  it('toggle() flips the bookmark state', () => {
    useFavoritesStore.getState().toggle('gamma', 'Gamma')
    expect(useFavoritesStore.getState().has('gamma')).toBe(true)
    useFavoritesStore.getState().toggle('gamma', 'Gamma')
    expect(useFavoritesStore.getState().has('gamma')).toBe(false)
  })

  it('persists to localStorage under mxwp.favorites', () => {
    useFavoritesStore.getState().add('persist', 'P')
    const raw = (
      globalThis as unknown as { window: { localStorage: MemoryStorage } }
    ).window.localStorage.getItem(STORAGE_KEY)
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw!) as Array<{ slug: string }>
    expect(parsed.map((it) => it.slug)).toEqual(['persist'])
  })

  it('hydrate() picks up externally-written rows', () => {
    const ls = (
      globalThis as unknown as { window: { localStorage: MemoryStorage } }
    ).window.localStorage
    ls.setItem(
      STORAGE_KEY,
      JSON.stringify([{ slug: 'ext', title: 'External', starredAt: Date.now() }]),
    )
    useFavoritesStore.getState().hydrate()
    expect(useFavoritesStore.getState().items.map((it) => it.slug)).toEqual(['ext'])
  })

  it('isFavorited() reflects the current store', () => {
    useFavoritesStore.getState().add('iota', 'I')
    expect(isFavorited('iota')).toBe(true)
    expect(isFavorited('missing')).toBe(false)
  })

  it('ignores non-array / corrupted JSON in storage', () => {
    const ls = (
      globalThis as unknown as { window: { localStorage: MemoryStorage } }
    ).window.localStorage
    ls.setItem(STORAGE_KEY, '{not json')
    useFavoritesStore.getState().hydrate()
    expect(useFavoritesStore.getState().items).toEqual([])
  })
})
