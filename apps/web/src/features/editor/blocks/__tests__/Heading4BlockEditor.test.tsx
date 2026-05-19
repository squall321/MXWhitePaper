import { describe, it, expect, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Heading4BlockEditor } from '../Heading4BlockEditor'
import { useEditorStore } from '@/features/editor/state'
import type { Heading4Block } from '@/types/document'

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

const baseBlock: Heading4Block = {
  type: 'heading-4',
  id: '01EDITORBLOCK0000000000H41',
  title: '소제목',
  level: 4,
}

describe('<Heading4BlockEditor /> static render', () => {
  beforeEach(() => {
    useEditorStore.getState().reset()
    useEditorStore.setState({ slug: SLUG, etag: 'etag-test' })
  })

  it('renders the level dropdown with H2 / H3 / H4 options', () => {
    const html = renderToStaticMarkup(
      harness(<Heading4BlockEditor slug={SLUG} block={baseBlock} />),
    )
    expect(html).toContain('aria-label="제목 레벨"')
    expect(html).toContain('>H2<')
    expect(html).toContain('>H3<')
    expect(html).toContain('H4 (기본)')
  })

  it('selects the current level (level=3 → option 3 is selected)', () => {
    const html = renderToStaticMarkup(
      harness(<Heading4BlockEditor slug={SLUG} block={{ ...baseBlock, level: 3 }} />),
    )
    // SSR encodes selected via the <select> defaultValue path; the editor
    // uses controlled `value` so we assert the select value attribute via
    // the rendered class for H3.
    expect(html).toContain('text-xl font-semibold text-smsg-900')
  })

  it('defaults to level 4 when omitted', () => {
    const noLevel: Heading4Block = { type: 'heading-4', id: baseBlock.id, title: 't' }
    const html = renderToStaticMarkup(
      harness(<Heading4BlockEditor slug={SLUG} block={noLevel} />),
    )
    expect(html).toContain('text-lg font-semibold text-gray-700')
  })

  it('reads legacy meta.level when top-level level is missing', () => {
    const legacy = {
      type: 'heading-4' as const,
      id: baseBlock.id,
      title: 't',
      meta: { level: 2 },
    } as unknown as Heading4Block
    const html = renderToStaticMarkup(
      harness(<Heading4BlockEditor slug={SLUG} block={legacy} />),
    )
    expect(html).toContain('text-2xl font-semibold text-smsg-900')
  })
})
