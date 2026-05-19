import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { GlossaryRefBlockView } from '../GlossaryRefBlock'
import type { GlossaryRefBlock } from '@/types/document'

// Inject a controllable `useGlossary` so each test can pick "known" vs
// "broken" without going through the network.
const lookupMock = vi.fn<(term: string) => string | undefined>()
vi.mock('@/features/glossary/useGlossary', () => ({
  useGlossary: () => ({
    terms: [],
    lookup: lookupMock,
    findEntry: () => undefined,
  }),
}))

function harness(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  })
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>
}

const baseBlock: GlossaryRefBlock = {
  type: 'glossary-ref',
  id: '01TESTGLOSSARYREF0000000001',
  term: 'ASP',
}

describe('<GlossaryRefBlockView /> broken-ref visualisation (M11)', () => {
  beforeEach(() => {
    lookupMock.mockReset()
  })

  it('known term renders the definition with smsg accent (no warning)', () => {
    lookupMock.mockReturnValue('Advanced Smartphone Platform')
    const html = renderToStaticMarkup(harness(<GlossaryRefBlockView block={baseBlock} />))
    expect(html).toContain('Advanced Smartphone Platform')
    expect(html).toContain('border-smsg-500')
    expect(html).not.toContain('⚠️')
    expect(html).not.toContain('용어 사전에 없음')
  })

  it('unknown term renders ⚠️ icon + neutral gray styling (broken-ref)', () => {
    lookupMock.mockReturnValue(undefined)
    const html = renderToStaticMarkup(harness(<GlossaryRefBlockView block={baseBlock} />))
    expect(html).toContain('⚠️')
    expect(html).toContain('용어 사전에 없음')
    expect(html).toContain('border-gray-400')
    expect(html).toContain('data-glossary-ref-broken')
  })
})
