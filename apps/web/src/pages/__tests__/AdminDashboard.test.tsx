import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// Stub the admin api so tests don't hit the network.
vi.mock('@/features/admin/api', () => ({
  listAdminUsers: () =>
    Promise.resolve([
      {
        id: 'u1',
        email: 'admin@mx.local',
        name: 'Admin',
        role: 'admin',
        team_id: null,
        is_active: true,
        created_at: '2026-05-08T00:00:00Z',
        last_login_at: '2026-05-08T01:00:00Z',
      },
    ]),
  patchAdminUser: () => Promise.resolve({}),
  listAuditLogs: () => Promise.resolve([]),
  listAuditViewer: () =>
    Promise.resolve({
      items: [],
      meta: { count: 0, total: 0, limit: 50, offset: 0 },
    }),
  listAuditActions: () => Promise.resolve([]),
  auditCsvUrl: () => '/api/v1/audit/csv',
  getAdminHealth: () =>
    Promise.resolve({
      docs_active: 1,
      docs_archived: 0,
      users_active: 1,
      users_inactive: 0,
      audit_24h: 0,
      images: 0,
      pending_uploads: 0,
      meilisearch_docs: 0,
    }),
  runMaintenance: () =>
    Promise.resolve({ purged_pending: 0, compacted_versions: 0 }),
}))

vi.mock('@/features/org/hooks/useOrgTree', () => ({
  useOrgTree: () => ({ data: [], isPending: false, isError: false, error: null, refetch: () => {} }),
}))

// Auth store stub — admin user.
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

import { AdminDashboardPage } from '../AdminDashboard'

function render(node: React.ReactNode): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('<AdminDashboardPage />', () => {
  beforeEach(() => {
    authState.current = { user: { id: 'u1', email: 'admin@mx.local', role: 'admin' } }
  })

  it('renders the four operational tabs + orgs tab', () => {
    const html = render(<AdminDashboardPage />)
    expect(html).toContain('관리자 대시보드')
    expect(html).toContain('사용자')
    expect(html).toContain('감사 로그')
    expect(html).toContain('시스템 상태')
    expect(html).toContain('유지보수')
    expect(html).toContain('조직')
  })

  it('redirects non-admin users away from the dashboard', () => {
    authState.current = { user: { id: 'u2', email: 'reader@mx.local', role: 'reader' } }
    const html = render(<AdminDashboardPage />)
    // Navigate replaces — the dashboard heading is not rendered.
    expect(html).not.toContain('관리자 대시보드')
  })

  it('returns null while no user is loaded', () => {
    authState.current = { user: null }
    const html = render(<AdminDashboardPage />)
    expect(html).not.toContain('관리자 대시보드')
  })
})
