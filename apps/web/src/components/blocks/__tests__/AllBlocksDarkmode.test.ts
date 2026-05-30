import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Block darkmode regression guard.
 *
 * Walks every `*Block.tsx` (and EChartsView.tsx) under
 * `apps/web/src/components/blocks/`, finds light-only Tailwind class
 * combinations like `bg-white` or `border-gray-200`, and asserts that
 * either:
 *   - the same className string also contains a `dark:` variant, OR
 *   - the block is on a documented allow-list of intentional exceptions.
 *
 * The intent is to keep future block authors from regressing the
 * darkmode pass landed in block-darkmode-batch (2026-05-24).
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const BLOCKS_DIR = join(HERE, '..')

// Blocks that intentionally stay light-only (documented in lat/documents.md).
const ALLOW_LIGHT_ONLY: Record<string, string> = {
  // Code blocks are deliberately dark in both themes — they ARE the dark
  // surface, not on top of one.
  'CodeBlock.tsx': 'code blocks are always dark surfaces',
  // Whiteboard canvas stays white in both themes — user-drawn strokes are
  // calibrated against white (matches figma/excalidraw convention).
  'WhiteboardBlock.tsx': 'whiteboard canvas is intentionally white in both themes',
}

// className substrings that, when found in a Tailwind class string lacking
// any `dark:` variant, count as a violation. Keep this list short and
// high-signal (avoid false positives on smsg-* tokens or hover-only utilities).
const LIGHT_ONLY_NEEDLES = [
  'bg-white',
  'border-gray-200',
  'border-gray-300',
] as const

// Stronger text-color needles. These regress easily in new blocks
// (text-smsg-700/900 is the brand "ink" color and looks fine in light mode
// but vanishes against a dark gray-900 surface). The check runs only on
// files NOT in `LIGHT_TEXT_ALLOW_LEGACY` — that map enumerates pre-existing
// violations from before the regression guard was added so we can land the
// guard without a sweeping cross-block refactor. New blocks must declare a
// `dark:text-*` variant on the same className whenever they use these.
const LIGHT_TEXT_NEEDLES = [
  'text-smsg-500',
  'text-smsg-600',
  'text-smsg-700',
  'text-smsg-800',
  'text-smsg-900',
] as const

const LIGHT_TEXT_ALLOW_LEGACY: Record<string, string> = {
  'AccordionBlock.tsx': 'pre-existing — pending follow-up sweep',
  'BibliographyBlock.tsx': 'pre-existing — pending follow-up sweep',
  'CalculatorBlock.tsx': 'pre-existing — pending follow-up sweep',
  'CalloutBlock.tsx': 'pre-existing — pending follow-up sweep',
  'DocLinkCardBlock.tsx': 'pre-existing — pending follow-up sweep',
  'FormBlock.tsx': 'pre-existing — pending follow-up sweep',
  'Heading4Block.tsx': 'pre-existing — pending follow-up sweep',
  'KpiCardsBlock.tsx': 'pre-existing — pending follow-up sweep',
  'ListBlock.tsx': 'pre-existing — pending follow-up sweep',
  'ParagraphBlock.tsx': 'pre-existing — pending follow-up sweep',
  'PdfBlock.tsx': 'pre-existing — pending follow-up sweep (download button)',
  'PlaceholderBlock.tsx': 'pre-existing — pending follow-up sweep',
  'QuizBlock.tsx': 'pre-existing — pending follow-up sweep',
  'QuoteBlock.tsx': 'pre-existing — pending follow-up sweep',
  'TableBlock.tsx': 'pre-existing — pending follow-up sweep',
}

function extractClassNameStrings(src: string): string[] {
  // Match `className="..."` and `className={\`...\`}` literals only.
  // Template-string with embedded ${} expressions are still captured as a
  // single string; we just check the literal part.
  const out: string[] = []
  const re = /className=(?:"([^"]*)"|\{`([^`]*)`\}|\{'([^']*)'\})/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) {
    out.push(m[1] ?? m[2] ?? m[3] ?? '')
  }
  return out
}

describe('Block darkmode regression guard', () => {
  it('every block with a light-only Tailwind class also declares a dark: variant on the same className', () => {
    const files = readdirSync(BLOCKS_DIR)
      .filter((f) => f.endsWith('.tsx') && !f.startsWith('BlockRenderer'))
      .filter((f) => !ALLOW_LIGHT_ONLY[f])

    const violations: string[] = []

    for (const f of files) {
      const src = readFileSync(join(BLOCKS_DIR, f), 'utf8')
      const classNames = extractClassNameStrings(src)
      for (const cls of classNames) {
        const hasNeedle = LIGHT_ONLY_NEEDLES.some((n) => cls.includes(n))
        if (!hasNeedle) continue
        const hasDark = cls.includes('dark:')
        if (!hasDark) {
          // Truncate to keep failure message tractable.
          const preview = cls.length > 120 ? cls.slice(0, 120) + '…' : cls
          violations.push(`${f}: ${preview}`)
        }
      }
    }

    expect(violations, `Block files with light-only Tailwind classes (need dark: variant):\n${violations.join('\n')}`).toEqual([])
  })

  it('allow-list documents every intentional light-only exception', () => {
    for (const [file, reason] of Object.entries(ALLOW_LIGHT_ONLY)) {
      expect(reason).toBeTruthy()
      expect(file.endsWith('.tsx')).toBe(true)
    }
  })

  it('new blocks pairing text-smsg-{500..900} also declare a dark:text-* variant', () => {
    const files = readdirSync(BLOCKS_DIR)
      .filter((f) => f.endsWith('.tsx') && !f.startsWith('BlockRenderer'))
      .filter((f) => !ALLOW_LIGHT_ONLY[f])
      .filter((f) => !LIGHT_TEXT_ALLOW_LEGACY[f])

    const violations: string[] = []
    for (const f of files) {
      const src = readFileSync(join(BLOCKS_DIR, f), 'utf8')
      const classNames = extractClassNameStrings(src)
      for (const cls of classNames) {
        const hasNeedle = LIGHT_TEXT_NEEDLES.some((n) => cls.includes(n))
        if (!hasNeedle) continue
        if (!cls.includes('dark:')) {
          const preview = cls.length > 120 ? cls.slice(0, 120) + '…' : cls
          violations.push(`${f}: ${preview}`)
        }
      }
    }
    expect(
      violations,
      `New blocks must pair text-smsg-{500..900} with a dark:text-* variant on the same className:\n${violations.join('\n')}`,
    ).toEqual([])
  })
})
