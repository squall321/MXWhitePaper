import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    useOutletContext: () => ({
      setLeftRail: () => {},
      setRightRail: () => {},
      openPalette: () => {},
    }),
  }
})

vi.mock('@/features/bookmarks/api', () => ({
  listRecentReads: vi.fn(async () => [
    {
      document_id: 'a-uuid',
      slug: 'alpha',
      title: 'Alpha doc',
      summary: '알파 요약',
      read_at: '2026-05-08T01:00:00Z',
      read_seconds: 120,
      bookmarked: true,
    },
    {
      document_id: 'b-uuid',
      slug: 'beta',
      title: 'Beta doc',
      summary: 'beta summary',
      read_at: '2026-05-07T12:00:00Z',
      read_seconds: 0,
      bookmarked: false,
    },
  ]),
  listBookmarks: vi.fn(async () => [
    { id: 'bm1', document_id: 'a-uuid', slug: 'alpha', title: 'Alpha doc', folder: null, notes: null, created_at: '2026-05-08T00:00:00Z' },
  ]),
  listFolders: vi.fn(async () => []),
  createBookmark: vi.fn(),
  deleteBookmark: vi.fn(),
  patchBookmark: vi.fn(),
  postRead: vi.fn(),
}))

import { ReadListPage } from '../ReadList'

function render(seed: Array<Record<string, unknown>>): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  qc.setQueryData(['reads', 'recent', 50], seed)
  qc.setQueryData(['bookmarks', null], [])
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/reads']}>
        <ReadListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('<ReadListPage />', () => {
  it('renders a header + sort selector + bookmark toggle', () => {
    const html = render([])
    expect(html).toContain('읽은 문서')
    expect(html).toContain('data-testid="reads-bookmarked-toggle"')
    expect(html).toContain('data-testid="reads-sort"')
  })

  it('shows the empty state when there are no rows', () => {
    const html = render([])
    expect(html).toContain('아직 읽은 문서가 없어요')
  })

  it('renders provided rows with title + reading time', () => {
    const html = render([
      {
        document_id: 'a',
        slug: 'alpha',
        title: 'Alpha doc',
        summary: '알파 요약',
        read_at: '2026-05-08T01:00:00Z',
        read_seconds: 120,
        bookmarked: true,
      },
      {
        document_id: 'b',
        slug: 'beta',
        title: 'Beta doc',
        summary: null,
        read_at: '2026-05-07T12:00:00Z',
        read_seconds: 0,
        bookmarked: false,
      },
    ])
    expect(html).toContain('Alpha doc')
    expect(html).toContain('Beta doc')
    expect(html).toContain('읽은 시간')
    expect(html).toContain('미열람')
  })
})
