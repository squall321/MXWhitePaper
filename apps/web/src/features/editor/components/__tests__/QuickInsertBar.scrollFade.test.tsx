import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { QuickInsertBar } from '../QuickInsertBar'
import { useEditorStore } from '@/features/editor/state'

/**
 * Mobile audit L17 — QuickInsertBar has 13 buttons; mobile (375px) only
 * fits ~3 at a time. The toolbar overflows horizontally with no visible
 * scrollbar, so users miss the off-screen items. Fix: `.scroll-fade-x` —
 * same affordance utility used by TableBlock / GalleryBlock carousel.
 */

describe('QuickInsertBar — L17 horizontal scroll-fade affordance', () => {
  it('toolbar carries `.scroll-fade-x` on the overflow-x wrapper', () => {
    useEditorStore.getState().reset()
    useEditorStore.setState({ slug: 'test', etag: 'etag-1' })
    const html = renderToStaticMarkup(<QuickInsertBar slug="test" />)
    expect(html).toContain('scroll-fade-x')
    expect(html).toMatch(/class="[^"]*scroll-fade-x[^"]*overflow-x-auto/)
  })
})
