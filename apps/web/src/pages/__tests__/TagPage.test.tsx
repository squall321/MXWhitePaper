import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TagPage } from '../TagPage'

// Capture the params useDocumentList is called with so we can assert the
// route param flows into the API filter.
const listSpy = vi.fn()

vi.mock('@/features/document/hooks/useDocumentList', () => ({
  useDocumentList: (params: Record<string, unknown>) => {
    listSpy(params)
    return {
      data: [
        { id: '1', slug: 'foo', title: 'Foo', summary: '요약', team: 'HE팀', tags: ['kpi'] },
        { id: '2', slug: 'bar', title: 'Bar', summary: '요약 2', team: '개발팀', tags: ['kpi', 'release'] },
      ],
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    }
  },
}))

function withProviders(node: React.ReactNode, initial: string, path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route path={path} element={node} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('<TagPage />', () => {
  it('passes the route param to useDocumentList as the tag filter', () => {
    listSpy.mockClear()
    renderToStaticMarkup(
      withProviders(<TagPage mode="tag" />, '/tags/kpi', '/tags/:tag'),
    )
    expect(listSpy).toHaveBeenCalled()
    const last = listSpy.mock.calls.at(-1)?.[0] as { tag?: string }
    expect(last?.tag).toBe('kpi')
  })

  it('renders the heading with the tag name', () => {
    const html = renderToStaticMarkup(
      withProviders(<TagPage mode="tag" />, '/tags/kpi', '/tags/:tag'),
    )
    expect(html).toContain('#kpi')
    expect(html).toContain('태그')
  })

  it('renders the heading with the category name', () => {
    const html = renderToStaticMarkup(
      withProviders(<TagPage mode="category" />, '/category/release', '/category/:cat'),
    )
    expect(html).toContain('release')
    expect(html).toContain('카테고리')
  })

  it('renders document cards from the list', () => {
    const html = renderToStaticMarkup(
      withProviders(<TagPage mode="tag" />, '/tags/kpi', '/tags/:tag'),
    )
    expect(html).toContain('Foo')
    expect(html).toContain('Bar')
  })
})
