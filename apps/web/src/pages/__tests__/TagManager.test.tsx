import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('@/features/tags/api', () => ({
  listTags: vi.fn(async () => [
    { name: 'kpi', count: 5 },
    { name: 'release', count: 3 },
  ]),
  renameTag: vi.fn(async () => 1),
  deleteTag: vi.fn(async () => 1),
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

import { TagManagerPage } from '../TagManager'

function renderWithProviders(node: React.ReactNode): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('<TagManagerPage />', () => {
  beforeEach(() => {
    authState.current = { user: null }
  })

  it('redirects unauthenticated users (returns null markup)', () => {
    const html = renderWithProviders(<TagManagerPage />)
    // Empty render output for null user.
    expect(html.length).toBeLessThan(40)
  })

  it('redirects readers to /', () => {
    authState.current = {
      user: { id: 'u1', email: 'r@mx.local', role: 'reader' },
    }
    // Renders a <Navigate /> which produces no markup; just ensure no crash.
    const html = renderWithProviders(<TagManagerPage />)
    expect(html).not.toContain('태그 관리')
  })

  it('renders the tag manager scaffold for an admin', () => {
    authState.current = {
      user: { id: 'u1', email: 'admin@mx.local', role: 'admin' },
    }
    const html = renderWithProviders(<TagManagerPage />)
    expect(html).toContain('태그 관리')
    expect(html).toContain('data-testid="tag-manager-page"')
  })
})
