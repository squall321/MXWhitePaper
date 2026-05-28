import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { GalleryBlockView } from '../GalleryBlock'
import type { GalleryBlock } from '@/types/document'

/**
 * Mobile audit L16 — GalleryBlock carousel had no scroll affordance on
 * narrow viewports, so users couldn't tell more images existed off-screen.
 * Fix: wrap the carousel in `.scroll-fade-x` (same M6 utility used by
 * TableBlock / SpreadsheetBlock). Guard the class so a future refactor
 * doesn't silently strip the affordance.
 */

function harness(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  })
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>
}

const ID = '01TESTBLOCK00000000000FF02'

describe('GalleryBlock — L16 carousel scroll-fade affordance', () => {
  it('carousel variant wraps the scroll container in `.scroll-fade-x`', () => {
    const block: GalleryBlock = {
      type: 'gallery',
      id: ID,
      layout: 'carousel',
      items: [
        { imageId: 'a' },
        { imageId: 'b' },
        { imageId: 'c' },
      ],
    }
    const html = renderToStaticMarkup(harness(<GalleryBlockView block={block} />))
    expect(html).toContain('scroll-fade-x')
    // Sanity: the fade lives on the overflow-x wrapper.
    expect(html).toMatch(/class="[^"]*scroll-fade-x[^"]*overflow-x-auto/)
  })

  it('grid variant (default) does NOT apply the fade — it has no overflow', () => {
    const block: GalleryBlock = {
      type: 'gallery',
      id: ID,
      layout: 'grid',
      items: [{ imageId: 'a' }, { imageId: 'b' }],
    }
    const html = renderToStaticMarkup(harness(<GalleryBlockView block={block} />))
    expect(html).not.toContain('scroll-fade-x')
  })
})
