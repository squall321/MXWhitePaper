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
    // 4 cosmetic toggles + 1 email-digest toggle + 2 spellcheck toggles +
    // 1 high-contrast toggle (표시 설정 card) + 12 notification-prefs cells
    // (6 kinds × 2 channels — `reaction_added` added in Cycle 0021).
    // Excludes the language <select> and the theme / cadence / density /
    // font-scale / line-height radio groups.
    const matches = html.match(/role="switch"/g) ?? []
    expect(matches.length).toBe(20)
    expect(html).toContain('role="switch"')
  })

  it('renders the 이메일 알림 card with cadence radio and read-only email row', () => {
    const html = renderSettings()
    expect(html).toContain('이메일 알림')
    expect(html).toContain('settings-email-card')
    expect(html).toContain('settings-toggle-email-digest')
    expect(html).toContain('settings-email-cadence')
    expect(html).toContain('settings-email-cadence-instant')
    expect(html).toContain('settings-email-cadence-daily')
    expect(html).toContain('settings-email-cadence-weekly')
    expect(html).toContain('settings-email-readonly')
    // Logged-out fallback message present (no auth user in this test env).
    expect(html).toContain('로그인 후 표시됩니다.')
  })

  it('renders the 표시 설정 card with density / font-scale / line-height controls', () => {
    const html = renderSettings()
    expect(html).toContain('표시 설정')
    expect(html).toContain('settings-display-card')
    expect(html).toContain('settings-density-radio')
    expect(html).toContain('settings-density-comfortable')
    expect(html).toContain('settings-density-compact')
    expect(html).toContain('settings-font-scale')
    expect(html).toContain('settings-font-scale-0.875')
    expect(html).toContain('settings-font-scale-1.25')
    expect(html).toContain('settings-line-height-radio')
    expect(html).toContain('settings-line-height-tight')
    expect(html).toContain('settings-line-height-relaxed')
    expect(html).toContain('settings-toggle-high-contrast')
    expect(html).toContain('settings-display-reset')
  })
})

describe('settings/store email prefs', () => {
  beforeEach(() => {
    ;(globalThis as unknown as {
      window: { localStorage: MemoryStorage }
    }).window.localStorage.clear()
    useSettingsStore.getState().reset()
  })

  it('exposes email defaults', () => {
    const s = useSettingsStore.getState()
    expect(s.emailDigest).toBe(true)
    expect(s.emailCadence).toBe('daily')
  })

  it('persists email cadence changes', () => {
    useSettingsStore.getState().set('emailCadence', 'weekly')
    useSettingsStore.getState().set('emailDigest', false)
    const raw = (
      globalThis as unknown as { window: { localStorage: MemoryStorage } }
    ).window.localStorage.getItem(STORAGE_KEY)
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw!) as {
      emailCadence: string
      emailDigest: boolean
    }
    expect(parsed.emailCadence).toBe('weekly')
    expect(parsed.emailDigest).toBe(false)
  })
})
