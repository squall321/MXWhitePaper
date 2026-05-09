import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// Stub the dashboard fetch so the static render exercises the success path.
vi.mock('@/features/admin/api', () => ({
  getHealthDashboard: () =>
    Promise.resolve({
      uptime_seconds: 3725,
      version: 'abc1234 2026-05-09T00:00:00Z',
      database: { pool_size: 10, checked_out: 1, overflow: 0, ok: true },
      minio: {
        endpoint: 'http://minio:9000',
        buckets: [
          { name: 'mxwp-images', count: 12, size_bytes: 4096 },
          { name: 'mxwp-files', count: 0, size_bytes: 0 },
        ],
        ok: true,
      },
      meilisearch: {
        url: 'http://meilisearch:7700',
        indexes: [{ uid: 'documents', count: 105 }],
        ok: true,
      },
      tickers: [
        {
          name: 'backup',
          running: true,
          last_tick_at: '2026-05-09T00:00:00Z',
          next_due_at: '2026-05-09T00:01:00Z',
        },
        {
          name: 'digest',
          running: false,
          last_tick_at: null,
          next_due_at: null,
        },
      ],
      errors_24h: 3,
      rate_limit: { active_buckets: 1, active_blocks: 0 },
      queue_depths: {
        automation_pending: 0,
        webhook_deliveries_pending: 0,
        subscription_digest_buffer: 0,
      },
    }),
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

import { HealthDashboardPage } from '../HealthDashboard'

function render(node: React.ReactNode): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('<HealthDashboardPage />', () => {
  beforeEach(() => {
    authState.current = { user: { id: 'u1', email: 'admin@mx.local', role: 'admin' } }
  })

  it('renders the page heading + refresh controls', () => {
    const html = render(<HealthDashboardPage />)
    expect(html).toContain('시스템 상태 대시보드')
    expect(html).toContain('지금 새로고침')
    expect(html).toContain('자동 새로고침')
  })

  it('redirects non-admin users away', () => {
    authState.current = { user: { id: 'u2', email: 'r@mx.local', role: 'reader' } }
    const html = render(<HealthDashboardPage />)
    expect(html).not.toContain('시스템 상태 대시보드')
  })

  it('returns null while no user is loaded', () => {
    authState.current = { user: null }
    const html = render(<HealthDashboardPage />)
    expect(html).not.toContain('시스템 상태 대시보드')
  })
})
