import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('@/features/analytics/api', () => ({
  getOverview: () =>
    Promise.resolve({
      mau: 5,
      total_docs: 12,
      total_links: 30,
      avg_backlinks: 2.5,
      top_searches: [{ q: '시뮬레이션', count: 3 }],
      top_viewed_docs: [
        { target: 'document:cae', slug: 'cae', title: 'CAE Intro', count: 7 },
      ],
    }),
  getDaily: (days: number) =>
    Promise.resolve(
      Array.from({ length: days }, (_, i) => ({
        date: `2026-05-${String(i + 1).padStart(2, '0')}`,
        active_users: i,
        doc_writes: 0,
        doc_reads: 1,
        search_count: 0,
      })),
    ),
  getTopViews: () =>
    Promise.resolve([
      { target: 'document:cae', slug: 'cae', title: 'CAE Intro', count: 7 },
    ]),
  getTopDocs: () =>
    Promise.resolve([
      {
        slug: 'cae',
        title: 'CAE Intro',
        views: 42,
        unique_readers: 7,
        avg_read_seconds: 60,
      },
    ]),
  getInactiveDocs: () =>
    Promise.resolve([
      {
        slug: 'old',
        title: 'Old Doc',
        last_edited: '2026-01-01T00:00:00Z',
        last_read: null,
        owner_name: 'Alice',
      },
    ]),
}))

const authState = {
  current: { user: { id: 'u1', email: 'a@b', role: 'admin' } as
    | null
    | { id: string; email: string; role: string } },
}
vi.mock('@/features/auth/store', () => ({
  useAuthStore: Object.assign(
    (selector: (s: { user: typeof authState.current.user }) => unknown) =>
      selector({ user: authState.current.user }),
    {
      getState: () => ({ user: authState.current.user }),
      setState: () => {},
    },
  ),
}))

// Recharts uses ResponsiveContainer that needs a measurable parent in jsdom —
// stub it so we just render its child.
vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts')
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="rcr-stub">{children}</div>
    ),
  }
})

import { AnalyticsPage } from '../Analytics'

function render(node: React.ReactNode): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('<AnalyticsPage />', () => {
  beforeEach(() => {
    authState.current = { user: { id: 'u1', email: 'a@b', role: 'admin' } }
  })

  it('renders cards and the days dropdown', () => {
    const html = render(<AnalyticsPage />)
    expect(html).toContain('사용량 분석')
    expect(html).toContain('월간 활성 유저')
    expect(html).toContain('총 문서')
    expect(html).toContain('평균 backlinks')
    expect(html).toContain('Top 검색')
    expect(html).toContain('analytics-days')
    expect(html).toContain('최근 30일')
  })

  it('returns null when user is not authenticated', () => {
    authState.current = { user: null }
    const html = render(<AnalyticsPage />)
    expect(html).not.toContain('사용량 분석')
  })

  it('renders tab navigation including the admin-only inactive tab', () => {
    const html = render(<AnalyticsPage />)
    expect(html).toContain('analytics-tabs')
    expect(html).toContain('인기 문서')
    expect(html).toContain('비활성 문서')
    expect(html).toContain('활동 추이')
  })

  it('hides the inactive-docs tab for non-admin users', () => {
    authState.current = { user: { id: 'u2', email: 'r@b', role: 'reader' } }
    const html = render(<AnalyticsPage />)
    expect(html).toContain('인기 문서')
    expect(html).not.toContain('비활성 문서')
  })
})
