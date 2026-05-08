import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { t } from '../index'
import { ko } from '../ko'
import { en } from '../en'

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

describe('i18n.t()', () => {
  it('returns the Korean string by default', () => {
    expect(t('settings.title')).toBe('환경설정')
  })

  it('returns the English string when explicitly asked', () => {
    expect(t('settings.title', undefined, 'en')).toBe('Settings')
  })

  it('falls back to Korean when a key is missing in English', () => {
    // Force a hole in the English table — substitute via cast.
    const enAny = en as unknown as Record<string, string | undefined>
    const saved = enAny['settings.title']
    enAny['settings.title'] = undefined
    try {
      expect(t('settings.title', undefined, 'en')).toBe('환경설정')
    } finally {
      enAny['settings.title'] = saved
    }
  })

  it('substitutes {param} placeholders', () => {
    const koAny = ko as unknown as Record<string, string>
    const KEY = '__test.greet'
    koAny[KEY] = '안녕하세요, {name}님!'
    try {
      expect(t(KEY, { name: '구건모' })).toBe('안녕하세요, 구건모님!')
    } finally {
      delete koAny[KEY]
    }
  })

  it('returns the key itself when missing in both tables', () => {
    expect(t('totally.unknown.key')).toBe('totally.unknown.key')
  })

  it('every English key has a matching Korean key', () => {
    for (const k of Object.keys(en)) {
      expect((ko as Record<string, unknown>)[k]).toBeDefined()
    }
  })
})
