/**
 * <Highlight /> — render text with `<mark>` tags for matched terms.
 *
 * Two modes:
 *   1. `html` prop  → string already contains `<mark>` (or `<em>`) markers,
 *                     coming from Meilisearch's `_formatted.<field>`. We
 *                     escape every other character then re-inject the
 *                     allowlisted tags. Render via `dangerouslySetInnerHTML`.
 *   2. `text` + `terms`  → wrap any case-insensitive match of `terms` with
 *                          `<mark>`. Use this when the BE didn't pre-format.
 *
 * No external sanitizer needed — only `<mark>` / `</mark>` survive escaping.
 */
import { useMemo } from 'react'

export interface HighlightProps {
  /** Pre-marked HTML (Meilisearch `_formatted.<field>`). */
  html?: string
  /** Plain text — auto-marked using `terms`. */
  text?: string
  /** Terms to wrap with `<mark>`. Case-insensitive. Ignored if `html` set. */
  terms?: string[]
  /** Optional CSS class for the wrapper span. */
  className?: string
  /** When neither `html` nor `text` produces anything, render this fallback. */
  fallback?: string
}

export function Highlight({ html, text, terms, className, fallback = '' }: HighlightProps) {
  const safeHtml = useMemo(() => {
    if (typeof html === 'string') return sanitizeMarkHtml(html)
    if (typeof text === 'string') return markText(text, terms ?? [])
    return ''
  }, [html, text, terms])

  if (!safeHtml) {
    return <span className={className}>{fallback}</span>
  }
  return (
    <span
      className={className}
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: safeHtml }}
    />
  )
}

/**
 * Escape all HTML, then unescape only the `<mark>` / `</mark>` (and legacy
 * `<em>` / `</em>` from older Meili responses) bookends.
 */
export function sanitizeMarkHtml(raw: string): string {
  if (!raw) return ''
  const escaped = raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
  return escaped
    .replace(/&lt;mark&gt;/g, '<mark class="bg-yellow-200 font-semibold rounded-sm px-0.5">')
    .replace(/&lt;\/mark&gt;/g, '</mark>')
    .replace(/&lt;em&gt;/g, '<mark class="bg-yellow-200 font-semibold rounded-sm px-0.5 not-italic">')
    .replace(/&lt;\/em&gt;/g, '</mark>')
}

/** Wrap each `terms` occurrence in `text` with a `<mark>` tag. */
export function markText(text: string, terms: string[]): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
  const cleaned = (terms || [])
    .map((t) => (t || '').trim())
    .filter((t) => t.length > 0)
  if (cleaned.length === 0) return escaped
  // Sort longest first so "release notes" beats "release" partial overlaps.
  cleaned.sort((a, b) => b.length - a.length)
  const pattern = new RegExp(
    '(' + cleaned.map(escapeRegExp).join('|') + ')',
    'gi',
  )
  return escaped.replace(
    pattern,
    '<mark class="bg-yellow-200 font-semibold rounded-sm px-0.5">$1</mark>',
  )
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
