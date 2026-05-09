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
  useSpellcheckPrefsStore,
  STORAGE_KEY,
  detectLang,
} from '../preferencesStore'

function ls(): MemoryStorage {
  return (globalThis as unknown as { window: { localStorage: MemoryStorage } })
    .window.localStorage
}

describe('spellcheck preferencesStore', () => {
  beforeEach(() => {
    ls().clear()
    useSpellcheckPrefsStore.getState().reset()
  })

  it('defaults: enabled=true, autoDetectLang=true', () => {
    const s = useSpellcheckPrefsStore.getState()
    expect(s.enabled).toBe(true)
    expect(s.autoDetectLang).toBe(true)
  })

  it('set() persists each toggle independently', () => {
    useSpellcheckPrefsStore.getState().set('enabled', false)
    useSpellcheckPrefsStore.getState().set('autoDetectLang', false)
    const raw = ls().getItem(STORAGE_KEY)
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw!) as { enabled: boolean; autoDetectLang: boolean }
    expect(parsed.enabled).toBe(false)
    expect(parsed.autoDetectLang).toBe(false)
  })

  it('reset() restores defaults', () => {
    useSpellcheckPrefsStore.getState().set('enabled', false)
    useSpellcheckPrefsStore.getState().reset()
    expect(useSpellcheckPrefsStore.getState().enabled).toBe(true)
  })

  it('hydrate() reads externally-written prefs', () => {
    ls().setItem(STORAGE_KEY, JSON.stringify({ enabled: false, autoDetectLang: false }))
    useSpellcheckPrefsStore.getState().hydrate()
    expect(useSpellcheckPrefsStore.getState().enabled).toBe(false)
    expect(useSpellcheckPrefsStore.getState().autoDetectLang).toBe(false)
  })
})

describe('detectLang()', () => {
  it('Hangul → ko', () => {
    expect(detectLang('안녕하세요')).toBe('ko')
  })

  it('pure ASCII letters → en', () => {
    expect(detectLang('hello world')).toBe('en')
  })

  it('mixed Hangul + English → ko (browser handles inline EN)', () => {
    expect(detectLang('Hello 안녕')).toBe('ko')
  })

  it('digits-only → ko (default)', () => {
    expect(detectLang('12345')).toBe('ko')
  })

  it('empty string → ko (default)', () => {
    expect(detectLang('')).toBe('ko')
  })

  it('punctuation only → ko (default)', () => {
    expect(detectLang('!!!???')).toBe('ko')
  })

  it('English with digits → en', () => {
    expect(detectLang('iOS 18')).toBe('en')
  })
})
