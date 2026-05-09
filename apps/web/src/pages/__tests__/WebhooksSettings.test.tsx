import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WebhooksSettingsPage } from '../WebhooksSettings'

vi.mock('@/features/webhooks/api', () => ({
  ALL_WEBHOOK_EVENTS: [
    'doc_created',
    'doc_edited',
    'doc_published',
    'comment_added',
    'review_decided',
  ],
  listWebhooks: vi.fn(async () => []),
  createWebhook: vi.fn(),
  patchWebhook: vi.fn(),
  deleteWebhook: vi.fn(),
  testWebhook: vi.fn(),
  listDeliveries: vi.fn(async () => []),
}))

vi.mock('@/features/auth/store', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) =>
    selector({ user: { id: 'u1', role: 'admin' } }),
}))

function renderPage(): string {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/admin/webhooks']}>
        <WebhooksSettingsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('<WebhooksSettingsPage />', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the page chrome on the SSR pass', () => {
    const html = renderPage()
    expect(html).toContain('data-testid="webhooks-settings-page"')
    expect(html).toContain('웹훅')
    expect(html).toContain('data-testid="webhook-add-button"')
  })

  it('does not crash when the list is empty', () => {
    expect(() => renderPage()).not.toThrow()
  })

  it('does not show any webhook rows before queries resolve', () => {
    const html = renderPage()
    expect(html).not.toContain('data-testid="webhook-row-')
  })
})
