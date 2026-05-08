import { test, expect } from '@playwright/test'
import { ensureLoggedIn } from './helpers'

test.describe('navigate + read', () => {
  test.beforeEach(({}, info) => {
    test.skip(info.project.name !== 'chromium-desktop', 'desktop project is enough')
  })

  test('home → 월결산 card → reader → TOC anchor 1.1.1', async ({ page }) => {
    // ensureLoggedIn submits the login form and lands on `/`. We do NOT
    // call page.goto('/') a second time — the dev server's VITE_API_URL
    // points at 127.0.0.1:8800 while the page is on localhost:5173, so a
    // hard reload triggers /auth/refresh which fails cross-site (cookie
    // set with SameSite=Lax for `127.0.0.1`). Documented in cycle9 log.
    await ensureLoggedIn(page)
    await expect(
      page.getByRole('heading', { level: 1, name: '최근 업데이트된 문서' }),
    ).toBeVisible()

    // Click the 월결산 프로세스 card (heading link).
    await page.getByRole('heading', { name: '월결산 프로세스' }).click()
    await page.waitForURL(/\/docs\/month-end-closing/, { timeout: 15_000 })

    // Reader H1.
    await expect(
      page.getByRole('heading', { level: 1, name: '월결산 프로세스' }),
    ).toBeVisible()

    // TOC nav (right rail) — at least 3 items.
    const toc = page.getByRole('navigation', { name: '목차' }).first()
    await expect(toc).toBeVisible()
    const tocItems = toc.locator('ul > li')
    await expect.poll(async () => tocItems.count(), { timeout: 10_000 }).toBeGreaterThanOrEqual(3)

    // Click section 1.1.1 anchor inside TOC.
    const anchor = toc.locator('a[href="#section-1.1.1"]').first()
    await expect(anchor).toBeVisible()
    await anchor.click()

    // Verify the URL hash and that the heading is in viewport. The id
    // contains dots (`section-1.1.1`) so we use an attribute selector
    // instead of CSS `#…` (which would treat the dots as class selectors).
    await expect.poll(() => page.evaluate(() => window.location.hash), {
      timeout: 5_000,
    }).toBe('#section-1.1.1')
    const heading = page.locator('[id="section-1.1.1"]')
    await expect(heading).toBeVisible()
  })
})
