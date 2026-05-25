/**
 * Visual regression baseline — presentation mode (presentation-layout
 * cycle follow-up). One test logs in once and walks all four slides,
 * capturing each via toHaveScreenshot.
 *
 * Re-baseline locally:
 *   pnpm playwright test tests/e2e/visual-presentation.spec.ts --update-snapshots
 *
 * Baseline lives at __snapshots__/visual-presentation.spec.ts/ next to
 * this file. After the presentation-layout / slide-3 / iframe-placeholder
 * cycles, the sample doc reduces to 4 section slides (title + 3 chapters).
 *
 * Single test (not 4) — login once + keyboard nav is faster and avoids
 * the per-test login redirect race.
 *
 * maxDiffPixelRatio 0.02 mirrors visual-darkmode — soaks up mermaid
 * random id + font sub-pixel jitter.
 */
import { test, expect } from '@playwright/test'
import { loginAsAdmin } from './helpers'

const SAMPLE_SLUG = 'white-paper-realtime-edit-design'

test('visual: presentation 4 slides render consistently', async ({ page }) => {
  await loginAsAdmin(page)
  await page.goto(`/present/${encodeURIComponent(SAMPLE_SLUG)}`)
  await page.waitForSelector('.slide', { timeout: 15_000 })
  await page.waitForTimeout(2_000)

  await expect(page).toHaveScreenshot('slide-01-title.png', {
    fullPage: false,
    maxDiffPixelRatio: 0.02,
    animations: 'disabled',
  })

  await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(700)
  await expect(page).toHaveScreenshot('slide-02-sec1.png', {
    fullPage: false,
    maxDiffPixelRatio: 0.02,
    animations: 'disabled',
  })

  await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(700)
  await expect(page).toHaveScreenshot('slide-03-sec2-chunk1.png', {
    fullPage: false,
    maxDiffPixelRatio: 0.02,
    animations: 'disabled',
  })

  await page.keyboard.press('End')
  await page.waitForTimeout(700)
  await expect(page).toHaveScreenshot('slide-last-sec2-final.png', {
    fullPage: false,
    maxDiffPixelRatio: 0.02,
    animations: 'disabled',
  })
})
