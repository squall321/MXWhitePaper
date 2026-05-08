import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest'

/**
 * In-memory localStorage shim — matches the pattern used by the recent/store
 * tests so the persistence branches in sectionCollapseStore actually fire
 * inside the node-only test runner.
 */
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
  useSectionCollapseStore,
  SECTION_COLLAPSE_STORAGE_KEY,
} from '../sectionCollapseStore'

function ls(): MemoryStorage {
  return (globalThis as unknown as { window: { localStorage: MemoryStorage } }).window
    .localStorage
}

describe('sectionCollapseStore', () => {
  beforeEach(() => {
    ls().clear()
    // Re-hydrate so the in-memory store mirrors the freshly-cleared storage.
    useSectionCollapseStore.setState({ map: {} })
  })

  it('starts with an empty map', () => {
    expect(useSectionCollapseStore.getState().map).toEqual({})
    expect(useSectionCollapseStore.getState().isCollapsed('foo', 's1')).toBe(false)
  })

  it('toggle() flips state and persists to localStorage', () => {
    const { toggle } = useSectionCollapseStore.getState()
    toggle('docA', 'sec1')
    expect(useSectionCollapseStore.getState().isCollapsed('docA', 'sec1')).toBe(true)
    // Storage blob mirrors the change.
    const blob = ls().getItem(SECTION_COLLAPSE_STORAGE_KEY)
    expect(blob).toBeTruthy()
    expect(JSON.parse(blob!)).toEqual({ docA: { sec1: true } })

    // Toggling again clears it and removes the slug entry from storage.
    useSectionCollapseStore.getState().toggle('docA', 'sec1')
    expect(useSectionCollapseStore.getState().isCollapsed('docA', 'sec1')).toBe(false)
    expect(ls().getItem(SECTION_COLLAPSE_STORAGE_KEY)).toBeNull()
  })

  it('setCollapsed() forces a target state', () => {
    const { setCollapsed } = useSectionCollapseStore.getState()
    setCollapsed('docA', 'sec1', false) // no-op when already absent
    expect(useSectionCollapseStore.getState().map).toEqual({})
    setCollapsed('docA', 'sec1', true)
    expect(useSectionCollapseStore.getState().isCollapsed('docA', 'sec1')).toBe(true)
    setCollapsed('docA', 'sec1', false)
    expect(useSectionCollapseStore.getState().isCollapsed('docA', 'sec1')).toBe(false)
  })

  it('expandAll() drops every entry for the slug', () => {
    const s = useSectionCollapseStore.getState()
    s.toggle('docA', 'a1')
    s.toggle('docA', 'a2')
    s.toggle('docB', 'b1')
    expect(useSectionCollapseStore.getState().isCollapsed('docA', 'a1')).toBe(true)
    expect(useSectionCollapseStore.getState().isCollapsed('docA', 'a2')).toBe(true)

    useSectionCollapseStore.getState().expandAll('docA')
    expect(useSectionCollapseStore.getState().isCollapsed('docA', 'a1')).toBe(false)
    expect(useSectionCollapseStore.getState().isCollapsed('docA', 'a2')).toBe(false)
    // Other slugs untouched.
    expect(useSectionCollapseStore.getState().isCollapsed('docB', 'b1')).toBe(true)
  })

  it('collapseAll() collapses the supplied IDs', () => {
    useSectionCollapseStore.getState().collapseAll('docA', ['a1', 'a2', 'a3'])
    const m = useSectionCollapseStore.getState().map.docA
    expect(m).toEqual({ a1: true, a2: true, a3: true })
    // Storage persisted.
    const blob = ls().getItem(SECTION_COLLAPSE_STORAGE_KEY)
    expect(JSON.parse(blob!)).toEqual({ docA: { a1: true, a2: true, a3: true } })
  })

  it('hydrate() reloads from localStorage', () => {
    ls().setItem(
      SECTION_COLLAPSE_STORAGE_KEY,
      JSON.stringify({ docX: { secY: true } }),
    )
    useSectionCollapseStore.getState().hydrate()
    expect(useSectionCollapseStore.getState().isCollapsed('docX', 'secY')).toBe(true)
  })

  it('hydrate() ignores corrupted blobs', () => {
    ls().setItem(SECTION_COLLAPSE_STORAGE_KEY, '{not json')
    useSectionCollapseStore.getState().hydrate()
    expect(useSectionCollapseStore.getState().map).toEqual({})
  })

  it('ignores empty slug / sectionId arguments', () => {
    const s = useSectionCollapseStore.getState()
    s.toggle('', 'sec1')
    s.toggle('docA', '')
    s.setCollapsed('', '', true)
    expect(useSectionCollapseStore.getState().map).toEqual({})
    expect(s.isCollapsed('', 'sec1')).toBe(false)
  })
})
