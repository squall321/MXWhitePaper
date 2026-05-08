/**
 * URL paste behavior.
 *
 * Pure helpers used by the editor when intercepting paste events. The view
 * layer reads the user's selection and the clipboard string and decides:
 *   - selection present + URL → wrap as link
 *   - bare URL on internal `/docs/<slug>` → suggest a `[[slug]]` insertion
 *   - bare URL elsewhere → fall through to default paste (BlockNote handles)
 */

const URL_RE =
  /^https?:\/\/(?:[\w-]+\.)+[a-z]{2,}(?::\d{2,5})?(?:\/[^\s]*)?$/i

const INTERNAL_SLUG_RE = /^\/docs\/([a-z0-9가-힣][a-z0-9가-힣-]{0,99})(?:\/|$|#|\?)/

export interface UrlPasteDecision {
  /**
   * `wrap`     wrap the selected text as a link `[label](href)`.
   * `wikilink` insert a `[[slug]]` placeholder.
   * `link`     plain link insertion (no selection).
   * `none`     not a URL — caller should fall through.
   */
  kind: 'wrap' | 'wikilink' | 'link' | 'none'
  href?: string
  slug?: string
}

/** True if `text` is a single URL (no leading/trailing whitespace). */
export function isUrl(text: string): boolean {
  if (!text || /\s/.test(text.trim())) return false
  return URL_RE.test(text.trim())
}

/**
 * Inspect the absolute or relative URL and return the internal slug if it
 * follows the `/docs/<slug>` pattern. Same-origin protocol is required when
 * the pasted text is a full URL.
 */
export function extractInternalSlug(href: string, sameOrigin?: string): string | null {
  // Relative path.
  if (href.startsWith('/')) {
    const m = INTERNAL_SLUG_RE.exec(href)
    return m ? (m[1] ?? null) : null
  }
  if (!sameOrigin) {
    // We can't confirm internal-ness; reject conservatively.
    return null
  }
  try {
    const u = new URL(href)
    const o = new URL(sameOrigin)
    if (u.origin !== o.origin) return null
    const m = INTERNAL_SLUG_RE.exec(u.pathname + (u.hash ?? ''))
    return m ? (m[1] ?? null) : null
  } catch {
    return null
  }
}

export interface UrlPasteContext {
  /** Pasted text. Must be a single URL for a non-`none` decision. */
  text: string
  /** Currently-selected text in the editor (empty if none). */
  selection: string
  /** Same-origin reference (e.g. `window.location.origin`). Optional. */
  origin?: string
}

/** True if `text` looks like a relative `/docs/<slug>` path. */
function isRelativeDocPath(text: string): boolean {
  const t = text.trim()
  if (!t.startsWith('/docs/')) return false
  if (/\s/.test(t)) return false
  return INTERNAL_SLUG_RE.test(t)
}

/**
 * Decide what to do with a paste payload. Pure: callers translate the result
 * into actual editor commands.
 */
export function decideUrlPaste(ctx: UrlPasteContext): UrlPasteDecision {
  const isAbsolute = isUrl(ctx.text)
  const isRelativeDoc = !isAbsolute && isRelativeDocPath(ctx.text)
  if (!isAbsolute && !isRelativeDoc) return { kind: 'none' }
  const href = ctx.text.trim()

  // 1) Selection wrapping wins.
  if (ctx.selection.trim().length > 0) {
    return { kind: 'wrap', href }
  }

  // 2) Internal slug → wikilink offer.
  const slug = extractInternalSlug(href, ctx.origin)
  if (slug) {
    return { kind: 'wikilink', href, slug }
  }

  // 3) Bare external URL → plain link.
  return { kind: 'link', href }
}
