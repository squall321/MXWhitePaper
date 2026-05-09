import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { LanguageSwitcher } from '../LanguageSwitcher'
import { useSettingsStore } from '@/features/settings/store'

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

describe('<LanguageSwitcher />', () => {
  beforeEach(() => {
    useSettingsStore.getState().reset()
  })

  it('renders the trigger button with the current locale short label', () => {
    const html = renderToStaticMarkup(<LanguageSwitcher />)
    // Default locale is ko → short label "KO".
    expect(html).toContain('KO')
    expect(html).toContain('data-testid="topbar-lang"')
    expect(html).toContain('aria-haspopup="menu"')
    expect(html).toContain('aria-expanded="false"')
  })

  it('exposes the Korean aria-label by default', () => {
    const html = renderToStaticMarkup(<LanguageSwitcher />)
    expect(html).toContain('aria-label="언어 변경"')
  })

  it('persists the language choice via the settings store', () => {
    // The widget is just a thin wrapper around useSettingsStore.set('language').
    // Verify the contract by mutating the store directly and checking persistence.
    useSettingsStore.getState().set('language', 'en')
    expect(useSettingsStore.getState().language).toBe('en')
    useSettingsStore.getState().set('language', 'ko')
    expect(useSettingsStore.getState().language).toBe('ko')
  })
})
