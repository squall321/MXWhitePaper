import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

interface PageSpec {
  name: string
  path: string
  /** When set, used as a stability anchor before axe runs. */
  readyHeading?: { level?: 1 | 2 | 3; name: string | RegExp }
}

/**
 * For a11y we use `?dev` to bypass AuthGuard. The dev bypass renders the
 * page tree without populating the auth store, which is OK for a11y
 * scanning — we only care about static HTML/ARIA, not behaviours that
 * depend on `user.role`. This sidesteps the cross-host cookie+SameSite
 * issue (see cycle9-e2e.log) entirely.
 */
const PAGES: PageSpec[] = [
  { name: 'login', path: '/login', readyHeading: { level: 2, name: '로그인' } },
  { name: 'home', path: '/?dev', readyHeading: { level: 1, name: '최근 업데이트된 문서' } },
  { name: 'reader-month-end-closing', path: '/docs/month-end-closing?dev', readyHeading: { level: 1, name: '월결산 프로세스' } },
  { name: 'docs-new', path: '/docs/new?dev', readyHeading: { level: 1, name: '새 문서 작성' } },
  { name: 'orgs', path: '/orgs?dev' },
]

const VIEWPORTS = [
  { label: 'desktop', width: 1440, height: 900 },
  { label: 'mobile', width: 375, height: 667 },
] as const

interface ViolationRecord {
  page: string
  viewport: string
  impact: string
  id: string
  nodes: number
}

const REPORT_DIR = path.resolve(__dirname, '../../../../infra/logs/e2e-report')
const A11Y_LOG = path.join(REPORT_DIR, 'a11y-violations.jsonl')

function appendReport(rec: ViolationRecord) {
  try {
    fs.mkdirSync(REPORT_DIR, { recursive: true })
    fs.appendFileSync(A11Y_LOG, JSON.stringify(rec) + '\n')
  } catch {
    /* best-effort */
  }
}

async function gotoAndSettle(page: Page, spec: PageSpec) {
  await page.goto(spec.path, { waitUntil: 'domcontentloaded' })
  if (spec.readyHeading) {
    await expect(
      page.getByRole('heading', spec.readyHeading.level
        ? { level: spec.readyHeading.level, name: spec.readyHeading.name }
        : { name: spec.readyHeading.name },
      ),
    ).toBeVisible({ timeout: 15_000 })
  }
  await page.waitForLoadState('networkidle').catch(() => undefined)
  // Give async UI (BlockNote, charts, etc) a beat to settle.
  await page.waitForTimeout(400)
}

test.beforeAll(() => {
  try {
    fs.mkdirSync(REPORT_DIR, { recursive: true })
    fs.writeFileSync(A11Y_LOG, '')
  } catch {
    /* ignore */
  }
})

test.describe('a11y (axe-core)', () => {
  test.beforeEach(({}, info) => {
    test.skip(
      info.project.name !== 'chromium-desktop',
      'a11y runs once on the desktop project; mobile axe is driven by setViewportSize per test',
    )
  })

  for (const spec of PAGES) {
    for (const vp of VIEWPORTS) {
      test(`${spec.name} @ ${vp.label}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height })
        await gotoAndSettle(page, spec)

        const results = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze()

        const critical = results.violations.filter((v) => v.impact === 'critical')
        const serious = results.violations.filter((v) => v.impact === 'serious')
        const moderate = results.violations.filter((v) => v.impact === 'moderate')
        const minor = results.violations.filter((v) => v.impact === 'minor')

        for (const v of results.violations) {
          appendReport({
            page: spec.name,
            viewport: vp.label,
            impact: v.impact ?? 'unknown',
            id: v.id,
            nodes: v.nodes.length,
          })
        }

        if (moderate.length > 0 || minor.length > 0) {
          // eslint-disable-next-line no-console
          console.warn(
            `[a11y] ${spec.name} @ ${vp.label}: moderate=${moderate.length} minor=${minor.length}`,
            moderate.concat(minor).map((v) => `${v.impact}:${v.id}`).join(', '),
          )
        }

        const blocking = [...critical, ...serious].map((v) => ({
          id: v.id,
          impact: v.impact,
          help: v.help,
          nodes: v.nodes.slice(0, 3).map((n) => n.target),
        }))
        expect(
          blocking,
          `critical/serious a11y violations on ${spec.name}@${vp.label}`,
        ).toEqual([])
      })
    }
  }
})
