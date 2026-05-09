import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// Stub the admin api so the page renders synchronously without network.
vi.mock('@/features/admin/api', () => ({
  listAuditViewer: vi.fn(async () => ({
    items: [
      {
        id: 'a1',
        actor_user_id: 'u1',
        actor_name: 'Admin',
        action: 'document.create',
        target_kind: 'document',
        target_id: 'sample-slug',
        payload: { version: 1 },
        created_at: '2026-05-08T01:00:00Z',
      },
    ],
    meta: { count: 1, total: 1, limit: 50, offset: 0 },
  })),
  listAuditActions: vi.fn(async () => ['document.create', 'document.update']),
  auditCsvUrl: (params: Record<string, unknown>) => {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) {
      if (v != null && v !== '') qs.set(k, String(v))
    }
    return `/api/v1/audit/csv?${qs.toString()}`
  },
}))

const authState = {
  current: { user: null as null | { id: string; email: string; role: string } },
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

import { AuditLogPage } from '../AuditLog'

function render(node: React.ReactNode): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('<AuditLogPage />', () => {
  beforeEach(() => {
    authState.current = { user: { id: 'u1', email: 'admin@mx.local', role: 'admin' } }
  })

  it('renders the heading + filter chips for an admin', () => {
    const html = render(<AuditLogPage />)
    expect(html).toContain('감사 로그')
    expect(html).toContain('CSV 내보내기')
    // filter inputs surface their data-testids
    expect(html).toContain('data-testid="audit-since"')
    expect(html).toContain('data-testid="audit-until"')
    expect(html).toContain('data-testid="audit-actor"')
    expect(html).toContain('data-testid="audit-action"')
    expect(html).toContain('data-testid="audit-tkind"')
    expect(html).toContain('data-testid="audit-csv"')
  })

  it('redirects non-admin users away', () => {
    authState.current = { user: { id: 'u2', email: 'r@mx.local', role: 'reader' } }
    const html = render(<AuditLogPage />)
    // Navigate replaces — heading should not appear.
    expect(html).not.toContain('감사 로그')
  })

  it('returns null while no user is loaded', () => {
    authState.current = { user: null }
    const html = render(<AuditLogPage />)
    expect(html.length).toBeLessThan(40)
  })

  it('embedded mode skips the page header', () => {
    const html = render(<AuditLogPage embedded />)
    // Header `<h1>감사 로그</h1>` is gone but filter chips remain.
    expect(html).not.toContain('<h1')
    expect(html).toContain('data-testid="audit-log-page"')
    expect(html).toContain('data-testid="audit-csv"')
  })
})
