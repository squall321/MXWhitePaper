import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RetentionPoliciesPage } from '../RetentionPolicies'

vi.mock('@/features/retention/api', () => ({
  ALL_RETENTION_ACTIONS: ['archive', 'notify_owner', 'transition'],
  ALL_RETENTION_TRIGGER_FIELDS: ['updated_at', 'last_read_at', 'created_at'],
  listRetentionPolicies: vi.fn(async () => []),
  createRetentionPolicy: vi.fn(),
  patchRetentionPolicy: vi.fn(),
  deleteRetentionPolicy: vi.fn(),
  dryRunRetentionPolicy: vi.fn(),
  runRetentionPolicy: vi.fn(),
  listRetentionRuns: vi.fn(async () => []),
}))

function renderPage(): string {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/admin/retention']}>
        <RetentionPoliciesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('<RetentionPoliciesPage />', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the page chrome on the SSR pass', () => {
    const html = renderPage()
    expect(html).toContain('data-testid="retention-policies-page"')
    expect(html).toContain('문서 보존 정책')
    expect(html).toContain('data-testid="retention-add-button"')
  })

  it('does not crash with an empty policy list', () => {
    expect(() => renderPage()).not.toThrow()
  })

  it('does not pre-render any policy rows before queries resolve', () => {
    const html = renderPage()
    expect(html).not.toContain('data-testid="retention-row-')
  })
})
