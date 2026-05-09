import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

vi.mock('@/features/auth/api', () => ({
  resetPassword: vi.fn(async () => ({ reset: true as const })),
}))

import { ResetPasswordPage } from '../ResetPassword'

function render(initial: string): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route path="/auth/reset" element={<ResetPasswordPage />} />
        <Route path="/login" element={<div>로그인 페이지</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('<ResetPasswordPage />', () => {
  it('renders both password fields and the submit button', () => {
    const html = render('/auth/reset?token=tok-abc')
    expect(html).toContain('새 비밀번호 설정')
    expect(html).toContain('data-testid="reset-password"')
    expect(html).toContain('data-testid="reset-confirm"')
    expect(html).toContain('data-testid="reset-submit"')
  })

  it('renders even when token is missing (component must not crash)', () => {
    const html = render('/auth/reset')
    expect(html).toContain('새 비밀번호 설정')
  })

  it('includes a back-to-login link', () => {
    const html = render('/auth/reset?token=tok-xyz')
    expect(html).toContain('로그인으로 돌아가기')
  })
})
