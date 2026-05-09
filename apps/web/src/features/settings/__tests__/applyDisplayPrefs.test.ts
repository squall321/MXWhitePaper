import { describe, it, expect, beforeEach } from 'vitest'
import {
  applyDisplayPrefs,
  buildDisplayPrefsCss,
  DISPLAY_PREFS_STYLE_ID,
  type DisplayPrefs,
} from '../applyDisplayPrefs'

const DEFAULT_PREFS: DisplayPrefs = {
  density: 'comfortable',
  fontScale: 1,
  lineHeight: 'normal',
  highContrast: false,
}

describe('buildDisplayPrefsCss (pure derivation)', () => {
  it('contains :root vars for the default config', () => {
    const css = buildDisplayPrefsCss(DEFAULT_PREFS)
    expect(css).toContain('--density-padding-y:0.75rem')
    expect(css).toContain('--font-scale:1')
    expect(css).toContain('--leading-base:1.6')
  })

  it('reflects compact density / 125% font / relaxed line-height', () => {
    const css = buildDisplayPrefsCss({
      density: 'compact',
      fontScale: 1.25,
      lineHeight: 'relaxed',
      highContrast: false,
    })
    expect(css).toContain('--density-padding-y:0.4rem')
    expect(css).toContain('--font-scale:1.25')
    expect(css).toContain('--leading-base:1.85')
    expect(css).toContain('html[data-density="compact"]')
  })

  it('emits the high-contrast block only when highContrast is true', () => {
    const off = buildDisplayPrefsCss(DEFAULT_PREFS)
    expect(off).not.toContain('html[data-contrast="high"]')

    const on = buildDisplayPrefsCss({ ...DEFAULT_PREFS, highContrast: true })
    expect(on).toContain('html[data-contrast="high"]')
    expect(on).toContain('--smsg-blue-700:#0a2a66')
  })

  it('always emits a prefers-contrast: more @media block', () => {
    const css = buildDisplayPrefsCss(DEFAULT_PREFS)
    expect(css).toMatch(/@media \(prefers-contrast: more\)/)
  })

  it('scales root font-size via var(--font-scale)', () => {
    const css = buildDisplayPrefsCss(DEFAULT_PREFS)
    expect(css).toContain('html{font-size:calc(1rem * var(--font-scale, 1));}')
  })
})

// ──────────────────────────────────────────────────────────────────────────
// Minimal DOM mock — enough for applyDisplayPrefs to read documentElement
// and append a <style> tag. Keeps the test file dependency-free (no jsdom).
// ──────────────────────────────────────────────────────────────────────────
class FakeAttrMap {
  private attrs = new Map<string, string>()
  setAttribute(k: string, v: string): void {
    this.attrs.set(k, v)
  }
  getAttribute(k: string): string | null {
    return this.attrs.has(k) ? this.attrs.get(k)! : null
  }
  removeAttribute(k: string): void {
    this.attrs.delete(k)
  }
  hasAttribute(k: string): boolean {
    return this.attrs.has(k)
  }
}

interface FakeStyle {
  id: string
  textContent: string | null
}

function makeFakeDocument() {
  const html = new FakeAttrMap()
  const styles = new Map<string, FakeStyle>()
  const head = {
    appendChild(node: FakeStyle) {
      styles.set(node.id, node)
      return node
    },
  }
  const doc = {
    documentElement: html,
    head,
    createElement(tag: string): FakeStyle {
      if (tag !== 'style') throw new Error(`unexpected tag: ${tag}`)
      return { id: '', textContent: null }
    },
    getElementById(id: string): FakeStyle | null {
      return styles.get(id) ?? null
    },
  }
  return { doc, html, styles }
}

describe('applyDisplayPrefs (DOM side effect)', () => {
  let fake: ReturnType<typeof makeFakeDocument>

  beforeEach(() => {
    fake = makeFakeDocument()
    ;(globalThis as unknown as { document: unknown }).document = fake.doc
  })

  it('writes data-density / data-font-scale / data-line-height to <html>', () => {
    applyDisplayPrefs({
      density: 'compact',
      fontScale: 1.125,
      lineHeight: 'tight',
      highContrast: false,
    })
    expect(fake.html.getAttribute('data-density')).toBe('compact')
    expect(fake.html.getAttribute('data-font-scale')).toBe('1.125')
    expect(fake.html.getAttribute('data-line-height')).toBe('tight')
    expect(fake.html.getAttribute('data-contrast')).toBeNull()
  })

  it('toggles data-contrast="high" only when highContrast=true', () => {
    applyDisplayPrefs({ ...DEFAULT_PREFS, highContrast: true })
    expect(fake.html.getAttribute('data-contrast')).toBe('high')

    applyDisplayPrefs({ ...DEFAULT_PREFS, highContrast: false })
    expect(fake.html.getAttribute('data-contrast')).toBeNull()
  })

  it('mounts a singleton <style id="mxwp-display-prefs"> tag', () => {
    applyDisplayPrefs(DEFAULT_PREFS)
    const tag = fake.styles.get(DISPLAY_PREFS_STYLE_ID)
    expect(tag).toBeTruthy()
    expect(tag!.textContent).toContain('--font-scale:1')
  })

  it('rewrites textContent on subsequent calls without remounting', () => {
    applyDisplayPrefs(DEFAULT_PREFS)
    applyDisplayPrefs({
      density: 'compact',
      fontScale: 1.25,
      lineHeight: 'relaxed',
      highContrast: true,
    })
    // Still exactly one tag in the styles map.
    expect(fake.styles.size).toBe(1)
    const tag = fake.styles.get(DISPLAY_PREFS_STYLE_ID)!
    expect(tag.textContent).toContain('--font-scale:1.25')
    expect(tag.textContent).toContain('--density-padding-y:0.4rem')
    expect(tag.textContent).toContain('html[data-contrast="high"]')
  })

  it('is a no-op when document is undefined', () => {
    delete (globalThis as { document?: unknown }).document
    expect(() => applyDisplayPrefs(DEFAULT_PREFS)).not.toThrow()
  })
})
