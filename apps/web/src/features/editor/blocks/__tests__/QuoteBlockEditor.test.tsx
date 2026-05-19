import { describe, it, expect, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { QuoteBlockEditor } from '../QuoteBlockEditor'
import { useEditorStore } from '@/features/editor/state'
import type { QuoteBlock } from '@/types/document'

function harness(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  })
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>
  )
}

const SLUG = 'demo-doc'

const baseBlock: QuoteBlock = {
  type: 'quote',
  id: '01EDITORBLOCK0000000000QT1',
  text: '이것은 인용입니다.',
  cite: '저자 이름',
}

describe('<QuoteBlockEditor /> static render', () => {
  beforeEach(() => {
    useEditorStore.getState().reset()
    useEditorStore.setState({ slug: SLUG, etag: 'etag-test' })
  })

  it('renders the text textarea wired to block.text', () => {
    const html = renderToStaticMarkup(
      harness(<QuoteBlockEditor slug={SLUG} block={baseBlock} />),
    )
    expect(html).toContain('aria-label="인용문 본문"')
    expect(html).toContain('data-quote-text')
    expect(html).toContain('이것은 인용입니다.')
  })

  it('renders the cite input wired to block.cite', () => {
    const html = renderToStaticMarkup(
      harness(<QuoteBlockEditor slug={SLUG} block={baseBlock} />),
    )
    expect(html).toContain('aria-label="출처"')
    expect(html).toContain('data-quote-cite')
    expect(html).toContain('저자 이름')
  })

  it('renders an empty cite input when block.cite is omitted', () => {
    const noCite: QuoteBlock = { type: 'quote', id: baseBlock.id, text: 't' }
    const html = renderToStaticMarkup(
      harness(<QuoteBlockEditor slug={SLUG} block={noCite} />),
    )
    expect(html).toContain('placeholder="출처 (선택)"')
    // The input should not contain a stray "저자 이름" value
    expect(html).not.toContain('저자 이름')
  })

  it('renders text empty when block.text is missing', () => {
    const noText = { type: 'quote' as const, id: baseBlock.id } as QuoteBlock
    const html = renderToStaticMarkup(
      harness(<QuoteBlockEditor slug={SLUG} block={noText} />),
    )
    expect(html).toContain('placeholder="인용문…"')
  })
})
