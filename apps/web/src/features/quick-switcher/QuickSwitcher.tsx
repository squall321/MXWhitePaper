import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { useNavigate } from 'react-router-dom'
import { useDocumentList } from '@/features/document/hooks/useDocumentList'
import { useBookmarks } from '@/features/bookmarks/hooks/useBookmarks'
import { useRecentStore } from '@/features/recent/store'
import { useEditorStore } from '@/features/editor/state'
import { useSectionCollapseStore } from '@/features/editor/sectionCollapseStore'
import type {
  SectionLevel1,
  SectionLevel2,
  SectionLevel3,
} from '@/types/document'
import { fuzzyMatchedCount, fuzzyScore, highlightMatches } from './fuzzyMatch'
import { cn } from '@/components/ui/cn'

interface QuickSwitcherProps {
  open: boolean
  onClose: () => void
  /** Optional callback to open the heavier CommandPalette (Ctrl+K). */
  onOpenCommandPalette?: () => void
}

type ResultKind = 'doc' | 'bookmark' | 'recent' | 'section'

interface BaseResult {
  id: string
  kind: ResultKind
  /** Visible label (title). */
  title: string
  /** Secondary line (slug or section number). */
  subtitle?: string
  /** Score when fuzzy-filtered. 0 when listed by default. */
  score: number
}

interface DocResult extends BaseResult {
  kind: 'doc' | 'bookmark' | 'recent'
  slug: string
}

interface SectionResult extends BaseResult {
  kind: 'section'
  number: string
  /** Section ULID — used to expand the section group if collapsed. */
  sectionId: string
}

type AnyResult = DocResult | SectionResult

const ICON_BY_KIND: Record<ResultKind, string> = {
  doc: '📄',
  bookmark: '⭐',
  recent: '🕒',
  section: '📑',
}

/**
 * Quick Switcher — Ctrl+P. Lighter than the CommandPalette: single list, no
 * tabs, no filters. Fuzzy-matches across docs / bookmarks / recents and the
 * current doc's sections (when the query starts with `#`).
 */
export function QuickSwitcher({
  open,
  onClose,
  onOpenCommandPalette,
}: QuickSwitcherProps) {
  const [q, setQ] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listboxId = useId()
  const navigate = useNavigate()

  // Pull data only when open — avoids unnecessary churn on every keystroke
  // somewhere else in the app.
  const enabled = open
  const docList = useDocumentList({ limit: 100 })
  const bookmarkList = useBookmarks(null)
  const recentItems = useRecentStore((s) => s.items)
  const editorDraft = useEditorStore((s) => s.draft)
  const editorSlug = useEditorStore((s) => s.slug)

  const sectionMode = q.startsWith('#')
  const needle = sectionMode ? q.slice(1).trim() : q.trim()

  // Build candidate result set. Section mode walks the editor draft; default
  // mode merges docs / bookmarks / recents (deduped by slug, recent wins).
  const results = useMemo<AnyResult[]>(() => {
    if (!enabled) return []
    if (sectionMode) return buildSectionResults(editorDraft, needle)
    return buildDocResults({
      query: needle,
      docs: docList.data ?? [],
      bookmarks: bookmarkList.data ?? [],
      recent: recentItems,
    })
  }, [
    enabled,
    sectionMode,
    needle,
    editorDraft,
    docList.data,
    bookmarkList.data,
    recentItems,
  ])

  const visible = results.slice(0, 8)

  // Reset on open.
  useEffect(() => {
    if (open) {
      setQ('')
      setActiveIdx(0)
      const t = window.setTimeout(() => inputRef.current?.focus(), 0)
      return () => window.clearTimeout(t)
    }
  }, [open])

  // Clamp cursor on list change.
  useEffect(() => {
    setActiveIdx((idx) => {
      if (visible.length === 0) return 0
      return Math.min(idx, visible.length - 1)
    })
  }, [visible.length])

  // Esc closes.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const pick = useCallback(
    (r: AnyResult) => {
      onClose()
      if (r.kind === 'section') {
        // Same-doc anchor → use the WikiLink-style smooth-scroll path. Expand
        // the section group first if the collapse store says it's hidden.
        const slug = editorSlug
        if (slug) {
          const cs = useSectionCollapseStore.getState()
          if (cs.isCollapsed(slug, r.sectionId)) {
            cs.setCollapsed(slug, r.sectionId, false)
          }
        }
        const domId = `section-${r.number}`
        // requestAnimationFrame so the section reflow happens before scroll.
        requestAnimationFrame(() => {
          const el = document.getElementById(domId)
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'start' })
            try {
              history.replaceState(null, '', `#${domId}`)
            } catch {
              /* sandboxed iframe — ignore */
            }
          }
        })
        return
      }
      navigate(`/docs/${encodeURIComponent(r.slug)}`)
    },
    [onClose, navigate, editorSlug],
  )

  const onInputKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx((i) => (visible.length === 0 ? 0 : (i + 1) % visible.length))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx((i) =>
        visible.length === 0 ? 0 : (i - 1 + visible.length) % visible.length,
      )
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const r = visible[activeIdx]
      if (r) pick(r)
    }
  }

  if (!open) return null

  const isEmptyQuery = q.length === 0
  const optionId = (i: number) => `${listboxId}-opt-${i}`

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="빠른 이동"
      className="fixed inset-0 z-modal flex items-start justify-center bg-black/40 anim-fade backdrop-blur-sm dark:bg-black/60"
      style={{ paddingTop: '10vh' }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      data-testid="quick-switcher"
    >
      <div className="w-full max-w-[480px] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">
        <div className="flex items-center gap-2 border-b border-gray-200 px-3 py-2.5 dark:border-gray-800">
          <span aria-hidden="true" className="text-gray-400">
            ⚡
          </span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder={
              sectionMode
                ? '현재 문서에서 섹션 검색...'
                : '문서로 이동... (# 입력 시 섹션)'
            }
            className="min-w-0 flex-1 bg-transparent px-1 py-1 text-sm text-gray-900 placeholder-gray-400 outline-none dark:text-gray-100 dark:placeholder-gray-500"
            role="combobox"
            aria-expanded
            aria-controls={listboxId}
            aria-activedescendant={
              visible.length > 0 ? optionId(activeIdx) : undefined
            }
            aria-autocomplete="list"
            data-testid="quick-switcher-input"
          />
          <kbd className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
            Esc
          </kbd>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-1.5">
          {visible.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-gray-400">
              {isEmptyQuery ? '문서 또는 섹션을 검색하세요' : '결과 없음'}
            </p>
          ) : (
            <ul
              role="listbox"
              id={listboxId}
              aria-label="빠른 이동 결과"
              className="space-y-0.5"
            >
              {visible.map((r, i) => {
                const active = i === activeIdx
                return (
                  <li key={`${r.kind}:${r.id}`}>
                    <button
                      type="button"
                      role="option"
                      id={optionId(i)}
                      aria-selected={active}
                      onMouseEnter={() => setActiveIdx(i)}
                      onClick={() => pick(r)}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors',
                        active ? 'bg-smsg-100' : 'hover:bg-smsg-50',
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className="grid h-6 w-6 shrink-0 place-items-center text-sm"
                      >
                        {ICON_BY_KIND[r.kind]}
                      </span>
                      <div className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-smsg-900">
                          <Highlighted
                            text={r.title}
                            query={sectionMode ? needle : q}
                          />
                        </span>
                        {r.subtitle && (
                          <span className="block truncate font-mono text-[10px] text-gray-500">
                            {r.subtitle}
                          </span>
                        )}
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}

          {isEmptyQuery && (
            <DefaultLists
              recent={recentItems}
              bookmarks={bookmarkList.data ?? []}
              onPickSlug={(slug) => {
                onClose()
                navigate(`/docs/${encodeURIComponent(slug)}`)
              }}
              onOpenCommandPalette={() => {
                onClose()
                onOpenCommandPalette?.()
              }}
            />
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-gray-200 bg-gray-50 px-3 py-1.5 text-[11px] text-gray-500 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-400">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="flex items-center gap-1">
              <Hint>↑↓</Hint> 이동
            </span>
            <span className="flex items-center gap-1">
              <Hint>Enter</Hint> 선택
            </span>
            <span className="flex items-center gap-1">
              <Hint>Esc</Hint> 닫기
            </span>
            <span className="flex items-center gap-1">
              <Hint>#</Hint> 섹션
            </span>
          </div>
          <span className="hidden sm:inline">Quick Switcher</span>
        </div>
      </div>
    </div>
  )
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-gray-200 bg-white px-1 py-0.5 font-mono text-[10px] font-medium text-gray-700">
      {children}
    </kbd>
  )
}

function Highlighted({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>
  const segs = highlightMatches(text, query)
  return (
    <>
      {segs.map((s, i) =>
        s.match ? (
          <mark
            key={i}
            className="bg-smsg-100 not-italic font-semibold text-smsg-900"
          >
            {s.text}
          </mark>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  )
}

interface DefaultListsProps {
  recent: { slug: string; title: string }[]
  bookmarks: { slug: string; title: string }[]
  onPickSlug: (slug: string) => void
  onOpenCommandPalette: () => void
}

/** Empty-query rendering: last 5 recent + top 3 bookmarks + palette hint. */
function DefaultLists({
  recent,
  bookmarks,
  onPickSlug,
  onOpenCommandPalette,
}: DefaultListsProps) {
  const recentSlice = (recent ?? []).slice(0, 5)
  const bookmarkSlice = (bookmarks ?? []).slice(0, 3)
  const hasAny = recentSlice.length > 0 || bookmarkSlice.length > 0
  if (!hasAny) {
    return (
      <div className="px-2 py-3">
        <button
          type="button"
          onClick={onOpenCommandPalette}
          className="block w-full rounded-md border border-dashed border-gray-300 px-2 py-2 text-center text-xs text-gray-500 hover:border-smsg-300 hover:text-smsg-700"
        >
          📋 명령어 보기
        </button>
      </div>
    )
  }
  return (
    <div className="space-y-1.5 pt-1">
      {recentSlice.length > 0 && (
        <DefaultGroup
          label="최근"
          icon="🕒"
          items={recentSlice}
          onPickSlug={onPickSlug}
        />
      )}
      {bookmarkSlice.length > 0 && (
        <DefaultGroup
          label="즐겨찾기"
          icon="⭐"
          items={bookmarkSlice}
          onPickSlug={onPickSlug}
        />
      )}
      <button
        type="button"
        onClick={onOpenCommandPalette}
        className="mt-1 block w-full rounded-md border border-dashed border-gray-300 px-2 py-1.5 text-center text-[11px] text-gray-500 hover:border-smsg-300 hover:text-smsg-700"
      >
        📋 명령어 보기
      </button>
    </div>
  )
}

function DefaultGroup({
  label,
  icon,
  items,
  onPickSlug,
}: {
  label: string
  icon: string
  items: { slug: string; title: string }[]
  onPickSlug: (slug: string) => void
}) {
  return (
    <section>
      <p className="px-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
        {label}
      </p>
      <ul className="space-y-0.5">
        {items.map((it) => (
          <li key={it.slug}>
            <button
              type="button"
              onClick={() => onPickSlug(it.slug)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm text-gray-700 hover:bg-smsg-50"
            >
              <span aria-hidden="true">{icon}</span>
              <span className="min-w-0 flex-1 truncate">{it.title}</span>
              <span className="shrink-0 truncate font-mono text-[10px] text-gray-400">
                {it.slug}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

interface BuildDocResultsArgs {
  query: string
  docs: { slug: string; title: string }[]
  bookmarks: { slug: string; title: string }[]
  recent: { slug: string; title: string }[]
}

function buildDocResults({
  query,
  docs,
  bookmarks,
  recent,
}: BuildDocResultsArgs): DocResult[] {
  // Merge into a map keyed by slug; first writer wins on `kind` (recent → bookmark → doc).
  const seen = new Map<string, { kind: ResultKind; title: string }>()
  for (const r of recent) {
    if (r?.slug && !seen.has(r.slug)) {
      seen.set(r.slug, { kind: 'recent', title: r.title || r.slug })
    }
  }
  for (const b of bookmarks) {
    if (b?.slug && !seen.has(b.slug)) {
      seen.set(b.slug, { kind: 'bookmark', title: b.title || b.slug })
    }
  }
  for (const d of docs) {
    if (d?.slug && !seen.has(d.slug)) {
      seen.set(d.slug, { kind: 'doc', title: d.title || d.slug })
    }
  }

  const merged: DocResult[] = Array.from(seen.entries()).map(
    ([slug, v]) => ({
      id: slug,
      kind: v.kind as 'doc' | 'bookmark' | 'recent',
      title: v.title,
      slug,
      subtitle: slug,
      score: 0,
    }),
  )

  if (!query) {
    // No fuzzy filter — sort recent → bookmark → doc, keep input order otherwise.
    const order: Record<ResultKind, number> = {
      recent: 0,
      bookmark: 1,
      doc: 2,
      section: 3,
    }
    return merged.sort((a, b) => order[a.kind] - order[b.kind])
  }

  // Score against title + slug, take the max. Require *all* query chars to
  // match (in order) on at least one of the two fields — otherwise stray
  // single-char hits would flood the list.
  const qLen = query.length
  const scored = merged
    .map((r) => {
      const titleHit = fuzzyMatchedCount(query, r.title) === qLen
      const slugHit = fuzzyMatchedCount(query, r.slug) === qLen
      const score = Math.max(
        titleHit ? fuzzyScore(query, r.title) : 0,
        slugHit ? fuzzyScore(query, r.slug) : 0,
      )
      return { ...r, score }
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
  return scored
}

function buildSectionResults(
  draft: ReturnType<typeof useEditorStore.getState>['draft'],
  query: string,
): SectionResult[] {
  if (!draft || !Array.isArray(draft.sections)) return []
  const out: SectionResult[] = []
  type AnySection = SectionLevel1 | SectionLevel2 | SectionLevel3
  const stack: AnySection[] = [...draft.sections].reverse()
  while (stack.length > 0) {
    const cur = stack.pop()
    if (!cur) continue
    const num = cur.number ?? ''
    if (cur.title) {
      out.push({
        id: cur.id,
        kind: 'section',
        title: cur.title,
        subtitle: num ? `§${num}` : undefined,
        sectionId: cur.id,
        number: num,
        score: 0,
      })
    }
    if ('subsections' in cur && cur.subsections) {
      // Push in reverse so we walk in document order.
      const kids = cur.subsections as AnySection[]
      for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]!)
    }
  }
  if (!query) {
    return out
  }
  const qLen = query.length
  return out
    .map((r) => {
      const titleHit = fuzzyMatchedCount(query, r.title) === qLen
      const numberHit = r.number
        ? fuzzyMatchedCount(query, r.number) === qLen
        : false
      const score = Math.max(
        titleHit ? fuzzyScore(query, r.title) : 0,
        numberHit ? fuzzyScore(query, r.number) : 0,
      )
      return { ...r, score }
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
}

/** Test-only export so we can unit-test the merge/score logic without React. */
export const __test = { buildDocResults, buildSectionResults }
