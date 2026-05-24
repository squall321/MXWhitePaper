import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Block responsive regression guard.
 *
 * Walks every `*Block.tsx` (and EChartsView.tsx) under
 * `apps/web/src/components/blocks/` and asserts that every `grid-cols-N`
 * (N >= 2) class string also declares a `sm:` or `md:` responsive variant
 * — OR appears in the documented allow-list of intentional fixed grids.
 *
 * Catches mobile layout regressions introduced after the
 * `responsive-audit` cycle (2026-05-24). Mirror of
 * `AllBlocksDarkmode.test.ts` pattern.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const BLOCKS_DIR = join(HERE, '..')

// Blocks where a fixed grid-cols is intentional (documented in lat).
const ALLOW_FIXED_GRID: Record<string, string> = {
  // KpiCardsBlock uses 2/3/4 grid with sm:/md: variants throughout — its
  // single hardcoded grid-cols-2 is for tightest mobile (375) layout.
  // (no actual violations expected; placeholder for future exceptions)
}

function extractClassNameStrings(src: string): string[] {
  const out: string[] = []
  const re = /className=(?:"([^"]*)"|\{`([^`]*)`\}|\{'([^']*)'\})/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) {
    out.push(m[1] ?? m[2] ?? m[3] ?? '')
  }
  return out
}

describe('Block responsive regression guard', () => {
  it('every block with grid-cols-N (N>=2) declares a sm:/md:/lg: responsive variant', () => {
    const files = readdirSync(BLOCKS_DIR)
      .filter((f) => f.endsWith('.tsx') && !f.startsWith('BlockRenderer'))
      .filter((f) => !ALLOW_FIXED_GRID[f])

    const violations: string[] = []

    for (const f of files) {
      const src = readFileSync(join(BLOCKS_DIR, f), 'utf8')
      const classNames = extractClassNameStrings(src)
      for (const cls of classNames) {
        // Catch grid-cols-2 ~ grid-cols-9; ignore grid-cols-1 (single col
        // is mobile-safe by definition).
        const fixedGrid = cls.match(/(?:^|\s)grid-cols-[2-9]\b/)
        if (!fixedGrid) continue
        const hasResponsive =
          /\bsm:grid-cols-\d/.test(cls) ||
          /\bmd:grid-cols-\d/.test(cls) ||
          /\blg:grid-cols-\d/.test(cls)
        // Also OK if the class already starts narrow (grid-cols-1 followed
        // by a responsive grid-cols-N — pattern we want to encourage).
        const startsNarrow = /\bgrid-cols-1\b.*\b(sm|md|lg):grid-cols-/.test(cls)
        if (!hasResponsive && !startsNarrow) {
          const preview = cls.length > 120 ? cls.slice(0, 120) + '…' : cls
          violations.push(`${f}: ${preview}`)
        }
      }
    }

    expect(
      violations,
      `Block files with fixed grid-cols (need sm:/md: responsive variant):\n${violations.join('\n')}`,
    ).toEqual([])
  })

  it('allow-list documents every intentional fixed-grid exception', () => {
    for (const [file, reason] of Object.entries(ALLOW_FIXED_GRID)) {
      expect(reason).toBeTruthy()
      expect(file.endsWith('.tsx')).toBe(true)
    }
  })
})
