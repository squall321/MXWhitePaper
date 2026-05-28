import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * Mock useGlossarySearch directly so the page renders deterministic data
 * without hitting the real React Query → axios stack during SSR.
 */
const searchState: {
  items: Array<{
    id: string
    term: string
    definition: string
    domain: string | null
    subdomain: string | null
    term_en: string | null
    aliases: string[]
    status: 'approved'
  }>
  total: number
  domains: Array<{ id: string; slug: string; name: string; parent_id: string | null }>
  isPending: boolean
  isError: boolean
} = {
  items: [
    {
      id: 't1',
      term: '커널',
      definition: '입출력 합성곱의 작은 행렬',
      domain: 'ml',
      subdomain: null,
      term_en: 'kernel',
      aliases: ['kernel', '필터'],
      status: 'approved',
    },
    {
      id: 't2',
      term: '레지스터',
      definition: 'CPU 내부의 작은 저장소',
      domain: 'general',
      subdomain: null,
      term_en: 'register',
      aliases: [],
      status: 'approved',
    },
  ],
  total: 2,
  domains: [
    { id: 'd1', slug: 'general', name: '일반', parent_id: null },
    { id: 'd2', slug: 'ml', name: '머신러닝', parent_id: null },
  ],
  isPending: false,
  isError: false,
}

vi.mock('@/features/glossary/useGlossarySearch', () => ({
  useGlossarySearch: () => ({
    list: {
      data: { items: searchState.items, total: searchState.total, page: 1, size: 20 },
      isPending: searchState.isPending,
      isError: searchState.isError,
    },
    domains: {
      data: searchState.domains,
      isPending: false,
      isError: false,
    },
    isEmpty: !searchState.isPending && searchState.items.length === 0,
  }),
}))

import { GlossaryPage } from '../Glossary'

function render(node: React.ReactNode): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('<GlossaryPage />', () => {
  beforeEach(() => {
    searchState.items = [
      {
        id: 't1',
        term: '커널',
        definition: '입출력 합성곱의 작은 행렬',
        domain: 'ml',
        subdomain: null,
        term_en: 'kernel',
        aliases: ['kernel', '필터'],
        status: 'approved',
      },
      {
        id: 't2',
        term: '레지스터',
        definition: 'CPU 내부의 작은 저장소',
        domain: 'general',
        subdomain: null,
        term_en: 'register',
        aliases: [],
        status: 'approved',
      },
    ]
    searchState.total = 2
    searchState.isPending = false
    searchState.isError = false
  })

  it('renders header, search input, and domain sidebar', () => {
    const html = render(<GlossaryPage />)
    expect(html).toContain('용어집')
    expect(html).toContain('data-testid="glossary-page"')
    expect(html).toContain('data-testid="glossary-search"')
    expect(html).toContain('data-testid="glossary-domain-sidebar"')
    expect(html).toContain('data-testid="glossary-domain-chips"')
    // Domain options seeded by the mock — both desktop sidebar + mobile chips.
    expect(html).toContain('일반')
    expect(html).toContain('머신러닝')
    // "전체" reset entry.
    expect(html).toContain('전체')
  })

  it('renders one card per term with definition and aliases', () => {
    const html = render(<GlossaryPage />)
    expect(html).toContain('data-testid="glossary-cards"')
    expect(html).toContain('data-testid="glossary-card-t1"')
    expect(html).toContain('data-testid="glossary-card-t2"')
    expect(html).toContain('커널')
    expect(html).toContain('레지스터')
    expect(html).toContain('입출력 합성곱의 작은 행렬')
    expect(html).toContain('kernel') // term_en + alias
    expect(html).toContain('필터') // alias chip
  })

  it('shows the empty-state with a propose-link when no terms match', () => {
    searchState.items = []
    searchState.total = 0
    const html = render(<GlossaryPage />)
    expect(html).toContain('data-testid="glossary-empty"')
    expect(html).toContain('검색 결과가 없습니다')
    expect(html).toContain('data-testid="glossary-propose-link"')
    expect(html).toContain('용어 제안하기')
    // No cards/pagination when empty.
    expect(html).not.toContain('data-testid="glossary-cards"')
    expect(html).not.toContain('data-testid="glossary-pagination"')
  })

  it('renders the loading indicator while the list query is pending', () => {
    searchState.isPending = true
    searchState.items = []
    const html = render(<GlossaryPage />)
    expect(html).toContain('data-testid="glossary-loading"')
    expect(html).toContain('불러오는 중')
  })

  it('renders pagination when total exceeds one page', () => {
    // 25 items total, size=20 → 2 pages.
    searchState.total = 25
    const html = render(<GlossaryPage />)
    expect(html).toContain('data-testid="glossary-pagination"')
    expect(html).toContain('이전')
    expect(html).toContain('다음')
  })
})
