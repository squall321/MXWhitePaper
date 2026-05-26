import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ImageBlockView } from '../ImageBlock'
import type { ImageBlock } from '@/types/document'

function harness(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  })
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>
}

const block: ImageBlock = {
  type: 'image',
  id: '01TESTBLOCK00000000000IMG1',
  imageId: '01TESTIMAGE0000000000IMG01',
  alt: 'a duck',
  caption: 'A photogenic duck',
  width: 'md',
}

describe('<ImageBlockView /> lightbox wiring', () => {
  it('renders an img with the resolved src + alt', () => {
    const html = renderToStaticMarkup(harness(<ImageBlockView block={block} />))
    // Without a cached image record the component falls back to /api/v1/images/{id}.
    expect(html).toContain('/api/v1/images/')
    expect(html).toContain('alt="a duck"')
  })

  it('renders a clickable button wrapping the image so the lightbox can open', () => {
    const html = renderToStaticMarkup(harness(<ImageBlockView block={block} />))
    expect(html).toContain('aria-label="이미지 확대"')
    // The button wraps an <img>.
    expect(html).toMatch(/<button[^>]*aria-label="이미지 확대"[^>]*>[\s\S]*<img/)
  })

  it('renders the caption below the image', () => {
    const html = renderToStaticMarkup(harness(<ImageBlockView block={block} />))
    expect(html).toContain('A photogenic duck')
    expect(html).toContain('figure-caption-text')
  })

  it('does not render the lightbox overlay before the trigger is activated', () => {
    // open=false initially → Lightbox returns null.
    const html = renderToStaticMarkup(harness(<ImageBlockView block={block} />))
    expect(html).not.toContain('data-lightbox')
  })

  it('omits the link affordance when block.link is unset', () => {
    const html = renderToStaticMarkup(harness(<ImageBlockView block={block} />))
    expect(html).not.toContain('↗ 링크 열기')
  })

  it('renders the link affordance when block.link is set (external URL)', () => {
    const linked: ImageBlock = { ...block, link: 'https://example.com/dl' }
    const html = renderToStaticMarkup(harness(<ImageBlockView block={linked} />))
    expect(html).toContain('↗ 링크 열기')
    expect(html).toContain('href="https://example.com/dl"')
    expect(html).toContain('target="_blank"')
  })
})
