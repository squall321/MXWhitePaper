import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SsoProvidersPage } from '../SsoProviders'

vi.mock('@/features/sso/api', () => ({
  ALL_SSO_KINDS: ['saml', 'oidc'],
  ALL_SSO_DEFAULT_ROLES: ['reader', 'editor', 'owner', 'admin'],
  listSsoProviders: vi.fn(async () => []),
  createSsoProvider: vi.fn(),
  patchSsoProvider: vi.fn(),
  deleteSsoProvider: vi.fn(),
  getSsoProvider: vi.fn(),
  discoverSsoProvider: vi.fn(),
}))

function renderPage(): string {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/admin/sso']}>
        <SsoProvidersPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('<SsoProvidersPage />', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the page chrome on the SSR pass', () => {
    const html = renderPage()
    expect(html).toContain('data-testid="sso-providers-page"')
    expect(html).toContain('SSO 제공자')
    expect(html).toContain('data-testid="sso-add-button"')
  })

  it('does not crash with an empty provider list', () => {
    expect(() => renderPage()).not.toThrow()
  })

  it('does not pre-render any provider rows before the query resolves', () => {
    const html = renderPage()
    expect(html).not.toContain('data-testid="sso-row-')
  })
})
