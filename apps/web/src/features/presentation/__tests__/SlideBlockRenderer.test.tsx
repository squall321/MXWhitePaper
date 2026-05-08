import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { SlideBlockRenderer } from '../SlideBlockRenderer'
import type { ParagraphBlock, ListBlock, CalloutBlock } from '@/types/document'

// BlockRenderer descendants reach for a QueryClient (e.g. GlossaryTooltip).
// We supply a no-op client and SSR-render the tree.
function withQuery(node: ReactNode): string {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, enabled: false } },
  })
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>{node}</QueryClientProvider>,
  )
}

describe('<SlideBlockRenderer />', () => {
  it('wraps the rendered block with .prose-slide for slide typography', () => {
    const block: ParagraphBlock = {
      type: 'paragraph',
      id: '01TESTPARA000000000000000A',
      text: '안녕 슬라이드',
    }
    const html = withQuery(<SlideBlockRenderer block={block} />)
    expect(html).toContain('class="prose-slide"')
    expect(html).toContain('data-block-type="paragraph"')
    expect(html).toContain('안녕 슬라이드')
  })

  it('preserves the block type contract (lists, callouts, etc.)', () => {
    const list: ListBlock = {
      type: 'list',
      id: '01TESTLIST000000000000000A',
      style: 'bullet',
      items: ['α', 'β', 'γ'],
    }
    const callout: CalloutBlock = {
      type: 'callout',
      id: '01TESTCALL000000000000000A',
      variant: 'tip',
      text: '팁입니다',
    }
    const listHtml = withQuery(<SlideBlockRenderer block={list} />)
    const calloutHtml = withQuery(<SlideBlockRenderer block={callout} />)

    expect(listHtml).toContain('α')
    expect(listHtml).toContain('β')
    expect(listHtml).toContain('γ')
    expect(calloutHtml).toContain('팁입니다')
    // wrapper present in both
    expect(listHtml).toMatch(/class="prose-slide"/)
    expect(calloutHtml).toMatch(/class="prose-slide"/)
  })
})
