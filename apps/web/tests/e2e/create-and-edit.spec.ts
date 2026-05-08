import { test, expect } from '@playwright/test'
import { ensureLoggedIn, apiClient, deleteDoc, uniqSuffix } from './helpers'

test.describe('create + auto-save', () => {
  // Editor + autosave is exercised only on desktop. The flow uses TopBar
  // CTAs that morph on mobile and is not viewport-meaningful otherwise.
  test.beforeEach(({}, info) => {
    test.skip(info.project.name !== 'chromium-desktop', 'desktop project is enough')
  })

  test('TopBar new doc → fill form → editor mounts → autosave persists', async ({ page }) => {
    await ensureLoggedIn(page)
    const slug = `e2e-quickwrite-${uniqSuffix()}`
    const title = `e2e quickwrite ${slug}`

    // Pre-seed the OnboardingTour's "already seen" flag so the modal does
    // not pop up after fullEdit lands. The tour mounts via useEffect after
    // the page renders, which races our `isVisible()` probe — sometimes
    // the dialog appears AFTER we've moved on, then intercepts the
    // ProseMirror click. Seeding localStorage on the live origin makes
    // the test deterministic.
    await page.evaluate(() => {
      try {
        window.localStorage.setItem('mxwp.editorTour.v1', '1')
      } catch {
        /* noop */
      }
    })

    // Click "+ 새 문서" in the TopBar.
    await page.getByRole('link', { name: /^\+\s*새 문서$/ }).click()
    await page.waitForURL(/\/docs\/new$/, { timeout: 10_000 })

    // Fill the form.
    await page.getByLabel(/슬러그/).fill(slug)
    await page.getByLabel('제목').first().fill(title)

    // The "소속 파트" select defaults to first part on its own. Submit.
    await page.getByRole('button', { name: /생성하고 편집 시작/ }).click()

    // Land on /docs/<slug>?fullEdit=1.
    await page.waitForURL(new RegExp(`/docs/${slug}\\?fullEdit=1`), { timeout: 20_000 })

    // Belt-and-suspenders: if the tour STILL shows (storage cleared by
    // navigation, etc), dismiss it. Use a short positive wait, not a
    // boolean probe, so we don't race past a delayed-mount.
    const tour = page.getByRole('dialog', { name: '에디터 가이드' })
    await tour
      .waitFor({ state: 'visible', timeout: 1500 })
      .then(async () => {
        await page.getByRole('button', { name: '건너뛰기' }).click()
        await expect(tour).toBeHidden({ timeout: 5_000 })
      })
      .catch(() => undefined)

    // BlockNote editor surface mounts.
    const editor = page.locator('[data-blocknote-surface]').first()
    await expect(editor).toBeVisible({ timeout: 15_000 })

    // The ProseMirror contenteditable area inside BlockNote.
    const proseMirror = editor.locator('.ProseMirror').first()
    await expect(proseMirror).toBeVisible({ timeout: 10_000 })

    // Type some text. Click into the editor first so the caret lands.
    const sample = 'Hello from Playwright e2e ' + slug.slice(-6)
    await proseMirror.click()
    await page.keyboard.type(sample, { delay: 10 })

    // Wait for the auto-save pill to flip to "저장됨" (or sync state).
    const pill = page.getByTestId('save-status-pill')
    await expect(pill).toContainText(/저장됨|동기화됨/, { timeout: 25_000 })

    // Verify the data persisted by hitting the API directly. We avoid
    // page.reload() because the SPA's bootstrap()→/auth/refresh fails
    // cross-host in this dev setup (cookie set on 127.0.0.1 with
    // SameSite=Lax) — see cycle9-e2e.log for details.
    const client = await apiClient()
    try {
      const res = await client.ctx.get(`documents/${slug}`)
      expect(res.ok()).toBeTruthy()
      const body = await res.json()
      const blob = JSON.stringify(body.data?.content ?? body.data)
      expect(blob).toContain(sample)
    } finally {
      // Cleanup.
      await deleteDoc(client, slug)
      await client.dispose()
    }
  })
})
