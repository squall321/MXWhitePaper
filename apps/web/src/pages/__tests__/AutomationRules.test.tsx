import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AutomationRulesPage } from '../AutomationRules'

vi.mock('@/features/automation/api', () => ({
  ALL_AUTOMATION_TRIGGERS: [
    'doc_published',
    'doc_archived',
    'review_decided',
    'status_transition',
    'comment_added',
    'tag_added',
  ],
  ALL_AUTOMATION_ACTIONS: [
    'webhook',
    'notification_blast',
    'add_tag',
    'remove_tag',
    'transition',
    'email_subscribers',
  ],
  listAutomationRules: vi.fn(async () => []),
  createAutomationRule: vi.fn(),
  patchAutomationRule: vi.fn(),
  deleteAutomationRule: vi.fn(),
  testAutomationRule: vi.fn(),
  listAutomationRuns: vi.fn(async () => []),
}))

function renderPage(): string {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/admin/automation']}>
        <AutomationRulesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('<AutomationRulesPage />', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the page chrome on the SSR pass', () => {
    const html = renderPage()
    expect(html).toContain('data-testid="automation-rules-page"')
    expect(html).toContain('워크플로우 자동화')
    expect(html).toContain('data-testid="automation-add-button"')
  })

  it('does not crash with an empty rule list', () => {
    expect(() => renderPage()).not.toThrow()
  })

  it('does not pre-render any rule rows before queries resolve', () => {
    const html = renderPage()
    expect(html).not.toContain('data-testid="automation-row-')
  })
})
