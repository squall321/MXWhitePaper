import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WorkflowChainsPage } from '../WorkflowChains'

vi.mock('@/features/workflow-chains/api', () => ({
  ALL_FAIL_STRATEGIES: ['halt', 'continue', 'rollback'],
  listWorkflowChains: vi.fn(async () => []),
  createWorkflowChain: vi.fn(),
  patchWorkflowChain: vi.fn(),
  deleteWorkflowChain: vi.fn(),
  runWorkflowChainNow: vi.fn(),
  listWorkflowChainRuns: vi.fn(async () => []),
}))

vi.mock('@/features/automation/api', () => ({
  ALL_AUTOMATION_ACTIONS: [
    'webhook',
    'notification_blast',
    'add_tag',
    'remove_tag',
    'transition',
    'email_subscribers',
  ],
}))

function renderPage(): string {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/admin/workflow-chains']}>
        <WorkflowChainsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('<WorkflowChainsPage />', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the page chrome on the SSR pass', () => {
    const html = renderPage()
    expect(html).toContain('data-testid="workflow-chains-page"')
    expect(html).toContain('워크플로우 체인')
    expect(html).toContain('data-testid="workflow-chain-add-button"')
  })

  it('does not crash with an empty chain list', () => {
    expect(() => renderPage()).not.toThrow()
  })

  it('does not pre-render any chain rows before queries resolve', () => {
    const html = renderPage()
    expect(html).not.toContain('data-testid="workflow-chain-row-')
  })
})
