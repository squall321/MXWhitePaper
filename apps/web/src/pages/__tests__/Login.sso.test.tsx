import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

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
    { getState: () => authState.current, setState: () => {} },
  ),
}))

vi.mock('@/features/auth/api', () => {
  class FakeTotpRequiredError extends Error {
    partialToken: string
    constructor(partialToken: string) {
      super('TOTP_REQUIRED')
      this.partialToken = partialToken
    }
  }
  return {
    login: vi.fn(),
    loginTotp: vi.fn(),
    TotpRequiredError: FakeTotpRequiredError,
  }
})

const discoverMock = vi.fn()
vi.mock('@/features/sso/api', () => ({
  discoverSsoProvider: (email: string) => discoverMock(email),
}))

import { LoginPage, shouldProbeSso, ssoButtonLabel } from '../Login'

function renderLogin(): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('shouldProbeSso()', () => {
  it('returns false for empty / whitespace / non-email values', () => {
    expect(shouldProbeSso(null)).toBe(false)
    expect(shouldProbeSso(undefined)).toBe(false)
    expect(shouldProbeSso('')).toBe(false)
    expect(shouldProbeSso('   ')).toBe(false)
    expect(shouldProbeSso('not-an-email')).toBe(false)
  })

  it('returns true for plausible email-shaped values', () => {
    expect(shouldProbeSso('alice@samsung.com')).toBe(true)
    expect(shouldProbeSso('  bob@msft.example  ')).toBe(true)
  })
})

describe('ssoButtonLabel()', () => {
  it('renders the provider name with a key emoji and Korean copy', () => {
    expect(ssoButtonLabel('Samsung SSO')).toBe('🔑 Samsung SSO으로 로그인')
    expect(ssoButtonLabel('Microsoft Entra')).toBe('🔑 Microsoft Entra으로 로그인')
  })
})

describe('<LoginPage /> — SSO discover wiring', () => {
  beforeEach(() => {
    authState.current = { user: null, hydrating: false }
    discoverMock.mockReset()
  })

  it('initial render shows the password form, not an SSO button', () => {
    const html = renderLogin()
    // Email + password fields are present.
    expect(html).toContain('data-testid="login-email"')
    expect(html).toContain('data-testid="login-password"')
    // SSO button has not appeared yet (no discover call has resolved).
    expect(html).not.toContain('data-testid="login-sso-button"')
    // Default submit button is still visible.
    expect(html).toContain('data-testid="login-submit"')
  })

  it('exports the SSO API surface (smoke)', async () => {
    const mod = await import('@/features/sso/api')
    expect(typeof mod.discoverSsoProvider).toBe('function')
  })

  it('does not call discoverSsoProvider during initial SSR pass', () => {
    renderLogin()
    expect(discoverMock).not.toHaveBeenCalled()
  })
})
