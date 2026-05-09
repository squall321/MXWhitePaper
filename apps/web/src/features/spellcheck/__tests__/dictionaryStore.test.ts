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
  useDictionaryStore,
  STORAGE_KEY,
} from '../dictionaryStore'

function ls(): MemoryStorage {
  return (globalThis as unknown as { window: { localStorage: MemoryStorage } })
    .window.localStorage
}

describe('spellcheck dictionaryStore', () => {
  beforeEach(() => {
    ls().clear()
    useDictionaryStore.getState().clear()
  })

  it('starts with an empty list', () => {
    expect(useDictionaryStore.getState().list()).toEqual([])
  })

  it('add() inserts a word and persists it', () => {
    useDictionaryStore.getState().add('MX')
    expect(useDictionaryStore.getState().has('MX')).toBe(true)
    expect(useDictionaryStore.getState().list()).toEqual(['MX'])
    const raw = ls().getItem(STORAGE_KEY)
    expect(raw).toBeTruthy()
    expect(JSON.parse(raw!)).toEqual(['MX'])
  })

  it('add() trims whitespace and rejects empty', () => {
    useDictionaryStore.getState().add('  hello  ')
    useDictionaryStore.getState().add('   ')
    useDictionaryStore.getState().add('')
    expect(useDictionaryStore.getState().list()).toEqual(['hello'])
  })

  it('add() de-duplicates', () => {
    useDictionaryStore.getState().add('foo')
    useDictionaryStore.getState().add('foo')
    expect(useDictionaryStore.getState().list()).toEqual(['foo'])
  })

  it('remove() deletes the word and persists', () => {
    useDictionaryStore.getState().add('foo')
    useDictionaryStore.getState().add('bar')
    useDictionaryStore.getState().remove('foo')
    expect(useDictionaryStore.getState().list()).toEqual(['bar'])
    expect(useDictionaryStore.getState().has('foo')).toBe(false)
    const raw = ls().getItem(STORAGE_KEY)
    expect(JSON.parse(raw!)).toEqual(['bar'])
  })

  it('remove() of an unknown word is a no-op', () => {
    useDictionaryStore.getState().add('foo')
    useDictionaryStore.getState().remove('nope')
    expect(useDictionaryStore.getState().list()).toEqual(['foo'])
  })

  it('has() trims input', () => {
    useDictionaryStore.getState().add('foo')
    expect(useDictionaryStore.getState().has('  foo  ')).toBe(true)
    expect(useDictionaryStore.getState().has('Foo')).toBe(false) // case-sensitive
  })

  it('hydrate() loads externally written words', () => {
    ls().setItem(STORAGE_KEY, JSON.stringify(['alpha', 'beta']))
    useDictionaryStore.getState().hydrate()
    expect(useDictionaryStore.getState().list()).toEqual(['alpha', 'beta'])
  })

  it('hydrate() is defensive against malformed JSON', () => {
    ls().setItem(STORAGE_KEY, '{not-json')
    useDictionaryStore.getState().hydrate()
    expect(useDictionaryStore.getState().list()).toEqual([])
  })

  it('hydrate() filters non-string entries', () => {
    ls().setItem(STORAGE_KEY, JSON.stringify(['ok', 42, null, 'good']))
    useDictionaryStore.getState().hydrate()
    expect(useDictionaryStore.getState().list()).toEqual(['ok', 'good'])
  })

  it('list() returns a copy (mutation does not affect store)', () => {
    useDictionaryStore.getState().add('foo')
    const copy = useDictionaryStore.getState().list()
    copy.push('mutated')
    expect(useDictionaryStore.getState().list()).toEqual(['foo'])
  })

  it('Korean words round-trip', () => {
    useDictionaryStore.getState().add('맞춤법')
    expect(useDictionaryStore.getState().has('맞춤법')).toBe(true)
    const raw = ls().getItem(STORAGE_KEY)
    expect(JSON.parse(raw!)).toEqual(['맞춤법'])
  })
})
