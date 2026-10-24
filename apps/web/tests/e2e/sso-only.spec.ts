// SSO 전용 e2e — 세션이 없으면 포털 진입 링크로 저절로 · 착지 뒤 남긴 자리로 되돌아오기 · 1분 안 되풀이는 로그인 화면(단추)으로
/**
 * 사용자 결정 10-25(docs/llm-wiki checklist 'SSO 전용'). 서버의 `/auth/mode` · `/auth/refresh` 와 포털의 진입 링크를 고정 응답으로
 * 바꿔 화면의 길만 본다 — dev API 의 설정과 상관없이 돈다.
 */
import { expect, test, type Page } from '@playwright/test'

const LAUNCH = '/launch/mx-white-paper'
const USER = { id: 'u-sso-1', email: 'sso-e2e@example.com', name: 'SSO 시험', role: 'editor' }

async function ssoOnly(page: Page, opts: { session: boolean }): Promise<void> {
  await page.route('**/api/v1/auth/mode', (r) => r.fulfill({ json: { data: { sso_only: true, launch_url: LAUNCH }, meta: null, error: null } }))
  await page.route('**/api/v1/auth/refresh', (r) => opts.session
    ? r.fulfill({ json: { data: { access_token: 'e2e.sso.token', token_type: 'Bearer', expires_in: 3600, user: USER }, meta: null, error: null } })
    : r.fulfill({ status: 401, json: { data: null, meta: null, error: { code: 'PORTAL_REENTRY', message: '포털로 다시 들어오라', details: { launch_url: LAUNCH } } } }))
  await page.route('**/api/v1/me', (r) => r.fulfill({ json: { data: USER, meta: null, error: null } }))
  await page.route(`**${LAUNCH}`, (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>포털 진입</title><p>portal stub</p>' }))
}

test.describe('SSO 전용 — 포털로만 들어오기', () => {
  test('goes to the portal launch link by itself and comes back to where it was', async ({ page }) => {
    await ssoOnly(page, { session: false })
    await page.goto('/recent?tab=2')
    await page.waitForURL((u) => u.pathname === LAUNCH)
    expect(await page.evaluate(() => sessionStorage.getItem('mxwp.return_to'))).toBe('/recent?tab=2')

    // 포털이 진입 토큰으로 세션을 열고 앱 첫 화면으로 착지시킨 것처럼
    await page.unrouteAll({ behavior: 'ignoreErrors' })
    await ssoOnly(page, { session: true })
    await page.goto('/')
    await page.waitForURL((u) => u.pathname === '/recent' && u.search === '?tab=2')
    expect(await page.evaluate(() => sessionStorage.getItem('mxwp.return_to'))).toBeNull()
  })

  test('does not loop — a second miss within a minute shows the login page with the button', async ({ page }) => {
    await page.addInitScript(() => sessionStorage.setItem('mxwp.portal_entry_at', String(Date.now())))
    await ssoOnly(page, { session: false })
    await page.goto('/recent')
    await page.waitForURL((u) => u.pathname === '/login')
    await expect(page.getByTestId('portal-entry-button')).toBeVisible()
    await expect(page.getByText('방금 포털로 다녀왔는데 이어지지 않았습니다')).toBeVisible()
    await expect(page.getByTestId('login-email')).toHaveCount(0)
    await page.getByTestId('portal-entry-button').click() // 사람이 누르면 막기와 상관없이
    await page.waitForURL((u) => u.pathname === LAUNCH)
  })

  test('keeps the emergency admin form under ?local=1 and closes signup', async ({ page }) => {
    await ssoOnly(page, { session: false })
    await page.goto('/login?local=1')
    await expect(page.getByTestId('login-email')).toBeVisible()
    await expect(page.getByTestId('login-signup')).toHaveCount(0)
    await page.goto('/signup')
    await expect(page.getByTestId('portal-entry-button')).toBeVisible()
  })
})
