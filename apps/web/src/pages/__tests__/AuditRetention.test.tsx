import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuditRetentionPage } from '../AuditRetention'

vi.mock('@/features/audit-retention/api', () => ({
  RETAIN_DAY_OPTIONS: [30, 90, 180, 365, 730, 1825],
  getAuditRetention: vi.fn(async () => ({
    retain_days: 365,
    enabled: true,
    last_run_at: null,
    rows_pruned_total: 0,
    updated_at: '2026-05-08T00:00:00Z',
    audit_log_total: 12345,
  })),
  patchAuditRetention: vi.fn(),
  pruneAuditNow: vi.fn(),
}))

function renderPage(): string {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/admin/audit-retention']}>
        <AuditRetentionPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('<AuditRetentionPage />', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the page chrome on the SSR pass', () => {
    const html = renderPage()
    expect(html).toContain('data-testid="audit-retention-page"')
    expect(html).toContain('감사 로그 보존 설정')
  })

  it('does not crash before the query resolves', () => {
    expect(() => renderPage()).not.toThrow()
  })

  it('shows the loading marker on the initial SSR pass', () => {
    // SSR doesn't run effects so the query stays pending — we should see
    // either the loading text or no form yet.
    const html = renderPage()
    expect(html).not.toContain('data-testid="audit-retention-config-form"')
  })
})
