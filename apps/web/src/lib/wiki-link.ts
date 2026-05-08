/**
 * WikiLink parser.
 *
 * Grammar:
 *   [[slug]]
 *   [[slug|display]]
 *   [[slug#1.1.1]]
 *   [[slug#1.1.1|display]]
 *   [[#section-1.1]]                  (current-doc anchor, slug = '')
 *   [[#section-1.1|display]]
 *   [[other#section-2]]               (cross-doc anchor with explicit prefix)
 *   [[other#section-2|display]]
 *
 * Constraints:
 *   slug   = [a-z0-9가-힣][a-z0-9가-힣-]{0,99}   (Polish D — Hangul allowed)
 *   anchor = \d+(\.\d+){0,2}                   (legacy form: digits)
 *          | section-\d+(\.\d+){0,2}           (explicit `section-` prefix)
 *
 * The `slug` may be empty when the link starts with `#` — the renderer treats
 * such links as same-document anchors.
 *
 * Mismatched / malformed brackets fall through as plain text — never throw.
 */

export interface TextNode {
  kind: 'text'
  value: string
}

export interface WikiNode {
  kind: 'wiki'
  /** May be the empty string for same-document anchor links (`[[#section-1.1]]`). */
  slug: string
  /**
   * The raw anchor string. Either `1.1` (legacy) or `section-1.1` (explicit).
   * Renderers MUST handle both — `WikiLink` prepends `section-` only when the
   * anchor doesn't already start with that prefix.
   */
  anchor?: string
  display?: string
}

export type InlineNode = TextNode | WikiNode

// Polish D — ASCII lowercase + digits + hyphen + Hangul 음절 (가-힣) 모두 허용.
const SLUG_RE = /^[a-z0-9가-힣][a-z0-9가-힣-]{0,99}$/
// Either a bare numeric anchor (`1.1.1`) or one prefixed with `section-`.
const ANCHOR_RE = /^(?:section-)?\d+(?:\.\d+){0,2}$/

// Captures the inside of `[[...]]`. Greedy match is fine because we explicitly
// reject if the inner blob contains `[[` or `]]`.
const WIKI_RE = /\[\[([^\[\]]+?)\]\]/g

/**
 * Split inline text into text + wiki tokens. Pure; no side effects.
 */
export function parseInline(text: string): InlineNode[] {
  if (!text) return [{ kind: 'text', value: '' }]

  const out: InlineNode[] = []
  let lastIndex = 0
  // Reset regex state so the function is safe to call repeatedly.
  WIKI_RE.lastIndex = 0

  let m: RegExpExecArray | null
  while ((m = WIKI_RE.exec(text)) !== null) {
    const inner = m[1]
    const node = parseWikiInner(inner ?? '')
    if (!node) {
      // Malformed → leave the literal `[[…]]` in place by skipping past the
      // opening `[[` only. This way an inner `[[bad]] [[good]]` still parses
      // the second link.
      continue
    }
    if (m.index > lastIndex) {
      out.push({ kind: 'text', value: text.slice(lastIndex, m.index) })
    }
    out.push(node)
    lastIndex = m.index + m[0].length
  }

  if (lastIndex < text.length) {
    out.push({ kind: 'text', value: text.slice(lastIndex) })
  }

  if (out.length === 0) {
    return [{ kind: 'text', value: text }]
  }
  return out
}

function parseWikiInner(inner: string): WikiNode | null {
  // Split on the FIRST `|` only (display can contain anything but `]]`/`[[`).
  const pipeAt = inner.indexOf('|')
  const targetRaw = (pipeAt === -1 ? inner : inner.slice(0, pipeAt)).trim()
  const display =
    pipeAt === -1 ? undefined : inner.slice(pipeAt + 1).trim() || undefined

  if (!targetRaw) return null

  const hashAt = targetRaw.indexOf('#')
  const slug = (hashAt === -1 ? targetRaw : targetRaw.slice(0, hashAt)).trim()
  const anchorRaw =
    hashAt === -1 ? undefined : targetRaw.slice(hashAt + 1).trim() || undefined

  // Same-doc anchors: `[[#section-1.1]]` → empty slug + anchor must be present.
  // Anything else MUST satisfy SLUG_RE.
  if (slug === '') {
    if (!anchorRaw) return null
  } else if (!SLUG_RE.test(slug)) {
    return null
  }
  if (anchorRaw !== undefined && !ANCHOR_RE.test(anchorRaw)) return null

  return {
    kind: 'wiki',
    slug,
    ...(anchorRaw ? { anchor: anchorRaw } : {}),
    ...(display ? { display } : {}),
  }
}
