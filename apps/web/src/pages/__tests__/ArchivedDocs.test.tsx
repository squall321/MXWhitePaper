import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('@/features/admin/api', () => ({
  listArchivedDocs: () =>
    Promise.resolve({
      items: [
        {
          slug: 'old-doc',
          title: '오래된 문서',
          archived_at: '2026-04-01T00:00:00Z',
          owner_id: 'u1',
          owner_name: 'Admin',
          owner_email: 'admin@mx.local',
          last_edited_at: '2026-03-25T00:00:00Z',
        },
      ],
      meta: { count: 1, total: 1, limit: 50, offset: 0 },
    }),
  restoreArchivedDocs: () =>
    Promise.resolve({ restored: ['old-doc'], skipped: [] }),
  purgeArchivedDocs: () =>
    Promise.resolve({ purged: ['old-doc'], skipped: [] }),
}))

const authState = {
  current: { user: { id: 'u1', email: 'admin@mx.local', role: 'admin' } as
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

import { ArchivedDocsPage } from '../ArchivedDocs'

function render(node: React.ReactNode): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('<ArchivedDocsPage />', () => {
  beforeEach(() => {
    authState.current = {
      user: { id: 'u1', email: 'admin@mx.local', role: 'admin' },
    }
  })

  it('renders the page header and filter inputs for admin', () => {
    const html = render(<ArchivedDocsPage />)
    expect(html).toContain('보관 문서 관리')
    expect(html).toContain('보관일')
    expect(html).toContain('작성자')
    expect(html).toContain('부서')
    expect(html).toContain('archived-since-days')
    expect(html).toContain('archived-author')
    expect(html).toContain('archived-refresh')
  })

  it('redirects non-admin users away', () => {
    authState.current = {
      user: { id: 'u2', email: 'reader@mx.local', role: 'reader' },
    }
    const html = render(<ArchivedDocsPage />)
    expect(html).not.toContain('보관 문서 관리')
  })

  it('returns null while no user is loaded', () => {
    authState.current = { user: null }
    const html = render(<ArchivedDocsPage />)
    expect(html).not.toContain('보관 문서 관리')
  })
})
