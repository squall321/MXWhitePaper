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

import { useSettingsStore, STORAGE_KEY } from '../store'

describe('settings/store — display prefs (density / fontScale / lineHeight)', () => {
  beforeEach(() => {
    ;(globalThis as unknown as {
      window: { localStorage: MemoryStorage }
    }).window.localStorage.clear()
    useSettingsStore.getState().reset()
  })

  it('exposes sane defaults for the display prefs', () => {
    const s = useSettingsStore.getState()
    expect(s.density).toBe('comfortable')
    expect(s.fontScale).toBe(1)
    expect(s.lineHeight).toBe('normal')
    expect(s.highContrast).toBe(false)
  })

  it('persists density / fontScale / lineHeight independently', () => {
    useSettingsStore.getState().set('density', 'compact')
    useSettingsStore.getState().set('fontScale', 1.25)
    useSettingsStore.getState().set('lineHeight', 'relaxed')
    useSettingsStore.getState().set('highContrast', true)

    const raw = (
      globalThis as unknown as { window: { localStorage: MemoryStorage } }
    ).window.localStorage.getItem(STORAGE_KEY)
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw!) as {
      density: string
      fontScale: number
      lineHeight: string
      highContrast: boolean
    }
    expect(parsed.density).toBe('compact')
    expect(parsed.fontScale).toBe(1.25)
    expect(parsed.lineHeight).toBe('relaxed')
    expect(parsed.highContrast).toBe(true)
  })

  it('hydrate() rehydrates the new keys from localStorage', () => {
    const ls = (
      globalThis as unknown as { window: { localStorage: MemoryStorage } }
    ).window.localStorage
    ls.setItem(
      STORAGE_KEY,
      JSON.stringify({
        density: 'compact',
        fontScale: 0.875,
        lineHeight: 'tight',
        highContrast: true,
      }),
    )
    useSettingsStore.getState().hydrate()
    const s = useSettingsStore.getState()
    expect(s.density).toBe('compact')
    expect(s.fontScale).toBe(0.875)
    expect(s.lineHeight).toBe('tight')
    expect(s.highContrast).toBe(true)
  })

  it('reset() restores display defaults', () => {
    useSettingsStore.getState().set('density', 'compact')
    useSettingsStore.getState().set('fontScale', 1.25)
    useSettingsStore.getState().set('highContrast', true)
    useSettingsStore.getState().reset()
    const s = useSettingsStore.getState()
    expect(s.density).toBe('comfortable')
    expect(s.fontScale).toBe(1)
    expect(s.lineHeight).toBe('normal')
    expect(s.highContrast).toBe(false)
  })

  it('does not strip the existing persisted keys when display prefs change', () => {
    // Sanity guard for the stripActions whitelist — flipping a display pref
    // must not drop pre-existing email/theme prefs from the persisted blob.
    useSettingsStore.getState().set('emailCadence', 'weekly')
    useSettingsStore.getState().set('density', 'compact')
    const raw = (
      globalThis as unknown as { window: { localStorage: MemoryStorage } }
    ).window.localStorage.getItem(STORAGE_KEY)
    const parsed = JSON.parse(raw!) as {
      emailCadence: string
      density: string
    }
    expect(parsed.emailCadence).toBe('weekly')
    expect(parsed.density).toBe('compact')
  })
})
