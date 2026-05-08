import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ThemeProvider, resolveDark } from '../ThemeProvider'
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
    matchMedia: () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  }
})

afterAll(() => {
  if (originalWindow === undefined) {
    delete (globalThis as { window?: unknown }).window
  } else {
    ;(globalThis as { window?: unknown }).window = originalWindow
  }
})

describe('resolveDark()', () => {
  it("'dark' explicit → always dark", () => {
    expect(resolveDark('dark', false, false)).toBe(true)
    expect(resolveDark('dark', false, true)).toBe(true)
  })
  it("'light' explicit → always light", () => {
    expect(resolveDark('light', true, true)).toBe(false)
  })
  it("'system' follows the OS pref", () => {
    expect(resolveDark('system', false, true)).toBe(true)
    expect(resolveDark('system', false, false)).toBe(false)
  })
  it('falls back to legacy darkMode when themeMode is missing', () => {
    expect(resolveDark(undefined, true, false)).toBe(true)
    expect(resolveDark(undefined, false, true)).toBe(true) // system kicks in
  })
})

describe('<ThemeProvider />', () => {
  beforeEach(() => {
    useSettingsStore.getState().reset()
  })
  it('renders its children unchanged on the server (no DOM access)', () => {
    const html = renderToStaticMarkup(<ThemeProvider><span>hi</span></ThemeProvider>)
    expect(html).toContain('hi')
  })
})
