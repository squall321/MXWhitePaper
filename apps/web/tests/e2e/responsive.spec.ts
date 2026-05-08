import { test, expect } from '@playwright/test'
import { ensureLoggedIn } from './helpers'

/**
 * Responsive layout smoke. Each test runs only on the matching Playwright
 * viewport project (mobile/tablet/desktop). We rely on AppShell's tailwind
 * responsive classes (md+ breakpoint = 768, lg+ = 1024).
 *
 * Note: we DON'T page.goto() after ensureLoggedIn — it submits the form
 * which leaves us on `/`. SPA-navigate via clicks where needed.
 */
test.describe('responsive layout', () => {
  test('mobile (375): hamburger visible, left tree hidden, search/+새문서 are icons', async ({ page }, info) => {
    test.skip(info.project.name !== 'chromium-mobile', 'mobile-only')
    await ensureLoggedIn(page)

    // Hamburger button (aria-label="메뉴 열기") is visible on mobile only.
    await expect(page.getByRole('button', { name: '메뉴 열기' })).toBeVisible()

    // Mobile search icon-button (aria-label="검색") should be visible.
    await expect(page.getByRole('button', { name: '검색' })).toBeVisible()

    // The mobile "+ 새 문서" button is rendered as an icon Link with
    // aria-label="새 문서 작성" (exact match so it doesn't collide with
    // the desktop "+ 새 문서 작성" CTA).
    await expect(
      page.getByRole('link', { name: '새 문서 작성', exact: true }),
    ).toBeVisible()

    // The desktop "+ 새 문서" text link should be hidden on mobile.
    const textLink = page.getByRole('link', { name: /^\+\s*새 문서$/ })
    await expect(textLink).toBeHidden()

    // Left aside (org tree heading inside <aside class="hidden md:block">)
    // should not be visible on mobile.
    const orgAsideHeading = page.locator('aside h2:has-text("조직")').first()
    await expect(orgAsideHeading).toBeHidden()
  })

  test('tablet (768): left tree visible, right rail hidden', async ({ page }, info) => {
    test.skip(info.project.name !== 'chromium-tablet', 'tablet-only')
    await ensureLoggedIn(page)
    // Click into a doc to ensure right-rail content exists.
    await page.getByRole('heading', { name: '월결산 프로세스' }).click()
    await page.waitForURL(/\/docs\/month-end-closing/, { timeout: 15_000 })
    await expect(page.getByRole('heading', { level: 1, name: '월결산 프로세스' })).toBeVisible()

    // Hamburger hidden md+.
    await expect(page.getByRole('button', { name: '메뉴 열기' })).toBeHidden()

    // Left tree aside is visible — the "조직" heading inside the desktop
    // aside renders.
    const aside = page.locator('aside').first()
    await expect(aside.getByText('조직').first()).toBeVisible()

    // Right rail TOC nav is hidden until lg+ breakpoint.
    const toc = page.getByRole('navigation', { name: '목차' }).first()
    await expect(toc).toBeHidden()
  })

  test('desktop (1440): all 3 columns visible', async ({ page }, info) => {
    test.skip(info.project.name !== 'chromium-desktop', 'desktop-only')
    await ensureLoggedIn(page)
    await page.getByRole('heading', { name: '월결산 프로세스' }).click()
    await page.waitForURL(/\/docs\/month-end-closing/, { timeout: 15_000 })
    await expect(page.getByRole('heading', { level: 1, name: '월결산 프로세스' })).toBeVisible()

    // Left aside visible.
    await expect(page.locator('aside').first().getByText('조직').first()).toBeVisible()
    // Main content visible.
    await expect(page.getByRole('main')).toBeVisible()
    // Right TOC nav visible.
    await expect(page.getByRole('navigation', { name: '목차' }).first()).toBeVisible()
    // Hamburger hidden.
    await expect(page.getByRole('button', { name: '메뉴 열기' })).toBeHidden()
  })
})
