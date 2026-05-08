import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Lightbox, nextIndex, type LightboxItem } from '../Lightbox'

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
})
