import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

/**
 * Zustand's useSyncExternalStore SSR snapshot is sticky, so we mock the
 * store directly with a swappable holder. This mirrors the pattern used
 * by `pages/__tests__/AdminOrgs.test.tsx`.
 */
const authState = {
  current: {
    user: null as null | { id: string; email: string; role: string },
    hydrating: false,
  },
}
vi.mock('@/features/auth/store', () => ({
  useAuthStore: Object.assign(
    (selector: (s: typeof authState.current) => unknown) =>
      selector(authState.current),
    {
      getState: () => authState.current,
      setState: () => {},
    },
  ),
}))

import { AuthGuard } from '../AuthGuard'

function render(initialPath: string, children: React.ReactNode): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/login" element={<div data-testid="login-page">로그인</div>} />
        <Route path="/*" element={<AuthGuard>{children}</AuthGuard>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('<AuthGuard />', () => {
  beforeEach(() => {
    authState.current = { user: null, hydrating: false }
  })

  it('renders the hydration shim while the auth store is hydrating', () => {
    authState.current = { user: null, hydrating: true }
    const html = render('/', <div data-testid="protected">secret</div>)
    expect(html).toContain('세션 확인 중')
    expect(html).not.toContain('protected')
  })

  it('redirects unauthenticated users away from protected children (no loop)', () => {
    authState.current = { user: null, hydrating: false }
    const html = render('/', <div data-testid="protected">secret</div>)
    // SSR renders nothing for <Navigate>, but the key invariant is that the
    // protected children are NOT visible — the redirect path runs and the
    // guard returns the navigate component instead of the children.
    expect(html).not.toContain('secret')
    expect(html).not.toContain('세션 확인 중')
  })

  it('renders children when a user is present', () => {
    authState.current = {
      user: { id: 'u', email: 'a@b', role: 'admin' },
      hydrating: false,
    }
    const html = render('/', <div data-testid="protected">secret</div>)
    expect(html).toContain('secret')
  })

  it('honours the ?dev bypass — renders children even with no user', () => {
    authState.current = { user: null, hydrating: false }
    // import.meta.env.DEV defaults to true under vitest; the bypass also
    // requires the literal `?dev` query param.
    const html = render('/?dev', <div data-testid="protected">dev-bypass</div>)
    expect(html).toContain('dev-bypass')
  })
})
