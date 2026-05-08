import { test, expect } from '@playwright/test'
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './helpers'

test.describe('login flow', () => {
  // The login flow is layout-independent; running on every viewport just
  // multiplies cost with no additional coverage.
  test.beforeEach(({}, info) => {
    test.skip(info.project.name !== 'chromium-desktop', 'desktop project is enough')
  })

  test('redirects unauthenticated visitor to /login, then home shows recent docs', async ({ page }) => {
    // 1. Visit / → AuthGuard pushes us to /login (with `return=/`).
    await page.goto('/')
    await expect(page).toHaveURL(/\/login(\?|$)/)

    // 2. Fill credentials. Labels are stable Korean strings.
    await page.getByLabel('이메일').fill(ADMIN_EMAIL)
    await page.getByLabel('비밀번호').fill(ADMIN_PASSWORD)

    await page.getByRole('button', { name: '로그인' }).click()

    // 3. Land on /. The home page H1 is "최근 업데이트된 문서".
    await page.waitForURL((url) => url.pathname === '/', { timeout: 15_000 })
    await expect(
      page.getByRole('heading', { level: 1, name: '최근 업데이트된 문서' }),
    ).toBeVisible()

    // 4. Five seed cards (the home grid uses <ul><li><Card>…). Each card has a
    //    document <h2>. Wait for at least 5 to render.
    const cards = page.locator('ul > li').filter({ has: page.locator('h2') })
    await expect.poll(async () => cards.count(), { timeout: 10_000 }).toBeGreaterThanOrEqual(5)
  })
})
