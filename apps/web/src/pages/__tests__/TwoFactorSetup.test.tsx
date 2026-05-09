import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

// The page only fetches when the user submits the password form, so the
// SSR pass we use here renders the initial password-confirmation step.
vi.mock('@/features/auth/totpApi', () => ({
  setupTotp: vi.fn(),
  verifyTotpSetup: vi.fn(),
  disableTotp: vi.fn(),
  regenerateBackupCodes: vi.fn(),
}))

import { TwoFactorSetupPage } from '../TwoFactorSetup'

function render(): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={['/me/2fa']}>
      <Routes>
        <Route path="/me/2fa" element={<TwoFactorSetupPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('<TwoFactorSetupPage />', () => {
  it('renders the password confirmation step on first load', () => {
    const html = render()
    expect(html).toContain('2단계 인증')
    expect(html).toContain('비밀번호 확인')
    expect(html).toContain('data-testid="totp-password"')
    expect(html).toContain('data-testid="totp-password-submit"')
  })

  it('does not reveal the QR / backup-code panel until setup runs', () => {
    const html = render()
    expect(html).not.toContain('이 코드들은 다시 보이지 않습니다')
    expect(html).not.toContain('data-testid="totp-qr"')
    expect(html).not.toContain('data-testid="totp-backup-codes"')
  })

  it('explains the 2FA flow in Korean copy', () => {
    const html = render()
    expect(html).toContain('Google Authenticator')
    expect(html).toContain('로그인 시 6자리 코드를')
  })
})
