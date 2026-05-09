import { describe, it, expect } from 'vitest'
import { generateQrSvg, isQrTextSupported } from '../qr'

describe('generateQrSvg (fallback URL panel)', () => {
  it('returns inline SVG with width/height and the URL embedded', () => {
    const svg = generateQrSvg('https://example.com/share/abc')
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg).toContain('width="240"')
    expect(svg).toContain('height="240"')
    expect(svg).toContain('https://example.com/share/abc')
  })

  it('respects custom size and clamps absurd values', () => {
    expect(generateQrSvg('x', 320)).toContain('width="320"')
    expect(generateQrSvg('x', 5)).toContain('width="96"') // clamps up
    expect(generateQrSvg('x', 99999)).toContain('width="640"') // clamps down
  })

  it('is deterministic for the same input', () => {
    const a = generateQrSvg('hello world', 200)
    const b = generateQrSvg('hello world', 200)
    expect(a).toBe(b)
  })

  it('escapes XML-special characters in the URL', () => {
    const svg = generateQrSvg('https://e.com?x=<a>&b="c"')
    expect(svg).not.toContain('<a>') // raw < should not survive
    expect(svg).toContain('&lt;a&gt;')
    expect(svg).toContain('&amp;b=')
    expect(svg).toContain('&quot;c&quot;')
  })

  it('throws on empty or oversized input', () => {
    expect(() => generateQrSvg('')).toThrow(/non-empty/)
    expect(() => generateQrSvg('x'.repeat(2049))).toThrow(/max length/)
  })

  it('produces an aria-label and a <title> for accessibility', () => {
    const svg = generateQrSvg('https://example.com/share/xyz')
    expect(svg).toContain('role="img"')
    expect(svg).toContain('aria-label="https://example.com/share/xyz"')
    expect(svg).toContain('<title>https://example.com/share/xyz</title>')
  })
})

describe('isQrTextSupported', () => {
  it('returns true for normal urls and false for empty/oversized', () => {
    expect(isQrTextSupported('https://x')).toBe(true)
    expect(isQrTextSupported('')).toBe(false)
    expect(isQrTextSupported('a'.repeat(2049))).toBe(false)
    // @ts-expect-error — intentional mistype
    expect(isQrTextSupported(undefined)).toBe(false)
  })
})
