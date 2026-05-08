import { test, expect } from '@playwright/test'
import { ensureLoggedIn } from './helpers'

test.describe('debug search', () => {
  test.beforeEach(({}, info) => {
    test.skip(info.project.name !== 'chromium-desktop', 'desktop project is enough')
  })

  test('debug palette + search hits', async ({ page }) => {
    page.on('console', (msg) => console.log('[console]', msg.type(), msg.text()))
    page.on('pageerror', (err) => console.log('[pageerror]', err.message, err.stack?.slice(0, 800)))
    page.on('request', (req) => {
      const u = req.url()
      if (u.includes('/api/v1/')) {
        console.log('[req]', req.method(), u)
      }
    })
    page.on('response', async (res) => {
      const u = res.url()
      if (u.includes('/api/v1/')) {
        console.log('[res]', res.status(), u.split('?')[0])
      }
    })
    page.on('framenavigated', (frame) => {
      console.log('[nav]', frame.url())
    })

    await ensureLoggedIn(page)
    console.log('-- after login, URL:', page.url())
    await expect(
      page.getByRole('heading', { level: 1, name: '최근 업데이트된 문서' }),
    ).toBeVisible()

    console.log('-- pressing Ctrl+K')
    await page.keyboard.press('Control+k')
    const dialog = page.getByRole('dialog', { name: '명령 팔레트' })
    await expect(dialog).toBeVisible({ timeout: 5_000 })
    console.log('-- palette open')
    const input = dialog.getByPlaceholder(/문서, 위젯, 명령어를 검색하세요/)
    await input.fill('결산')
    console.log('-- typed query')
    await page.waitForTimeout(2000)
    console.log('-- after wait, URL:', page.url())
    const visible = await dialog.isVisible().catch(() => false)
    console.log('-- dialog visible after fill:', visible)
    if (visible) {
      const html = await dialog.innerHTML()
      console.log('[dialog]', html.slice(0, 1500))
    }
  })
})
