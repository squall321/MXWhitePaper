import { useEffect, useMemo, useRef, useState } from 'react'
import { searchDocuments, type DocSearchHit } from '@/features/search/api'
import { cn } from '@/components/ui/cn'

/**
 * WikiLinkAutocomplete — popup that appears next to the caret when the user
 * types `[[` inside an `InlineTextBlockEditor`. As the user keeps typing,
 * the popup queries `/search` (debounced 300 ms) and shows up to 10 matching
 * documents. ↑↓ navigate, Enter inserts `[[slug|query]]`, Esc closes.
 *
 * Pure presentational: the parent owns the trigger detection and the actual
 * DOM replacement on commit. We just render the list and forward keyboard
 * events to a callback so the parent can keep its caret semantics straight.
 *
 * The popup self-positions: parent passes the caret rect; we render it
 * directly under that rect with a small offset so the user sees their query
 * + the matches without occluding the line they're typing on.
 */

export interface WikiLinkHit {
  slug: string
  title: string
}

interface Props {
  /** Caret rect in viewport coords (output of `Range.getBoundingClientRect`). */
  anchor: { left: number; bottom: number }
  /** Current query after the trigger `[[`. May be empty (popup just opened). */
  query: string
  /** Slug to exclude from results (the document being edited). */
  excludeSlug?: string
  /**
   * User picked a hit (Enter / click / Tab). Parent must replace the
   * `[[query` typed in the editor with `[[slug|query]]` (or `[[slug]]` if
   * `query` is empty / equals slug) and place the caret after the closing
   * brackets.
   */
  onPick: (hit: WikiLinkHit) => void
  /** User dismissed the popup (Esc / outside event). */
  onClose: () => void
  /**
   * Keyboard handler ref — the parent's contentEditable owns the actual
   * focus, so it needs to forward `ArrowUp/Down/Enter/Tab/Escape` here.
   * Returns true when the popup consumed the key so the parent suppresses
   * its own handling.
   */
  onKeyDownRef: React.MutableRefObject<((e: KeyboardEvent) => boolean) | null>
}

const DEBOUNCE_MS = 300
const MAX_RESULTS = 10

export function WikiLinkAutocomplete({
  anchor,
  query,
  excludeSlug,
  onPick,
  onClose,
  onKeyDownRef,
}: Props) {
  const [hits, setHits] = useState<WikiLinkHit[]>([])
  const [loading, setLoading] = useState(false)
  const [activeIdx, setActiveIdx] = useState(0)

  // Cancel in-flight fetches when the query changes.
  const reqIdRef = useRef(0)

  // Debounced fetch. Empty query still fires a search — the BE returns the
  // most-recent docs when q is blank, which is useful as a "browse" mode.
  useEffect(() => {
    const id = ++reqIdRef.current
    const timer = window.setTimeout(async () => {
      setLoading(true)
      try {
        const trimmed = query.trim()
        const raw = trimmed ? await searchDocuments(trimmed, MAX_RESULTS) : []
        if (reqIdRef.current !== id) return
        const filtered: WikiLinkHit[] = raw
          .filter((h: DocSearchHit) => h.slug !== excludeSlug)
          .slice(0, MAX_RESULTS)
          .map((h) => ({ slug: h.slug, title: h.title }))
        setHits(filtered)
        setActiveIdx(0)
      } catch {
        if (reqIdRef.current !== id) return
        setHits([])
      } finally {
        if (reqIdRef.current === id) setLoading(false)
      }
    }, DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [query, excludeSlug])

  // Wire keyboard handler into the ref so the parent contentEditable can
  // forward keys. We attach a fresh function each render so it captures the
  // latest `hits` / `activeIdx`.
  useEffect(() => {
    onKeyDownRef.current = (e: KeyboardEvent): boolean => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return true
      }
      if (e.key === 'ArrowDown') {
        if (hits.length === 0) return false
        e.preventDefault()
        setActiveIdx((i) => (i + 1) % hits.length)
        return true
      }
      if (e.key === 'ArrowUp') {
        if (hits.length === 0) return false
        e.preventDefault()
        setActiveIdx((i) => (i - 1 + hits.length) % hits.length)
        return true
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        const hit = hits[activeIdx]
        if (!hit) {
          // No results yet — just close so Enter does its default (newline).
          if (e.key === 'Tab') {
            e.preventDefault()
            onClose()
            return true
          }
          return false
        }
        e.preventDefault()
        onPick(hit)
        return true
      }
      return false
    }
    return () => {
      onKeyDownRef.current = null
    }
  }, [hits, activeIdx, onClose, onPick, onKeyDownRef])

  // Clamp activeIdx when hits shrink.
  useEffect(() => {
    setActiveIdx((idx) => {
      if (hits.length === 0) return 0
      return Math.min(idx, hits.length - 1)
    })
  }, [hits.length])

  const style = useMemo<React.CSSProperties>(
    () => ({
      position: 'fixed',
      left: Math.max(8, anchor.left),
      top: anchor.bottom + 4,
      zIndex: 60,
    }),
    [anchor.left, anchor.bottom],
  )

  return (
    <div
      role="listbox"
      aria-label="위키 링크 자동완성"
      data-testid="wiki-link-autocomplete"
      style={style}
      className="w-72 overflow-hidden rounded-md border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-900"
      onMouseDown={(e) => {
        // Prevent the contentEditable from losing focus (which would close us).
        e.preventDefault()
      }}
    >
      <div className="border-b border-gray-100 px-2 py-1.5 text-[10px] uppercase tracking-wide text-gray-400 dark:border-gray-800">
        문서 링크{query ? ` — "${query}"` : ''}
      </div>
      {loading && hits.length === 0 ? (
        <p className="px-2 py-3 text-center text-xs text-gray-500">검색 중…</p>
      ) : hits.length === 0 ? (
        <p className="px-2 py-3 text-center text-xs text-gray-400">
          {query ? '일치하는 문서가 없습니다' : '검색어를 입력하세요'}
        </p>
      ) : (
        <ul className="max-h-60 overflow-y-auto py-1">
          {hits.map((hit, i) => {
            const active = i === activeIdx
            return (
              <li key={hit.slug} role="option" aria-selected={active}>
                <button
                  type="button"
                  onMouseEnter={() => setActiveIdx(i)}
                  onClick={() => onPick(hit)}
                  data-testid="wiki-link-autocomplete-item"
                  className={cn(
                    'flex w-full flex-col items-start gap-0.5 px-2 py-1.5 text-left text-sm transition-colors',
                    active
                      ? 'bg-smsg-100 text-smsg-900 dark:bg-smsg-900/30'
                      : 'text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800',
                  )}
                >
                  <span className="block w-full truncate font-medium">{hit.title}</span>
                  <span className="block w-full truncate font-mono text-[10px] text-gray-500">
                    [[{hit.slug}]]
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      <div className="border-t border-gray-100 px-2 py-1 text-[10px] text-gray-400 dark:border-gray-800">
        ↑↓ 이동 · Enter 삽입 · Esc 닫기
      </div>
    </div>
  )
}

/**
 * Inspect the text leading up to the caret and decide whether a wiki-link
 * autocomplete trigger is active.
 *
 * Trigger rules:
 *   - The most recent unclosed `[[` (after the last `]]`, if any) defines the
 *     trigger position.
 *   - The substring between `[[` and the caret is the query.
 *   - Query must not contain `]`, `\n`, `\r`, or `[` — typing any of those
 *     cancels the trigger.
 *   - Query length is capped at 80 chars; beyond that we assume the user
 *     isn't actually trying to autocomplete.
 *
 * Returns `{ start, query }` where `start` is the offset of the FIRST `[`
 * of the `[[` opener (so the caller can replace `text.slice(start, caret)`
 * with the chosen link). Returns `null` when no trigger is active.
 *
 * Exported for unit tests.
 */
export function detectWikiTrigger(
  textBeforeCaret: string,
): { start: number; query: string } | null {
  // Walk backwards from the caret. The closest `[[` not yet closed by `]]`
  // wins; bail early when we hit a disqualifying character.
  let i = textBeforeCaret.length - 1
  while (i >= 0) {
    const ch = textBeforeCaret[i]
    if (!ch) break
    if (ch === '\n' || ch === '\r') return null
    if (ch === ']') return null
    if (ch === '[' && textBeforeCaret[i - 1] === '[') {
      const query = textBeforeCaret.slice(i + 1)
      if (query.length > 80) return null
      // The query is allowed to be empty — that's the "just typed `[[`" case.
      return { start: i - 1, query }
    }
    if (ch === '[') {
      // A single `[` not followed by another `[` to its left can only be a
      // disqualifier (would form `[query` not `[[query`).
      return null
    }
    i--
  }
  return null
}

/**
 * Build the replacement text that the parent should splice in.
 *
 *   query empty     → `[[slug]]`
 *   query === slug  → `[[slug]]`
 *   otherwise       → `[[slug|query]]`
 *
 * Exported for unit tests.
 */
export function buildWikiLinkInsertion(slug: string, query: string): string {
  const trimmed = query.trim()
  if (!trimmed || trimmed === slug) return `[[${slug}]]`
  return `[[${slug}|${trimmed}]]`
}
