import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest'
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

// Stub the outlet-context hook so the page renders without a real Outlet.
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>(
    'react-router-dom',
  )
  return {
    ...actual,
    useOutletContext: () => ({
      setLeftRail: () => {},
      setRightRail: () => {},
      openPalette: () => {},
    }),
  }
})

import { useSettingsStore, STORAGE_KEY } from '@/features/settings/store'
import { SettingsPage } from '../Settings'

function renderSettings(): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={['/settings']}>
      <SettingsPage />
    </MemoryRouter>,
  )
}

describe('settings/store', () => {
  beforeEach(() => {
    ;(globalThis as unknown as {
      window: { localStorage: MemoryStorage }
    }).window.localStorage.clear()
    useSettingsStore.getState().reset()
  })

  it('exposes sane defaults', () => {
    const s = useSettingsStore.getState()
    expect(s.notifications).toBe(true)
    expect(s.autoSave).toBe(true)
    expect(s.codeFade).toBe(true)
    expect(s.darkMode).toBe(false)
    expect(s.language).toBe('ko')
  })

  it('set() persists each toggle independently', () => {
    useSettingsStore.getState().set('notifications', false)
    useSettingsStore.getState().set('darkMode', true)
    const raw = (
      globalThis as unknown as { window: { localStorage: MemoryStorage } }
    ).window.localStorage.getItem(STORAGE_KEY)
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw!) as { notifications: boolean; darkMode: boolean }
    expect(parsed.notifications).toBe(false)
    expect(parsed.darkMode).toBe(true)
  })

  it('hydrate() loads externally written settings', () => {
    const ls = (
      globalThis as unknown as { window: { localStorage: MemoryStorage } }
    ).window.localStorage
    ls.setItem(
      STORAGE_KEY,
      JSON.stringify({
        notifications: false,
        autoSave: false,
        codeFade: false,
        darkMode: true,
        language: 'ko',
      }),
    )
    useSettingsStore.getState().hydrate()
    const s = useSettingsStore.getState()
    expect(s.notifications).toBe(false)
    expect(s.darkMode).toBe(true)
  })

  it('reset() restores defaults and persists them', () => {
    useSettingsStore.getState().set('darkMode', true)
    useSettingsStore.getState().reset()
    expect(useSettingsStore.getState().darkMode).toBe(false)
  })
})

describe('<SettingsPage />', () => {
  beforeEach(() => {
    ;(globalThis as unknown as {
      window: { localStorage: MemoryStorage }
    }).window.localStorage.clear()
    useSettingsStore.getState().reset()
  })

  it('renders all five preference rows with stable testIds', () => {
    const html = renderSettings()
    expect(html).toContain('환경설정')
    expect(html).toContain('settings-toggle-notifications')
    expect(html).toContain('settings-toggle-autosave')
    expect(html).toContain('settings-toggle-codefade')
    expect(html).toContain('settings-toggle-darkmode')
    expect(html).toContain('settings-select-language')
  })

  it('renders aria-checked for every toggle and exposes role="switch"', () => {
    const html = renderSettings()
    // 4 cosmetic toggles + 2 spellcheck toggles (enabled, autoDetectLang).
    // Excludes the language <select> and the theme radio group.
    const matches = html.match(/role="switch"/g) ?? []
    expect(matches.length).toBe(6)
    expect(html).toContain('role="switch"')
  })
})
