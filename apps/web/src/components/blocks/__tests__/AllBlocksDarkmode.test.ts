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
})
