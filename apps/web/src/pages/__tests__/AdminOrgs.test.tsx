import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// Stub the org tree hook so tests don't hit the network. The shape mirrors
// what GET /orgs/tree returns after the Cycle 14 reset.
vi.mock('@/features/org/hooks/useOrgTree', () => ({
  useOrgTree: () => ({
    data: [
      {
        id: 'd1',
        slug: 'mx',
        name: 'MX 사업부',
        teams: [
          {
            id: 't1',
            slug: 'dev',
            name: '개발실',
            groups: [
              {
                id: 'g1',
                slug: 'he-team',
                name: 'HE팀',
                parts: [{ id: 'p1', slug: 'cae', name: 'CAE그룹' }],
              },
            ],
          },
        ],
      },
    ],
    isPending: false,
    isError: false,
    error: null,
  }),
}))

// Zustand's useSyncExternalStore SSR path returns the initial snapshot, so
// updates via `useAuthStore.setState()` are invisible to renderToStaticMarkup.
// Mock the store directly with a swappable holder that the test cases can
// re-point per-render.
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

import { AdminOrgsPage } from '../AdminOrgs'

function renderWithProviders(node: React.ReactNode): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('<AdminOrgsPage />', () => {
  beforeEach(() => {
    authState.current = { user: null }
  })

  it('renders the four-level tree for an admin user', () => {
    authState.current = {
      user: { id: 'u1', email: 'admin@mx.local', role: 'admin' },
    }
    const html = renderWithProviders(<AdminOrgsPage />)
    expect(html).toContain('MX 사업부')
    expect(html).toContain('개발실')
    expect(html).toContain('HE팀')
    expect(html).toContain('CAE그룹')
    // Action buttons + slug pills are visible.
    expect(html).toContain('+ 팀 추가')
    expect(html).toContain('+ 그룹 추가')
    expect(html).toContain('+ 파트 추가')
    // Each level pill label.
    expect(html).toContain('사업부')
    expect(html).toContain('팀')
    expect(html).toContain('그룹')
    expect(html).toContain('파트')
  })

  it('redirects non-admin users to "/"', () => {
    authState.current = {
      user: { id: 'u2', email: 'editor@mx.local', role: 'editor' },
    }
    const html = renderWithProviders(<AdminOrgsPage />)
    // <Navigate> renders nothing in SSR — the admin tree must be absent.
    expect(html).not.toContain('MX 사업부')
    expect(html).not.toContain('조직 관리')
  })

  it('renders nothing when the user is missing (pre-auth boot)', () => {
    const html = renderWithProviders(<AdminOrgsPage />)
    expect(html).not.toContain('조직 관리')
  })
})
