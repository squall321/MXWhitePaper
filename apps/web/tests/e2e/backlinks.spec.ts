import { test, expect } from '@playwright/test'
import { ensureLoggedIn, apiClient, createDoc, deleteDoc, uniqSuffix } from './helpers'

test.describe('backlinks', () => {
  test.beforeEach(({}, info) => {
    test.skip(info.project.name !== 'chromium-desktop', 'desktop project is enough')
  })

  test('a doc that links [[month-end-closing]] appears in the target\'s 백링크 panel', async ({ page }) => {
    // Create the linking doc via the API BEFORE we navigate (so the
    // backlinks panel sees it on first render).
    const client = await apiClient()
    const slug = `e2e-backlink-${uniqSuffix()}`
    const title = 'e2e backlink fixture'
    await createDoc(client, {
      slug,
      title,
      summary: 'tmp doc with wikilink',
      bodyText: '월결산 참조: [[month-end-closing]]',
    })

    try {
      await ensureLoggedIn(page)
      // SPA-navigate to the target doc by clicking its card.
      await page.getByRole('heading', { name: '월결산 프로세스' }).click()
      await page.waitForURL(/\/docs\/month-end-closing/, { timeout: 15_000 })
      await expect(
        page.getByRole('heading', { level: 1, name: '월결산 프로세스' }),
      ).toBeVisible({ timeout: 15_000 })

      const panel = page.locator('section[aria-label="백링크"]').first()
      await expect(panel).toBeVisible({ timeout: 10_000 })
      // The panel renders even with zero backlinks — wait until our slug shows.
      await expect.poll(
        async () => panel.locator(`a[href*="/docs/${slug}"], a:has-text("${title}")`).count(),
        { timeout: 25_000 },
      ).toBeGreaterThanOrEqual(1)
    } finally {
      await deleteDoc(client, slug)
      await client.dispose()
    }
  })
})
