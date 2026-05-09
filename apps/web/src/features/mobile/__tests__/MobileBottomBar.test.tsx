import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  MobileBottomBar,
  nextVisibility,
  SCROLL_DELTA_THRESHOLD,
  TOP_PIN_PX,
} from '../MobileBottomBar'

/**
 * Two layers of coverage:
 *   1. `nextVisibility` — pure decision helper for hide-on-scroll-down /
 *      show-on-scroll-up. The hook delegates to it on every scroll event so
 *      the math here is what users feel.
 *   2. Static render — confirms the bar mounts on mobile (md:hidden) with the
 *      four default actions.
 */

describe('nextVisibility (auto-hide decision)', () => {
  it('always shows near the top of the page', () => {
    expect(nextVisibility({ current: 0, previous: 100, visible: false })).toBe(true)
    expect(nextVisibility({ current: TOP_PIN_PX, previous: 1000, visible: false })).toBe(true)
  })

  it('hides on a meaningful downward scroll', () => {
    expect(
      nextVisibility({
        current: 500 + SCROLL_DELTA_THRESHOLD + 1,
        previous: 500,
        visible: true,
      }),
    ).toBe(false)
  })

  it('shows on a meaningful upward scroll', () => {
    expect(
      nextVisibility({
        current: 500 - SCROLL_DELTA_THRESHOLD - 1,
        previous: 500,
        visible: false,
      }),
    ).toBe(true)
  })

  it('keeps current visibility on tiny jitter (< threshold)', () => {
    expect(nextVisibility({ current: 502, previous: 500, visible: true })).toBe(true)
    expect(nextVisibility({ current: 502, previous: 500, visible: false })).toBe(false)
  })
})

describe('<MobileBottomBar /> static markup', () => {
  it('renders the four default actions with md:hidden', () => {
    const html = renderToStaticMarkup(<MobileBottomBar />)
    expect(html).toContain('data-testid="mobile-bottom-bar"')
    expect(html).toContain('md:hidden')
    expect(html).toContain('data-action="search"')
    expect(html).toContain('data-action="comments"')
    expect(html).toContain('data-action="share"')
    expect(html).toContain('data-action="menu"')
  })

  it('starts visible (data-visible="true") on first mount', () => {
    const html = renderToStaticMarkup(<MobileBottomBar />)
    expect(html).toContain('data-visible="true"')
  })

  it('renders custom actions when provided', () => {
    const html = renderToStaticMarkup(
      <MobileBottomBar
        actions={[
          { key: 'search', label: '찾기', onClick: () => {} },
          { key: 'menu', label: '메뉴', onClick: () => {} },
        ]}
      />,
    )
    expect(html).toContain('찾기')
    expect(html).toContain('메뉴')
    expect(html).not.toContain('data-action="comments"')
  })
})
