import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { GalleryBlockView } from '../GalleryBlock'
import type { GalleryBlock } from '@/types/document'

function harness(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  })
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>
}

const block: GalleryBlock = {
  type: 'gallery',
  id: '01TESTBLOCK00000000000GAL1',
  layout: 'grid',
  items: [
    { imageId: '01TESTIMAGE0000000000GAL01', caption: 'first', alt: 'one' },
    { imageId: '01TESTIMAGE0000000000GAL02', caption: 'second', alt: 'two' },
  ],
}

describe('<GalleryBlockView /> lightbox wiring', () => {
  it('renders a clickable button per tile so the lightbox can open', () => {
    const html = renderToStaticMarkup(harness(<GalleryBlockView block={block} />))
    // Each tile renders an <button aria-label="갤러리 N번 이미지 확대">.
    expect(html).toContain('갤러리 1번 이미지 확대')
    expect(html).toContain('갤러리 2번 이미지 확대')
  })

  it('does not render the lightbox overlay before any tile is clicked', () => {
    // The Lightbox returns null when open=false / openIdx === null.
    const html = renderToStaticMarkup(harness(<GalleryBlockView block={block} />))
    expect(html).not.toContain('data-lightbox')
  })

  it('renders caption text below each tile when supplied', () => {
    const html = renderToStaticMarkup(harness(<GalleryBlockView block={block} />))
    expect(html).toContain('first')
    expect(html).toContain('second')
  })
})
