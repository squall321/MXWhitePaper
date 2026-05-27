import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Button } from '../Button'
import { IconButton } from '../IconButton'

/**
 * Mobile hardening guard for `Button` and `IconButton`.
 *
 * WCAG 2.5.5 / iOS HIG / Material guidance all recommend a minimum 44×44
 * touch target. The previous `h-8` (32px) / `h-9` (36px) sizes were too
 * small on phones and caused frequent mis-taps. The fix expresses the
 * touch-target floor on mobile (`h-11` = 44px) and resets to the compact
 * desktop size at the `sm:` breakpoint.
 *
 * If a future refactor strips the mobile guard this test will fail loudly.
 */

function classOf(html: string): string {
  const m = html.match(/class="([^"]*)"/)
  return m && m[1] ? m[1] : ''
}

describe('Button mobile touch-target guard (WCAG 44×44)', () => {
  it('size="sm" declares h-11 on mobile and sm:h-8 on desktop', () => {
    const cls = classOf(renderToStaticMarkup(<Button size="sm">x</Button>))
    expect(cls, cls).toMatch(/\bh-11\b/)
    expect(cls, cls).toMatch(/\bsm:h-8\b/)
  })

  it('size="md" declares h-11 on mobile and sm:h-9 on desktop', () => {
    const cls = classOf(renderToStaticMarkup(<Button size="md">x</Button>))
    expect(cls, cls).toMatch(/\bh-11\b/)
    expect(cls, cls).toMatch(/\bsm:h-9\b/)
  })

  it('size="lg" stays h-11 (already meets the touch-target floor)', () => {
    const cls = classOf(renderToStaticMarkup(<Button size="lg">x</Button>))
    expect(cls, cls).toMatch(/\bh-11\b/)
  })

  it('default size (md) is h-11 sm:h-9', () => {
    const cls = classOf(renderToStaticMarkup(<Button>x</Button>))
    expect(cls, cls).toMatch(/\bh-11\b/)
    expect(cls, cls).toMatch(/\bsm:h-9\b/)
  })
})

describe('IconButton mobile touch-target guard (WCAG 44×44)', () => {
  it('size="sm" is h-11 w-11 on mobile, compact 32px on desktop', () => {
    const cls = classOf(
      renderToStaticMarkup(<IconButton aria-label="x" size="sm">i</IconButton>),
    )
    expect(cls, cls).toMatch(/\bh-11\b/)
    expect(cls, cls).toMatch(/\bw-11\b/)
    expect(cls, cls).toMatch(/\bsm:h-8\b/)
    expect(cls, cls).toMatch(/\bsm:w-8\b/)
  })

  it('size="md" is h-11 w-11 on mobile, compact 36px on desktop', () => {
    const cls = classOf(
      renderToStaticMarkup(<IconButton aria-label="x" size="md">i</IconButton>),
    )
    expect(cls, cls).toMatch(/\bh-11\b/)
    expect(cls, cls).toMatch(/\bw-11\b/)
    expect(cls, cls).toMatch(/\bsm:h-9\b/)
    expect(cls, cls).toMatch(/\bsm:w-9\b/)
  })

  it('size="lg" is h-11 w-11 on mobile, compact 40px on desktop', () => {
    const cls = classOf(
      renderToStaticMarkup(<IconButton aria-label="x" size="lg">i</IconButton>),
    )
    expect(cls, cls).toMatch(/\bh-11\b/)
    expect(cls, cls).toMatch(/\bw-11\b/)
    expect(cls, cls).toMatch(/\bsm:h-10\b/)
    expect(cls, cls).toMatch(/\bsm:w-10\b/)
  })
})
