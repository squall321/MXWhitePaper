import { useEffect, useRef, useState } from 'react'
import { getDocument, type DocumentResult } from '@/features/document/api'
import type {
  ParagraphBlock,
  SectionLevel1,
  SectionLevel2,
  SectionLevel3,
} from '@/types/document'

/**
 * Smart wiki-link hover preview.
 *
 * - On mouseenter, wait 500ms (debounce) before fetching `/documents/<slug>`.
 * - Cache hits render instantly; the cache is a module-local Map with a
 *   5-minute TTL so the same slug doesn't trigger duplicate requests across
 *   the page.
 * - Anchor links (`anchor` set) show the target *section's* title and the
 *   first paragraph from that section.
 * - Missing target → "링크가 없는 문서 — 클릭해서 만들기".
 *
 * Pure positioning via `getBoundingClientRect` from a parent ref — no portal,
 * no extra deps. Hides on mouseleave of the trigger or the popup itself.
 */

interface CacheEntry {
  data: DocumentResult | null /* null = NOT_FOUND */
  expiresAt: number
}

const CACHE_TTL_MS = 5 * 60 * 1000
const cache = new Map<string, CacheEntry>()
// In-flight requests dedupe — multiple WikiLinks pointing at the same slug
// share a single fetch.
const inFlight = new Map<string, Promise<DocumentResult | null>>()

/** Test-only: clear the module-local cache. */
export function __clearLinkPreviewCache() {
  cache.clear()
  inFlight.clear()
}

async function fetchDoc(slug: string): Promise<DocumentResult | null> {
  const now = Date.now()
  const hit = cache.get(slug)
  if (hit && hit.expiresAt > now) return hit.data

  const existing = inFlight.get(slug)
  if (existing) return existing

  const p = (async () => {
    try {
      const data = await getDocument(slug)
      cache.set(slug, { data, expiresAt: Date.now() + CACHE_TTL_MS })
      return data
    } catch {
      // 404 / 5xx — cache the negative result briefly so we don't hammer the
      // server. Same TTL is fine: the user re-hovers in 5 minutes anyway.
      cache.set(slug, { data: null, expiresAt: Date.now() + CACHE_TTL_MS })
      return null
    } finally {
      inFlight.delete(slug)
    }
  })()
  inFlight.set(slug, p)
  return p
}

interface Props {
  slug: string
  /** `section-1.1` or `1.1` — passed through as-is from the link. */
  anchor?: string
  /** The DOM element used to position the preview. */
  anchorEl: HTMLElement | null
  onClose: () => void
}

export function LinkPreview({ slug, anchor, anchorEl, onClose }: Props) {
  const [state, setState] = useState<
    | { phase: 'loading' }
    | { phase: 'ready'; data: DocumentResult }
    | { phase: 'missing' }
  >({ phase: 'loading' })
  const popupRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let cancelled = false
    void fetchDoc(slug).then((data) => {
      if (cancelled) return
      if (!data) setState({ phase: 'missing' })
      else setState({ phase: 'ready', data })
    })
    return () => {
      cancelled = true
    }
  }, [slug])

  // Position relative to the anchor element. Fixed positioning so the popup
  // doesn't get clipped by overflow ancestors. Recompute on scroll/resize so
  // the popup tracks if the page moves under it.
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  useEffect(() => {
    if (!anchorEl) return
    const compute = () => {
      const r = anchorEl.getBoundingClientRect()
      // Below the link by 6px; clamp to viewport on the right edge.
      const POPUP_W = 320
      const left = Math.min(
        Math.max(8, r.left),
        Math.max(8, window.innerWidth - POPUP_W - 8),
      )
      setPos({ top: r.bottom + 6, left })
    }
    compute()
    window.addEventListener('scroll', compute, true)
    window.addEventListener('resize', compute)
    return () => {
      window.removeEventListener('scroll', compute, true)
      window.removeEventListener('resize', compute)
    }
  }, [anchorEl])

  if (!pos) return null

  const baseCls =
    'fixed z-50 w-80 rounded-md border border-gray-200 bg-white p-3 text-xs shadow-lg dark:border-gray-700 dark:bg-gray-900'
  const style = { top: pos.top, left: pos.left }

  if (state.phase === 'loading') {
    return (
      <div
        ref={popupRef}
        role="tooltip"
        data-testid="wiki-link-preview"
        className={baseCls}
        style={style}
        onMouseLeave={onClose}
      >
        <div className="h-3 w-2/3 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
        <div className="mt-2 h-3 w-full animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
      </div>
    )
  }

  if (state.phase === 'missing') {
    return (
      <div
        ref={popupRef}
        role="tooltip"
        data-testid="wiki-link-preview"
        className={`${baseCls} text-link-missing`}
        style={style}
        onMouseLeave={onClose}
      >
        링크가 없는 문서 — 클릭해서 만들기
      </div>
    )
  }

  const { data } = state
  const meta = data.document.metadata
  const trail = [meta.division, meta.team, meta.group, meta.part]
    .filter(Boolean)
    .join(' / ')

  // Anchor mode: dig out the target section and its first paragraph.
  if (anchor) {
    const numeric = anchor.startsWith('section-')
      ? anchor.slice('section-'.length)
      : anchor
    const sec = findSection(data.document.sections, numeric)
    return (
      <div
        ref={popupRef}
        role="tooltip"
        data-testid="wiki-link-preview"
        className={baseCls}
        style={style}
        onMouseLeave={onClose}
      >
        <p className="font-semibold text-smsg-900 dark:text-gray-100">
          {sec ? `${sec.number ?? numeric} ${sec.title}` : `#${anchor}`}
        </p>
        {sec ? (
          <p className="mt-1 line-clamp-3 text-gray-600 dark:text-gray-400">
            {firstParagraph(sec) ?? '(빈 섹션)'}
          </p>
        ) : (
          <p className="mt-1 text-gray-500">섹션을 찾을 수 없습니다</p>
        )}
        <p className="mt-2 text-[10px] text-gray-400">
          {data.document.title}
          {trail ? ` · ${trail}` : ''}
        </p>
      </div>
    )
  }

  return (
    <div
      ref={popupRef}
      role="tooltip"
      data-testid="wiki-link-preview"
      className={baseCls}
      style={style}
      onMouseLeave={onClose}
    >
      <p className="font-semibold text-smsg-900 dark:text-gray-100">
        {data.document.title}
      </p>
      {data.document.summary && (
        <p className="mt-1 line-clamp-3 text-gray-600 dark:text-gray-400">
          {truncate(data.document.summary, 200)}
        </p>
      )}
      <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-gray-400">
        {trail && <span className="truncate">{trail}</span>}
        {data.row.updated_at && (
          <span className="shrink-0">{formatDate(data.row.updated_at)}</span>
        )}
      </div>
    </div>
  )
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s
  return s.slice(0, n).trimEnd() + '…'
}

function formatDate(iso: string): string {
  // YYYY-MM-DD only — the popup is tiny.
  return iso.slice(0, 10)
}

type AnySection = SectionLevel1 | SectionLevel2 | SectionLevel3

function findSection(
  sections: SectionLevel1[],
  num: string,
): AnySection | null {
  const stack: AnySection[] = [...sections]
  while (stack.length > 0) {
    const cur = stack.pop()
    if (!cur) continue
    if (cur.number === num) return cur
    if ('subsections' in cur && cur.subsections) {
      for (const s of cur.subsections) stack.push(s as AnySection)
    }
  }
  return null
}

function firstParagraph(sec: AnySection): string | null {
  const p = (sec.blocks ?? []).find(
    (b): b is ParagraphBlock => b.type === 'paragraph',
  )
  return p ? truncate(p.text, 200) : null
}
