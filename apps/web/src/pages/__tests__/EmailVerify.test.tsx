import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

// The page calls verifyEmailToken in useEffect; under SSR effects don't
// run, so the SSR pass renders the "pending" state. Mocking still keeps
// the import resolution happy and lets us assert that the page wires the
// API surface we shipped in features/auth/api.ts.
vi.mock('@/features/auth/api', () => ({
  verifyEmailToken: vi.fn(async () => ({ verified: true as const })),
  sendVerificationEmail: vi.fn(async () => ({ sent: true })),
}))

import { EmailVerifyPage } from '../EmailVerify'

function render(initial: string): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route path="/auth/verify" element={<EmailVerifyPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('<EmailVerifyPage />', () => {
  it('renders the pending state on the SSR pass', () => {
    const html = render('/auth/verify?token=tok-abc')
    expect(html).toContain('이메일 인증')
    expect(html).toContain('인증 중입니다')
  })

  it('uses role=status for the pending message (a11y)', () => {
    const html = render('/auth/verify?token=tok-xyz')
    expect(html).toContain('role="status"')
  })

  it('renders even when token query param is missing', () => {
    const html = render('/auth/verify')
    expect(html).toContain('이메일 인증')
  })
})
