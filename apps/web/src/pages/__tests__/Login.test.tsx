import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

// The login page reads the auth store synchronously to short-circuit when
// the user is already signed in. Mock the same way as AuthGuard tests.
const authState = {
  current: {
    user: null as null | { id: string; email: string; role: string },
    hydrating: false,
  },
}
vi.mock('@/features/auth/store', () => ({
  useAuthStore: Object.assign(
    (selector: (s: typeof authState.current) => unknown) => selector(authState.current),
    { getState: () => authState.current, setState: () => {} },
  ),
}))

// Don't pull in the real axios pipeline.
vi.mock('@/features/auth/api', () => ({
  login: vi.fn(),
}))

import { LoginPage, safeReturnPath } from '../Login'

function renderLogin(initial: string): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<div data-testid="home">홈</div>} />
        <Route path="/docs/*" element={<div>docs</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('safeReturnPath()', () => {
  it('returns "/" for empty / null input', () => {
    expect(safeReturnPath(null)).toBe('/')
    expect(safeReturnPath(undefined)).toBe('/')
    expect(safeReturnPath('')).toBe('/')
  })

  it('rejects protocol-relative URLs', () => {
    expect(safeReturnPath('//evil.com/path')).toBe('/')
  })

  it('rejects absolute URLs (http, https, javascript:, data:)', () => {
    expect(safeReturnPath('http://evil.com')).toBe('/')
    expect(safeReturnPath('https://evil.com/x')).toBe('/')
    expect(safeReturnPath('javascript:alert(1)')).toBe('/')
    expect(safeReturnPath('data:text/html,foo')).toBe('/')
  })

  it('rejects relative URLs that don\'t start with /', () => {
    expect(safeReturnPath('docs/foo')).toBe('/')
    expect(safeReturnPath('./foo')).toBe('/')
  })

  it('passes through legitimate same-origin paths', () => {
    expect(safeReturnPath('/')).toBe('/')
    expect(safeReturnPath('/docs/quarterly-report')).toBe('/docs/quarterly-report')
    expect(safeReturnPath('/docs/foo?fullEdit=1')).toBe('/docs/foo?fullEdit=1')
  })
})

describe('<LoginPage />', () => {
  beforeEach(() => {
    authState.current = { user: null, hydrating: false }
  })

  it('renders the form with Korean labels and a brand badge', () => {
    const html = renderLogin('/login')
    expect(html).toContain('로그인')
    expect(html).toContain('이메일')
    expect(html).toContain('비밀번호')
    expect(html).toContain('White Paper')
  })

  it('shows the dev hint in development mode', () => {
    const html = renderLogin('/login')
    expect(html).toContain('admin@mx.local')
    expect(html).toContain('?dev 우회')
  })

  it('renders the form even when ?return contains an unsafe URL (no crash)', () => {
    const html = renderLogin('/login?return=https://evil.com/steal')
    // The page itself must still render. The unsafe path will be normalised
    // to "/" inside the navigate() call at submit time.
    expect(html).toContain('로그인')
  })
})
