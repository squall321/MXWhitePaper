import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Lightbox, nextIndex, classifyLightboxKey, type LightboxItem } from '../Lightbox'

describe('nextIndex (gallery navigation state machine)', () => {
  it('wraps forward', () => {
    expect(nextIndex(2, 3, 1)).toBe(0)
  })
  it('wraps backward', () => {
    expect(nextIndex(0, 3, -1)).toBe(2)
  })
  it('handles empty list', () => {
    expect(nextIndex(0, 0, 1)).toBe(0)
  })
  it('advances forward', () => {
    expect(nextIndex(1, 5, 1)).toBe(2)
  })
  it('moves backward', () => {
    expect(nextIndex(2, 5, -1)).toBe(1)
  })
})

describe('<Lightbox /> static render', () => {
  const items: LightboxItem[] = [
    { src: '/img/a.jpg', alt: 'a', caption: 'first' },
    { src: '/img/b.jpg', alt: 'b', caption: 'second' },
    { src: '/img/c.jpg', alt: 'c', caption: 'third' },
  ]

  it('returns null when closed', () => {
    const html = renderToStaticMarkup(
      <Lightbox open={false} items={items} onClose={() => {}} />,
    )
    expect(html).toBe('')
  })

  it('renders prev/next when items.length > 1', () => {
    const html = renderToStaticMarkup(
      <Lightbox open items={items} onClose={() => {}} />,
    )
    expect(html).toContain('data-nav="prev"')
    expect(html).toContain('data-nav="next"')
  })

  it('omits nav buttons for single image', () => {
    const html = renderToStaticMarkup(
      <Lightbox open src="/img/single.jpg" onClose={() => {}} />,
    )
    expect(html).not.toContain('data-nav="prev"')
  })

  it('renders alt overlay and caption at the start index', () => {
    const html = renderToStaticMarkup(
      <Lightbox open items={items} startIndex={1} onClose={() => {}} />,
    )
    expect(html).toContain('data-alt-overlay')
    // Initial useState seed is `startIndex`, so item index 1 (caption "second") shows.
    expect(html).toContain('second')
  })

  it('returns null when items[] is empty', () => {
    const html = renderToStaticMarkup(
      <Lightbox open items={[]} onClose={() => {}} />,
    )
    expect(html).toBe('')
  })

  it('renders a close button (focus-trap anchor + a11y affordance)', () => {
    const html = renderToStaticMarkup(
      <Lightbox open items={items} onClose={() => {}} />,
    )
    expect(html).toContain('data-nav="close"')
    expect(html).toContain('aria-label="닫기"')
  })

  it('renders the N / M counter with aria-live="polite"', () => {
    const html = renderToStaticMarkup(
      <Lightbox open items={items} startIndex={1} onClose={() => {}} />,
    )
    expect(html).toContain('data-lightbox-counter')
    expect(html).toContain('aria-live="polite"')
    // 0-based startIndex 1 of 3 items → "2 / 3".
    expect(html).toMatch(/2\s*\/\s*3/)
  })

  it('counter is omitted for single-image lightbox', () => {
    const html = renderToStaticMarkup(
      <Lightbox open src="/img/single.jpg" onClose={() => {}} />,
    )
    expect(html).not.toContain('data-lightbox-counter')
  })

  it('exposes role=dialog + aria-modal for screen readers', () => {
    const html = renderToStaticMarkup(
      <Lightbox open items={items} onClose={() => {}} />,
    )
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
  })

  // M8a — nav buttons / alt overlay must honour the iPhone notch + landscape
  // edge insets so they're not clipped or obstructed by the system UI.
  it('close button declares safe-area-inset top + left', () => {
    const html = renderToStaticMarkup(
      <Lightbox open items={items} onClose={() => {}} />,
    )
    // Find the close button's style attribute (data-nav="close" is unique).
    const closeMatch = html.match(/data-nav="close"[^>]*style="([^"]*)"/)
    expect(closeMatch, 'close button must declare safe-area inline style').toBeTruthy()
    const style = closeMatch?.[1] ?? ''
    expect(style).toContain('safe-area-inset-top')
    expect(style).toContain('safe-area-inset-left')
  })

  it('prev / next buttons declare safe-area-inset left / right', () => {
    const html = renderToStaticMarkup(
      <Lightbox open items={items} onClose={() => {}} />,
    )
    const prevMatch = html.match(/data-nav="prev"[^>]*style="([^"]*)"/)
    const nextMatch = html.match(/data-nav="next"[^>]*style="([^"]*)"/)
    expect(prevMatch?.[1] ?? '').toContain('safe-area-inset-left')
    expect(nextMatch?.[1] ?? '').toContain('safe-area-inset-right')
  })

  it('alt overlay declares safe-area-inset top + right', () => {
    const html = renderToStaticMarkup(
      <Lightbox open items={items} onClose={() => {}} />,
    )
    const altMatch = html.match(/data-alt-overlay[^>]*style="([^"]*)"/)
    const style = altMatch?.[1] ?? ''
    expect(style).toContain('safe-area-inset-top')
    expect(style).toContain('safe-area-inset-right')
  })
})

describe('classifyLightboxKey (keyboard contract)', () => {
  it('Escape returns close', () => {
    expect(classifyLightboxKey('Escape', 3, false, false, false)).toEqual({ action: 'close' })
  })

  it('ArrowRight navigates forward when total > 1', () => {
    expect(classifyLightboxKey('ArrowRight', 3, false, false, false)).toEqual({
      action: 'navigate',
      dir: 1,
    })
  })

  it('ArrowLeft navigates backward when total > 1', () => {
    expect(classifyLightboxKey('ArrowLeft', 3, false, false, false)).toEqual({
      action: 'navigate',
      dir: -1,
    })
  })

  it('arrow keys ignored when total <= 1 (single image)', () => {
    expect(classifyLightboxKey('ArrowRight', 1, false, false, false)).toEqual({ action: 'ignore' })
    expect(classifyLightboxKey('ArrowLeft', 1, false, false, false)).toEqual({ action: 'ignore' })
  })

  it('Tab off last cycles to first', () => {
    expect(classifyLightboxKey('Tab', 3, false, false, true)).toEqual({
      action: 'focus-trap',
      target: 'first',
    })
  })

  it('Shift+Tab off first cycles to last', () => {
    expect(classifyLightboxKey('Tab', 3, true, true, false)).toEqual({
      action: 'focus-trap',
      target: 'last',
    })
  })

  it('Tab in the middle of the trap is ignored (browser handles it)', () => {
    expect(classifyLightboxKey('Tab', 3, false, false, false)).toEqual({ action: 'ignore' })
    expect(classifyLightboxKey('Tab', 3, true, false, false)).toEqual({ action: 'ignore' })
  })

  it('unrelated keys are ignored', () => {
    expect(classifyLightboxKey('a', 3, false, false, false)).toEqual({ action: 'ignore' })
    expect(classifyLightboxKey('Enter', 3, false, false, false)).toEqual({ action: 'ignore' })
  })
})
