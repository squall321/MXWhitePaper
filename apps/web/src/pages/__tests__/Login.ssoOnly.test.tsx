// SSO 전용 로그인 · 가입 화면 시험 — '포털로 들어가기' 하나 · `?local=1` 은 비상 관리자 폼 · 가입 링크 숨김 · 꺼지면 지금 그대로
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const authState = {
  current: {
    user: null as null | { id: string; email: string; role: string },
    hydrating: false,
    ssoOnly: true as boolean | null,
    launchUrl: '/launch/mx-white-paper' as string | null,
  },
}
vi.mock('@/features/auth/store', () => ({
  useAuthStore: Object.assign(
    (selector: (s: typeof authState.current) => unknown) => selector(authState.current),
    { getState: () => authState.current, setState: () => {} },
  ),
}))
vi.mock('@/features/auth/api', () => ({ login: vi.fn(), register: vi.fn() }))

import { LoginPage } from '../Login'
import { SignupPage } from '../Signup'

function render(initial: string): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('SSO 전용 로그인', () => {
  it('shows only the portal entry button', () => {
    authState.current = { ...authState.current, ssoOnly: true, launchUrl: '/launch/mx-white-paper' }
    const html = render('/login?return=%2Fwiki')
    expect(html).toContain('data-testid="portal-entry-button"')
    expect(html).toContain('포털로 들어가기')
    expect(html).not.toContain('data-testid="login-email"')
    expect(html).not.toContain('data-testid="login-signup"')
  })

  it('keeps the password form for emergency admins under ?local=1, without the signup link', () => {
    const html = render('/login?local=1')
    expect(html).toContain('data-testid="login-email"')
    expect(html).toContain('data-testid="login-forgot"')
    expect(html).not.toContain('data-testid="login-signup"')
  })

  it('says so when the portal link is not configured', () => {
    authState.current = { ...authState.current, launchUrl: null }
    expect(render('/login')).toContain('포털 진입 링크가 설정되지 않았습니다')
  })

  it('closes the signup page', () => {
    authState.current = { ...authState.current, ssoOnly: true, launchUrl: '/launch/mx-white-paper' }
    const html = render('/signup')
    expect(html).toContain('data-testid="portal-entry-button"')
    expect(html).not.toContain('type="password"')
  })

  it('is unchanged when SSO-only is off', () => {
    authState.current = { ...authState.current, ssoOnly: false }
    const html = render('/login')
    expect(html).toContain('data-testid="login-email"')
    expect(html).toContain('data-testid="login-signup"')
    expect(html).not.toContain('data-testid="portal-entry"')
  })
})
