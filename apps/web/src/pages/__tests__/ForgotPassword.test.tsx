import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

vi.mock('@/features/auth/api', () => ({
  forgotPassword: vi.fn(async () => ({ sent: true as const })),
}))

import { ForgotPasswordPage } from '../ForgotPassword'

function render(): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={['/auth/forgot']}>
      <Routes>
        <Route path="/auth/forgot" element={<ForgotPasswordPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('<ForgotPasswordPage />', () => {
  it('renders the form with Korean labels and email input', () => {
    const html = render()
    expect(html).toContain('비밀번호 재설정')
    expect(html).toContain('이메일')
    expect(html).toContain('data-testid="forgot-email"')
    expect(html).toContain('data-testid="forgot-submit"')
  })

  it('includes a back-to-login link', () => {
    const html = render()
    expect(html).toContain('/login')
    expect(html).toContain('로그인으로 돌아가기')
  })

  it('does not leak whether emails exist (no error/exists messaging in markup)', () => {
    const html = render()
    expect(html).not.toContain('존재하지 않는')
    expect(html).not.toContain('해당 이메일')
  })
})
