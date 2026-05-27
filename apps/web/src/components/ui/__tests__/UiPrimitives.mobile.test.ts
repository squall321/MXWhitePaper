import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * UI primitive mobile-hardening regression guard.
 *
 * Mirrors the pattern of `AllBlocksResponsive.test.ts`, but for the shared
 * `components/ui/*` primitives. It looks at the source files directly and
 * asserts that any new size/font hardcode declared inside the primitive's
 * size class table comes paired with an `sm:` desktop reset — otherwise a
 * future change risks regressing:
 *
 *   - iOS Safari auto-zoom on focused inputs (font-size < 16px), or
 *   - WCAG 2.5.5 touch-target minimum on Button / IconButton (< 44×44 on
 *     mobile).
 *
 * The check is intentionally narrow: it only inspects the canonical class
 * tables (`FIELD_BASE` for inputs, `SIZE_CLS` for buttons) so unrelated
 * utility classes elsewhere in the file are not flagged.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const UI_DIR = join(HERE, '..')

function extractTable(src: string, name: string): string {
  // Capture `const <name> ... = { ... }` regardless of explicit type annotation.
  const re = new RegExp(`const\\s+${name}\\b[^=]*=\\s*\\{([\\s\\S]*?)\\}`, 'm')
  const m = src.match(re)
  return m && m[1] ? m[1] : ''
}

function extractConstString(src: string, name: string): string {
  // Capture `const <name> = '...'` or '... + ... + ...' concatenations.
  const re = new RegExp(`const\\s+${name}\\b[^=]*=([\\s\\S]*?);`, 'm')
  const m = src.match(re)
  return m && m[1] ? m[1] : ''
}

describe('UI primitive mobile hardening', () => {
  it('Input.tsx FIELD_BASE forces text-base on mobile (iOS auto-zoom guard)', () => {
    const src = readFileSync(join(UI_DIR, 'Input.tsx'), 'utf8')
    const fieldBase = extractConstString(src, 'FIELD_BASE')
    expect(fieldBase, 'FIELD_BASE not found').toBeTruthy()
    // Either `text-base sm:text-sm` or a future equivalent that explicitly
    // raises font-size at the mobile breakpoint.
    expect(fieldBase).toMatch(/\btext-base\b/)
    expect(fieldBase).toMatch(/\bsm:text-(sm|xs|base)\b/)
  })

  it('Button.tsx SIZE_CLS sm/md keep h-11 floor on mobile (WCAG touch-target)', () => {
    const src = readFileSync(join(UI_DIR, 'Button.tsx'), 'utf8')
    const sizeCls = extractTable(src, 'SIZE_CLS')
    expect(sizeCls, 'SIZE_CLS not found').toBeTruthy()
    // Each non-lg size must declare h-11 (mobile) and a sm: reset for desktop.
    const lines = sizeCls.split('\n').map((l) => l.trim()).filter(Boolean)
    const sm = lines.find((l) => l.startsWith('sm:'))
    const md = lines.find((l) => l.startsWith('md:'))
    expect(sm, `sm: row missing — got ${lines.join(' | ')}`).toBeTruthy()
    expect(md, `md: row missing — got ${lines.join(' | ')}`).toBeTruthy()
    for (const row of [sm!, md!]) {
      expect(row, row).toMatch(/\bh-11\b/)
      expect(row, row).toMatch(/\bsm:h-\d/)
    }
  })

  it('IconButton.tsx SIZE_CLS bumps every variant to 44×44 on mobile', () => {
    const src = readFileSync(join(UI_DIR, 'IconButton.tsx'), 'utf8')
    const sizeCls = extractTable(src, 'SIZE_CLS')
    expect(sizeCls, 'SIZE_CLS not found').toBeTruthy()
    const lines = sizeCls.split('\n').map((l) => l.trim()).filter(Boolean)
    const sm = lines.find((l) => l.startsWith('sm:'))
    const md = lines.find((l) => l.startsWith('md:'))
    const lg = lines.find((l) => l.startsWith('lg:'))
    for (const row of [sm, md, lg]) {
      expect(row, `row missing — got ${lines.join(' | ')}`).toBeTruthy()
      expect(row!, row!).toMatch(/\bh-11\b/)
      expect(row!, row!).toMatch(/\bw-11\b/)
    }
    // sm and md sizes must also declare a sm: reset; lg keeps a single h-11.
    expect(sm!, sm!).toMatch(/\bsm:h-\d/)
    expect(md!, md!).toMatch(/\bsm:h-\d/)
  })
})
