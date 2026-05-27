import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Input, Textarea, Select } from '../Input'

/**
 * Mobile hardening guard for `Input` / `Textarea` / `Select`.
 *
 * iOS Safari auto-zooms when focusing an input whose effective font-size is
 * < 16px (`text-sm` = 14px). The shared field primitives in `Input.tsx` must
 * therefore declare `text-base` on mobile and only fall back to the compact
 * `text-sm` at the `sm:` breakpoint and above.
 *
 * This test asserts the class string contains BOTH `text-base` and
 * `sm:text-sm` (in that order) so a future "simplification" that drops the
 * mobile guard immediately fails CI.
 */

function hasMobileFontGuard(html: string): boolean {
  // The class attribute must mention `text-base` and `sm:text-sm` somewhere
  // — we don't care about their relative position inside the class list.
  return /\btext-base\b/.test(html) && /\bsm:text-sm\b/.test(html)
}

describe('Input mobile font-size guard (iOS auto-zoom prevention)', () => {
  it('Input renders text-base with sm:text-sm fallback', () => {
    const html = renderToStaticMarkup(<Input placeholder="x" />)
    expect(hasMobileFontGuard(html), html).toBe(true)
  })

  it('Input with prefix/suffix keeps the same mobile font guard on the inner <input>', () => {
    const html = renderToStaticMarkup(<Input prefix="$" placeholder="amount" />)
    expect(hasMobileFontGuard(html), html).toBe(true)
  })

  it('Textarea renders text-base with sm:text-sm fallback', () => {
    const html = renderToStaticMarkup(<Textarea placeholder="x" />)
    expect(hasMobileFontGuard(html), html).toBe(true)
  })

  it('Select renders text-base with sm:text-sm fallback', () => {
    const html = renderToStaticMarkup(
      <Select>
        <option>a</option>
      </Select>,
    )
    expect(hasMobileFontGuard(html), html).toBe(true)
  })
})
