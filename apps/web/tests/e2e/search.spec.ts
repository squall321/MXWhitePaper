import { test, expect } from '@playwright/test'
import { ensureLoggedIn } from './helpers'

test.describe('command palette', () => {
  test.beforeEach(({}, info) => {
    test.skip(info.project.name !== 'chromium-desktop', 'desktop project is enough')
  })

  test('Cmd/Ctrl+K opens palette, query "결산" returns the doc, click navigates', async ({ page }) => {
    await ensureLoggedIn(page)
    await expect(
      page.getByRole('heading', { level: 1, name: '최근 업데이트된 문서' }),
    ).toBeVisible()

    // Open the palette via the keyboard shortcut. Use Control on Linux/CI.
    await page.keyboard.press('Control+k')

    const dialog = page.getByRole('dialog', { name: '명령 팔레트' })
    await expect(dialog).toBeVisible({ timeout: 5_000 })

    const input = dialog.getByPlaceholder(/문서, 위젯, 명령어를 검색하세요/)
    await input.fill('결산')

    // First doc result. The rendered title is highlight-wrapped (the BE
    // returns `<mark>결산</mark>` and the FE sanitiser escapes it back to
    // a literal string) so we match by the slug `month-end-closing` which
    // also appears in the button's monospace `/slug` tail.
    const firstHit = dialog.locator('button').filter({ hasText: 'month-end-closing' }).first()
    await expect(firstHit).toBeVisible({ timeout: 15_000 })
    await firstHit.click()

    await page.waitForURL(/\/docs\/month-end-closing/, { timeout: 15_000 })
    await expect(
      page.getByRole('heading', { level: 1, name: '월결산 프로세스' }),
    ).toBeVisible()
  })
})
