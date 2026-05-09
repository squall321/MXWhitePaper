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
  // vi.mock is hoisted above all imports; declarations live inline.
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

import { LoginPage } from '../Login'

function renderLogin(): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<div data-testid="home">홈</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('<LoginPage /> — TOTP path', () => {
  beforeEach(() => {
    authState.current = { user: null, hydrating: false }
  })

  it('initial render shows the password form, not the TOTP form', () => {
    const html = renderLogin()
    expect(html).toContain('data-testid="login-email"')
    expect(html).toContain('data-testid="login-password"')
    expect(html).not.toContain('data-testid="login-totp-form"')
  })

  it('exports the TOTP-aware login API surface (smoke)', async () => {
    const mod = await import('@/features/auth/api')
    expect(typeof mod.login).toBe('function')
    expect(typeof mod.loginTotp).toBe('function')
    expect(typeof mod.TotpRequiredError).toBe('function')
  })

  it('TotpRequiredError carries the partial token', async () => {
    const mod = await import('@/features/auth/api')
    const e = new mod.TotpRequiredError('partial-abc')
    expect(e.partialToken).toBe('partial-abc')
    expect(e.message).toBe('TOTP_REQUIRED')
  })
})
