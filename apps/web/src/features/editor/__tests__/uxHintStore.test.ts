import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest'

/**
 * In-memory localStorage shim — same shape as `sectionCollapseStore.test.ts`
 * so the persistence branches exercise inside the node-only test runner.
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

import { useUxHintStore, UX_HINT_STORAGE_KEY } from '../uxHintStore'

function ls(): MemoryStorage {
  return (globalThis as unknown as { window: { localStorage: MemoryStorage } }).window
    .localStorage
}

describe('uxHintStore', () => {
  beforeEach(() => {
    ls().clear()
    useUxHintStore.setState({ shown: {} })
  })

  it('returns true the first time and false thereafter', () => {
    expect(useUxHintStore.getState().shouldShow('block-affordances')).toBe(true)
    // Subsequent calls return false because the hint is already marked shown.
    expect(useUxHintStore.getState().shouldShow('block-affordances')).toBe(false)
  })

  it('persists the dismissal to localStorage', () => {
    useUxHintStore.getState().shouldShow('block-resize')
    const blob = ls().getItem(UX_HINT_STORAGE_KEY)
    expect(blob).toBeTruthy()
    expect(JSON.parse(blob!)).toEqual({ 'block-resize': true })
  })

  it('markShown() is idempotent', () => {
    useUxHintStore.getState().markShown('block-affordances')
    useUxHintStore.getState().markShown('block-affordances')
    expect(useUxHintStore.getState().shown).toEqual({ 'block-affordances': true })
  })

  it('separate hint kinds are tracked independently', () => {
    expect(useUxHintStore.getState().shouldShow('block-affordances')).toBe(true)
    expect(useUxHintStore.getState().shouldShow('block-resize')).toBe(true)
    expect(useUxHintStore.getState().shouldShow('block-affordances')).toBe(false)
    expect(useUxHintStore.getState().shouldShow('block-resize')).toBe(false)
  })

  it('hydrate() rebuilds the map from storage', () => {
    ls().setItem(
      UX_HINT_STORAGE_KEY,
      JSON.stringify({ 'block-affordances': true }),
    )
    useUxHintStore.getState().hydrate()
    expect(useUxHintStore.getState().shouldShow('block-affordances')).toBe(false)
    expect(useUxHintStore.getState().shouldShow('block-resize')).toBe(true)
  })

  it('hydrate() ignores corrupted blobs', () => {
    ls().setItem(UX_HINT_STORAGE_KEY, '{not json')
    useUxHintStore.getState().hydrate()
    expect(useUxHintStore.getState().shown).toEqual({})
  })
})
