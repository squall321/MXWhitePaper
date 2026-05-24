import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest'
import { readResolvedTheme } from '../useResolvedTheme'

/**
 * Project convention (see ThemeProvider.test.tsx, CellBlockEditor.test.tsx)
 * is to avoid jsdom. We stub a minimal `document` on globalThis so the
 * pure helper `readResolvedTheme()` can run; the hook body itself is
 * exercised indirectly via that helper.
 */
const originalDocument = (globalThis as { document?: unknown }).document

interface StubHtml {
  classList: { contains: (c: string) => boolean }
  getAttribute: (a: string) => string | null
}

function stubDocument(html: StubHtml) {
  ;(globalThis as { document?: unknown }).document = {
    documentElement: html,
  }
}

beforeAll(() => {
  // installer per-test below
})

afterAll(() => {
  if (originalDocument === undefined) {
    delete (globalThis as { document?: unknown }).document
  } else {
    ;(globalThis as { document?: unknown }).document = originalDocument
  }
})

describe('readResolvedTheme()', () => {
  beforeEach(() => {
    delete (globalThis as { document?: unknown }).document
  })

  it("returns 'light' when document is unavailable (SSR)", () => {
    expect(readResolvedTheme()).toBe('light')
  })

  it("returns 'light' when no .dark class nor data-theme", () => {
    stubDocument({
      classList: { contains: () => false },
      getAttribute: () => null,
    })
    expect(readResolvedTheme()).toBe('light')
  })

  it("returns 'dark' when html.classList contains 'dark'", () => {
    stubDocument({
      classList: { contains: (c) => c === 'dark' },
      getAttribute: () => null,
    })
    expect(readResolvedTheme()).toBe('dark')
  })

  it("returns 'dark' when data-theme='dark' (even without .dark class)", () => {
    stubDocument({
      classList: { contains: () => false },
      getAttribute: (a) => (a === 'data-theme' ? 'dark' : null),
    })
    expect(readResolvedTheme()).toBe('dark')
  })
})
