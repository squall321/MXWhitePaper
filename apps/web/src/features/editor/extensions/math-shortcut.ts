/**
 * Math `$…$` (inline) and `$$…$$` (block) shortcut.
 *
 * Pure decision helper. The runtime callers in the editor surface listen for
 * an `Enter` keystroke or paste, then call `detectMath` on the line to decide
 * whether to convert it.
 */

export interface InlineMathToken {
  /** 0-based index inside the source text. */
  start: number
  end: number
  /** Trimmed expression between the `$`s. */
  expression: string
}

const BLOCK_RE = /^\s*\$\$\s*([\s\S]+?)\s*\$\$\s*$/
const INLINE_RE = /\$([^$\n]+?)\$/g

/** True when the entire string is a `$$ … $$` math block. */
export function isMathBlock(text: string): { yes: true; expression: string } | { yes: false } {
  const m = BLOCK_RE.exec(text)
  if (!m) return { yes: false }
  const expr = (m[1] ?? '').trim()
  if (!expr) return { yes: false }
  return { yes: true, expression: expr }
}

/**
 * Scan a line for inline `$…$` math fragments. Returns each token's start /
 * end / expression, in source order. Pairs only — an unterminated `$` is
 * left as plain text by returning no token for it.
 */
export function detectInlineMath(text: string): InlineMathToken[] {
  if (!text || text.indexOf('$') === -1) return []
  const out: InlineMathToken[] = []
  INLINE_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = INLINE_RE.exec(text)) !== null) {
    const expr = (m[1] ?? '').trim()
    if (!expr) continue
    out.push({ start: m.index, end: m.index + m[0].length, expression: expr })
  }
  return out
}
