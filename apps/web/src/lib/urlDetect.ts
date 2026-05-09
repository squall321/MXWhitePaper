/**
 * URL detection — used by the paste handler in SimpleStackEditor to decide
 * whether a clipboard payload is a single URL and, if so, whether it points
 * at one of our internal `/docs/<slug>` routes (so we can offer "📄 카드로
 * 변환?") or an external URL (so we can offer iframe / markdown insertion).
 *
 * Pure: no side effects, no DOM, no globals. Trim-tolerant.
 *
 * Cases covered (see __tests__/urlDetect.test.ts):
 *   - https://example.com                          → external
 *   - http://example.com/path?q=1                  → external
 *   - https://wiki.smsg.com/docs/foo               → internal, slug=foo
 *   - https://wiki.smsg.com/docs/foo#section-1.1   → internal + anchor
 *   - https://wiki.smsg.com/docs/foo?fullEdit=1    → internal (query stripped)
 *   - /docs/foo                                    → internal (relative)
 *   - /docs/한글                                   → internal Hangul slug
 *   - "  https://x.com  "                          → trimmed → external
 *   - empty / non-URL / multi-line                 → null
 */

export interface DetectedUrl {
  /** The canonical URL (trimmed; query/anchor preserved on the URL itself). */
  url: string
  /** True when the URL maps to a `/docs/<slug>` route on any host. */
  isInternal: boolean
  /** Internal-only: the bare slug from `/docs/<slug>`. */
  slug?: string
  /** Internal-only: the anchor (without leading `#`), e.g. `section-1.1`. */
  anchor?: string
}

// Loose URL match — accepts http/https schemes only. We deliberately do NOT
// accept javascript:, data:, file:, etc. — those should never round-trip
// through a paste-to-card flow.
const URL_RE = /^(https?:\/\/[^\s]+)$/i

// Internal `/docs/<slug>(#anchor)?` matcher. Slug grammar mirrors wiki-link.ts
// (Polish D — ASCII lowercase + digits + hyphen + Hangul). Anchor optional;
// query string is allowed but stripped.
const DOCS_PATH_RE =
  /^\/docs\/([a-z0-9가-힣][a-z0-9가-힣-]{0,99})(?:\?[^#]*)?(?:#([a-zA-Z0-9_.-]+))?$/

/**
 * Return URL info if `text` is exactly one URL (with optional surrounding
 * whitespace), otherwise `null`. Multiline text is rejected.
 */
export function extractUrl(text: string): DetectedUrl | null {
  if (typeof text !== 'string') return null
  const trimmed = text.trim()
  if (!trimmed) return null
  // Reject anything with internal whitespace — pasting a URL into a paragraph
  // with extra words should fall through to the default paste path.
  if (/\s/.test(trimmed)) return null

  // Relative path form (`/docs/foo`) — internal-only.
  if (trimmed.startsWith('/')) {
    const m = DOCS_PATH_RE.exec(trimmed)
    if (!m) return null
    const slug = m[1]
    const anchor = m[2]
    return {
      url: trimmed,
      isInternal: true,
      ...(slug ? { slug } : {}),
      ...(anchor ? { anchor } : {}),
    }
  }

  if (!URL_RE.test(trimmed)) return null

  // Use URL parser to extract pathname + hash. Bail on malformed URLs.
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return null
  }

  // Try the docs pattern against `pathname + search + hash` so the same regex
  // works for both absolute and relative cases. URL() percent-encodes
  // non-ASCII pathname segments (e.g. Hangul) — decode them before matching
  // so our Polish-D slug grammar still applies. `decodeURIComponent` can
  // throw on malformed sequences; fall back to the raw pathname.
  let pathname = parsed.pathname
  try {
    pathname = decodeURIComponent(parsed.pathname)
  } catch {
    /* leave as-is */
  }
  const tail = pathname + parsed.search + parsed.hash
  const m = DOCS_PATH_RE.exec(tail)
  if (m) {
    const slug = m[1]
    const anchor = m[2]
    return {
      url: trimmed,
      isInternal: true,
      ...(slug ? { slug } : {}),
      ...(anchor ? { anchor } : {}),
    }
  }

  return { url: trimmed, isInternal: false }
}
