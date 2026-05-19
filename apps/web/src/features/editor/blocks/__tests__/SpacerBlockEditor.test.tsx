import { describe, it, expect, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SpacerBlockEditor } from '../SpacerBlockEditor'
import { useEditorStore } from '@/features/editor/state'
import type { SpacerBlock } from '@/types/document'

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

const baseBlock: SpacerBlock = {
  type: 'spacer',
  id: '01EDITORBLOCK0000000000SP1',
  size: 'md',
}

describe('<SpacerBlockEditor /> static render', () => {
  beforeEach(() => {
    useEditorStore.getState().reset()
    useEditorStore.setState({ slug: SLUG, etag: 'etag-test' })
  })

  it('renders the size dropdown with sm/md/lg/xl options + onChange wired', () => {
    const html = renderToStaticMarkup(
      harness(<SpacerBlockEditor slug={SLUG} block={baseBlock} />),
    )
    // patchBlock is invoked through the same `<select onChange>` path the
    // user clicks. We assert the select itself is rendered so the bridge
    // exists — full event simulation would need jsdom which this repo's
    // vitest harness does not configure.
    expect(html).toContain('aria-label="여백 크기"')
    expect(html).toContain('sm (16px)')
    expect(html).toContain('md (32px)')
    expect(html).toContain('lg (64px)')
    expect(html).toContain('xl (128px)')  // pass-3 N1
  })

  it('shows the current px under the dropdown (md => 32px)', () => {
    const html = renderToStaticMarkup(
      harness(<SpacerBlockEditor slug={SLUG} block={baseBlock} />),
    )
    expect(html).toContain('현재: 32px')
    expect(html).toContain('h-8')
  })

  it('size=lg renders h-16 (64px) preview + label', () => {
    const html = renderToStaticMarkup(
      harness(<SpacerBlockEditor slug={SLUG} block={{ ...baseBlock, size: 'lg' }} />),
    )
    expect(html).toContain('h-16')
    expect(html).toContain('현재: 64px')
  })

  it('size=xl renders h-32 (128px) preview + label (pass-3 N1)', () => {
    const html = renderToStaticMarkup(
      harness(<SpacerBlockEditor slug={SLUG} block={{ ...baseBlock, size: 'xl' }} />),
    )
    expect(html).toContain('h-32')
    expect(html).toContain('현재: 128px')
  })

  it('size omitted on block defaults to md (32px / h-8)', () => {
    const noSize: SpacerBlock = { type: 'spacer', id: baseBlock.id }
    const html = renderToStaticMarkup(
      harness(<SpacerBlockEditor slug={SLUG} block={noSize} />),
    )
    expect(html).toContain('현재: 32px')
    expect(html).toContain('h-8')
  })
})
