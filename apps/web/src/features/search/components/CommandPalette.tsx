import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  useDocumentSearch,
  useKnowledgeSearch,
  useRecentSearches,
  useWidgetRegistry,
  useSearchSuggest,
  type RecentSearchItem,
} from '../hooks/useSearch'
import type { DocSearchHit, WidgetRegistryEntry } from '../api'
import { KnowledgeResults } from './KnowledgeResults'
import { useAuthStore } from '@/features/auth/store'
import { cn } from '@/components/ui/cn'

// KeyboardShortcutsModal is opened via the "?" shortcut from inside the
// palette — defer the chunk download until that first open.
const KeyboardShortcutsModal = lazy(() =>
  import('@/features/editor/components/KeyboardShortcutsModal').then((m) => ({
    default: m.KeyboardShortcutsModal,
  })),
)

interface CommandPaletteProps {
  open: boolean
  onClose: () => void
  /** Optional initial query (e.g., when launched from the top-bar input). */
  initialQuery?: string
}

type Tab = 'docs' | 'knowledge' | 'tags' | 'people' | 'widgets' | 'commands'

/** Filter chip state for the 문서 tab. */
interface DocFilters {
  team: string | null
  category: string | null
  confidentiality: 'public' | 'internal' | 'restricted' | null
}

const EMPTY_FILTERS: DocFilters = { team: null, category: null, confidentiality: null }

/**
 * ⌘K command palette — keyboard-first, Mac-style. Three tabs:
 *   - 문서: full-text search via `/search` (debounced 200ms),
 *           grouped by 제목/본문/태그 매칭, filter chips for 팀/카테고리/기밀도.
 *   - 위젯: lists `/widgets/registry`, filtered client-side.
 *   - 명령: app-level commands (새 문서, 환경설정, 도움말, …).
 *
 * Keyboard:
 *   - ↑↓: navigate through the merged list of options
 *   - Enter: open the focused option
 *   - ⌘ Enter / Ctrl Enter: open in a new tab (docs only)
 *   - Tab / ⇧ Tab: switch tabs
 *   - Esc: close
 */
export function CommandPalette({ open, onClose, initialQuery = '' }: CommandPaletteProps) {
  const [tab, setTab] = useState<Tab>('docs')
  const [q, setQ] = useState(initialQuery)
  const [filters, setFilters] = useState<DocFilters>(EMPTY_FILTERS)
  const [activeIdx, setActiveIdx] = useState(0)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  // Track the visual-viewport height so the results list can shrink when the
  // mobile soft-keyboard pops up. Without this, the keyboard can cover the
  // input (the dialog is `items-end` on mobile and `max-h-80` on the list,
  // so the bottom keyboard-hint row + list together push the input above
  // the keyboard, sometimes off-screen).
  const [listMaxPx, setListMaxPx] = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listboxId = useId()
  const navigate = useNavigate()
  const location = useLocation()
  const recent = useRecentSearches()
  const user = useAuthStore((s) => s.user)
  const isAdmin = !!user && user.role === 'admin'

  const { data: docHitsRaw = [], isFetching: docsFetching } = useDocumentSearch(q)
  const docHits = useMemo(
    () => filterDocs(docHitsRaw as DocSearchHit[], filters),
    [docHitsRaw, filters],
  )
  const grouped = useMemo(() => groupHits(q, docHits), [q, docHits])
  const flatDocs = useMemo(
    () => [...grouped.title, ...grouped.body, ...grouped.tag],
    [grouped],
  )

  // 시스템 지식 (lat/guide/doc/archive) — roadmap Phase 5.
  const { data: knowledge, isFetching: knowledgeFetching } = useKnowledgeSearch(q)
  const knowledgeHits = knowledge?.items ?? []

  // Suggest payload for tags / people tabs (cycle 5 J3).
  const { data: suggest } = useSearchSuggest(q)
  const tagMatches = suggest?.tags ?? []
  const peopleMatches = suggest?.authors ?? []

  const { data: widgetList = [] } = useWidgetRegistry()
  const widgetMatches = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return widgetList
    // Defend every field — the widget registry response can include
    // entries where `name`/`type` are missing (older docs / partial
    // server payloads), and `.toLowerCase()` on undefined crashes the
    // whole palette. `?? ''` keeps the row in the result set but lets
    // the search safely miss it.
    return widgetList.filter(
      (w) =>
        (w?.name ?? '').toLowerCase().includes(needle) ||
        (w?.type ?? '').toLowerCase().includes(needle) ||
        (w?.description ?? '').toLowerCase().includes(needle),
    )
  }, [widgetList, q])

  const commands = useMemo(
    () => buildCommands({ canAdmin: isAdmin, location: location.pathname }),
    [isAdmin, location.pathname],
  )
  const commandMatches = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return commands
    return commands.filter(
      (c) =>
        (c?.label ?? '').toLowerCase().includes(needle) ||
        (c?.hint ?? '').toLowerCase().includes(needle),
    )
  }, [commands, q])

  // The list the keyboard cursor walks. Recomputed when the tab/data shifts.
  const optionCount =
    tab === 'docs'
      ? flatDocs.length
      : tab === 'knowledge'
        ? knowledgeHits.length
        : tab === 'tags'
          ? tagMatches.length
          : tab === 'people'
            ? peopleMatches.length
            : tab === 'widgets'
              ? widgetMatches.length
              : commandMatches.length

  const goDoc = useCallback(
    (hit: DocSearchHit, newTab = false) => {
      recent.push(q)
      const url = `/docs/${encodeURIComponent(hit.slug)}`
      if (newTab) {
        try {
          window.open(url, '_blank', 'noopener,noreferrer')
        } catch {
          /* ignore */
        }
        onClose()
        return
      }
      onClose()
      navigate(url)
    },
    [q, recent, onClose, navigate],
  )

  const goGraph = useCallback(
    (hit: DocSearchHit) => {
      recent.push(q)
      onClose()
      navigate(`/graph/${encodeURIComponent(hit.slug)}?depth=2`)
    },
    [q, recent, onClose, navigate],
  )

  const runCommand = useCallback(
    (cmd: CommandItem) => {
      onClose()
      cmd.run({ navigate, openShortcuts: () => setShortcutsOpen(true) })
    },
    [navigate, onClose],
  )

  // Reset on open.
  useEffect(() => {
    if (open) {
      setQ(initialQuery)
      setTab('docs')
      setFilters(EMPTY_FILTERS)
      setActiveIdx(0)
      const t = window.setTimeout(() => inputRef.current?.focus(), 0)
      return () => window.clearTimeout(t)
    }
  }, [open, initialQuery])

  // Whenever the filtered list changes, clamp the cursor.
  useEffect(() => {
    setActiveIdx((idx) => {
      if (optionCount === 0) return 0
      return Math.min(idx, optionCount - 1)
    })
  }, [optionCount, tab])

  // ESC closes.
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

  // Mobile keyboard guard — when the soft-keyboard pops up the visual
  // viewport shrinks but the layout viewport doesn't, so a bottom-pinned
  // dialog can be covered. We subtract chrome (input + tabs + hint row
  // ≈ 160px) from the viewport height and use that as the results-list
  // cap. Only kicks in below the `sm` breakpoint; desktop keeps `max-h-80`.
  useEffect(() => {
    if (!open) return
    const vv = typeof window !== 'undefined' ? window.visualViewport : null
    if (!vv) return
    const recompute = () => {
      const isMobile = window.innerWidth < 640 // tailwind `sm`
      if (!isMobile) {
        setListMaxPx(null)
        return
      }
      // Reserve room for input (~52), tab bar (~36), filter chips (~36 when
      // present), and footer hints (~36). 160 is a safe minimum.
      const reserved = 160
      const available = Math.max(120, vv.height - reserved)
      setListMaxPx(available)
    }
    recompute()
    vv.addEventListener('resize', recompute)
    window.addEventListener('resize', recompute)
    return () => {
      vv.removeEventListener('resize', recompute)
      window.removeEventListener('resize', recompute)
    }
  }, [open])

  if (!open) return null

  const onInputKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx((idx) => (optionCount === 0 ? 0 : (idx + 1) % optionCount))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx((idx) => (optionCount === 0 ? 0 : (idx - 1 + optionCount) % optionCount))
      return
    }
    if (e.key === 'Tab') {
      e.preventDefault()
      const order: Tab[] = ['docs', 'knowledge', 'tags', 'people', 'widgets', 'commands']
      const i = order.indexOf(tab)
      const dir = e.shiftKey ? -1 : 1
      const next = order[(i + dir + order.length) % order.length]!
      setTab(next)
      return
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      // Left/right arrows switch tabs (cycle 5 J3 polish).
      e.preventDefault()
      const order: Tab[] = ['docs', 'knowledge', 'tags', 'people', 'widgets', 'commands']
      const i = order.indexOf(tab)
      const dir = e.key === 'ArrowRight' ? 1 : -1
      const next = order[(i + dir + order.length) % order.length]!
      setTab(next)
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const newTab = e.metaKey || e.ctrlKey
      if (tab === 'docs') {
        const hit = flatDocs[activeIdx]
        if (hit) goDoc(hit, newTab)
        else if (q.trim()) recent.push(q.trim())
        return
      }
      if (tab === 'commands') {
        const cmd = commandMatches[activeIdx]
        if (cmd) runCommand(cmd)
        return
      }
      if (tab === 'tags') {
        const t = tagMatches[activeIdx]
        if (t) {
          recent.push(q.trim())
          onClose()
          navigate(`/search?tag=${encodeURIComponent(t.tag)}`)
        }
        return
      }
      if (tab === 'people') {
        const p = peopleMatches[activeIdx]
        if (p) {
          recent.push(q.trim())
          onClose()
          navigate(`/search?author=${encodeURIComponent(p.id)}`)
        }
        return
      }
      // widgets / knowledge tab — there's no nav action, but we still register the search.
      if (q.trim()) recent.push(q.trim())
    }
  }

  const optionId = (i: number) => `${listboxId}-opt-${i}`

  return (
    <>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="명령 팔레트"
        className="fixed inset-0 z-modal flex items-end justify-center bg-black/40 anim-fade backdrop-blur-sm sm:items-start sm:px-4 sm:pt-[10vh] dark:bg-black/60"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose()
        }}
      >
        <div className="w-full max-w-xl overflow-hidden rounded-t-xl border border-gray-200 bg-white shadow-lg animate-slide-up sm:rounded-xl dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">
          <div className="flex items-center gap-2 border-b border-gray-200 px-3 py-3 dark:border-gray-800">
            <SearchIcon className="text-gray-400" />
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={onInputKeyDown}
              placeholder={
                tab === 'commands' ? '명령어를 입력하세요...' : '문서, 위젯, 명령어를 검색하세요...'
              }
              className="min-w-0 flex-1 bg-transparent px-1 py-1 text-base text-gray-900 placeholder-gray-400 outline-none dark:text-gray-100 dark:placeholder-gray-500"
              role="combobox"
              aria-expanded
              aria-controls={listboxId}
              aria-activedescendant={optionCount > 0 ? optionId(activeIdx) : undefined}
              aria-autocomplete="list"
              data-testid="palette-input"
            />
            <kbd className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
              Esc
            </kbd>
          </div>

          <div className="flex border-b border-gray-200 text-xs dark:border-gray-800" role="tablist" aria-label="검색 영역">
            <TabBtn
              active={tab === 'docs'}
              onClick={() => setTab('docs')}
              label="문서"
              count={flatDocs.length}
            />
            <TabBtn
              active={tab === 'knowledge'}
              onClick={() => setTab('knowledge')}
              label="시스템 지식"
              count={knowledgeHits.length}
            />
            <TabBtn
              active={tab === 'tags'}
              onClick={() => setTab('tags')}
              label="태그"
              count={tagMatches.length}
            />
            <TabBtn
              active={tab === 'people'}
              onClick={() => setTab('people')}
              label="사람"
              count={peopleMatches.length}
            />
            <TabBtn
              active={tab === 'widgets'}
              onClick={() => setTab('widgets')}
              label="위젯"
              count={widgetMatches.length}
            />
            <TabBtn
              active={tab === 'commands'}
              onClick={() => setTab('commands')}
              label="명령"
              count={commandMatches.length}
            />
          </div>

          {tab === 'docs' && (
            <FilterChipRow
              hits={docHitsRaw as DocSearchHit[]}
              filters={filters}
              onChange={setFilters}
            />
          )}

          <div
            className="max-h-80 overflow-y-auto p-2"
            data-testid="palette-results"
            style={listMaxPx ? { maxHeight: `${listMaxPx}px` } : undefined}
          >
            {tab === 'docs' ? (
              <DocResults
                q={q}
                grouped={grouped}
                loading={docsFetching}
                recent={recent.items}
                onUseRecent={(s) => setQ(s)}
                onRemoveRecent={(s) => recent.remove(s)}
                onClearRecent={() => recent.clear()}
                onPick={goDoc}
                onGraph={goGraph}
                activeIdx={activeIdx}
                onActivate={setActiveIdx}
                listboxId={listboxId}
                optionId={optionId}
              />
            ) : tab === 'knowledge' ? (
              <KnowledgeResults
                q={q}
                items={knowledgeHits}
                loading={knowledgeFetching}
                activeIdx={activeIdx}
                onActivate={setActiveIdx}
                listboxId={listboxId}
                optionId={optionId}
              />
            ) : tab === 'tags' ? (
              <TagResults
                items={tagMatches}
                activeIdx={activeIdx}
                onActivate={setActiveIdx}
                onPick={(t) => {
                  recent.push(q.trim() || t.tag)
                  onClose()
                  navigate(`/search?tag=${encodeURIComponent(t.tag)}`)
                }}
                listboxId={listboxId}
                optionId={optionId}
              />
            ) : tab === 'people' ? (
              <PeopleResults
                items={peopleMatches}
                activeIdx={activeIdx}
                onActivate={setActiveIdx}
                onPick={(p) => {
                  recent.push(q.trim() || p.label)
                  onClose()
                  navigate(`/search?author=${encodeURIComponent(p.id)}`)
                }}
                listboxId={listboxId}
                optionId={optionId}
              />
            ) : tab === 'widgets' ? (
              <WidgetResults
                items={widgetMatches}
                activeIdx={activeIdx}
                onActivate={setActiveIdx}
                listboxId={listboxId}
                optionId={optionId}
              />
            ) : (
              <CommandResults
                items={commandMatches}
                onRun={runCommand}
                activeIdx={activeIdx}
                onActivate={setActiveIdx}
                listboxId={listboxId}
                optionId={optionId}
              />
            )}
          </div>

          <div className="safe-bottom flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-gray-200 bg-gray-50 px-3 py-2 text-[11px] text-gray-500 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-400">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="flex items-center gap-1"><Hint>↑↓</Hint> 이동</span>
              <span className="flex items-center gap-1"><Hint>Enter</Hint> 선택</span>
              <span className="flex items-center gap-1"><Hint>Esc</Hint> 닫기</span>
              <span className="flex items-center gap-1"><Hint>Tab</Hint> 탭 전환</span>
              <span className="flex items-center gap-1"><Hint>⌘ Enter</Hint> 새 탭</span>
            </div>
            <span className="hidden sm:inline">MX White Paper</span>
          </div>
        </div>
      </div>
      {shortcutsOpen && (
        <Suspense fallback={null}>
          <KeyboardShortcutsModal
            open={shortcutsOpen}
            onClose={() => setShortcutsOpen(false)}
          />
        </Suspense>
      )}
    </>
  )
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-gray-200 bg-white px-1 py-0.5 font-mono text-[10px] font-medium text-gray-700">
      {children}
    </kbd>
  )
}

function TabBtn({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean
  onClick: () => void
  label: string
  count?: number
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 px-3 py-2 transition-colors',
        active
          ? 'border-b-2 border-smsg-700 font-semibold text-smsg-900'
          : 'text-gray-500 hover:text-gray-700',
      )}
    >
      {label}
      {typeof count === 'number' && count > 0 && (
        <span
          className={cn(
            'rounded-full px-1.5 py-px text-[10px] font-medium',
            active ? 'bg-smsg-700 text-white' : 'bg-gray-100 text-gray-500',
          )}
        >
          {count}
        </span>
      )}
    </button>
  )
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
      <path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

function DocIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="text-smsg-500">
      <path d="M3 1.5h7l3 3V14a.5.5 0 01-.5.5h-9A.5.5 0 013 14V2a.5.5 0 010-.5z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M9.5 1.5V5h3.5" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  )
}

function GraphIcon() {
  // 3 노드 + 2 엣지 — 지식그래프 아이콘.
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="3.5" cy="11" r="1.8" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="12.5" cy="11" r="1.8" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="8" cy="3.5" r="1.8" stroke="currentColor" strokeWidth="1.3" />
      <path d="M5 9.7 7 5M9 5l2 4.7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

function WidgetIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="text-smsg-500">
      <rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4" />
      <rect x="9" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4" />
      <rect x="2" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4" />
      <rect x="9" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  )
}

function HistoryIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="text-gray-400">
      <circle cx="8" cy="8" r="6.3" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 4.5V8l2.2 1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

interface GroupedDocs {
  title: DocSearchHit[]
  body: DocSearchHit[]
  tag: DocSearchHit[]
}

function groupHits(q: string, hits: DocSearchHit[]): GroupedDocs {
  const needle = q.trim().toLowerCase()
  if (!needle) return { title: hits, body: [], tag: [] }
  const title: DocSearchHit[] = []
  const body: DocSearchHit[] = []
  const tag: DocSearchHit[] = []
  // meili 응답의 hilight tag 는 BE 설정상 `<mark>` 가 기본 — 과거 `<em>` 도
  // 호환되도록 둘 다 검사.
  const hasMark = (s: string | null | undefined) =>
    typeof s === 'string' && (s.includes('<em>') || s.includes('<mark>'))
  for (const h of hits) {
    const tHit =
      hasMark(h._formatted?.title) ||
      (h.title ?? '').toLowerCase().includes(needle)
    const tagHit =
      (Array.isArray(h._formatted?.tags) && h._formatted!.tags!.some(hasMark)) ||
      (Array.isArray(h.tags) && h.tags.some((t) => (t ?? '').toLowerCase().includes(needle)))
    if (tHit) title.push(h)
    else if (tagHit) tag.push(h)
    else body.push(h)
  }
  return { title, body, tag }
}

function filterDocs(hits: DocSearchHit[], f: DocFilters): DocSearchHit[] {
  if (!f.team && !f.category && !f.confidentiality) return hits
  return hits.filter((h) => {
    if (f.team && h.team !== f.team) return false
    if (f.category && h.category !== f.category) return false
    if (f.confidentiality && h.confidentiality !== f.confidentiality) return false
    return true
  })
}

function FilterChipRow({
  hits,
  filters,
  onChange,
}: {
  hits: DocSearchHit[]
  filters: DocFilters
  onChange: (f: DocFilters) => void
}) {
  const teams = uniqueDefined(hits.map((h) => h.team))
  const categories = uniqueDefined(hits.map((h) => h.category))
  const confs = uniqueDefined(hits.map((h) => h.confidentiality)) as DocFilters['confidentiality'][]
  if (teams.length === 0 && categories.length === 0 && confs.length === 0) return null
  const hasAny = filters.team || filters.category || filters.confidentiality
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-gray-100 bg-white px-3 py-2">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">필터</span>
      {teams.length > 0 && (
        <Dropdown
          label="팀"
          value={filters.team}
          options={teams}
          onChange={(v) => onChange({ ...filters, team: v })}
        />
      )}
      {categories.length > 0 && (
        <Dropdown
          label="카테고리"
          value={filters.category}
          options={categories}
          onChange={(v) => onChange({ ...filters, category: v })}
        />
      )}
      {confs.length > 0 && (
        <Dropdown
          label="기밀도"
          value={filters.confidentiality}
          options={confs as string[]}
          onChange={(v) =>
            onChange({
              ...filters,
              confidentiality: (v as DocFilters['confidentiality']) ?? null,
            })
          }
          renderOption={confidentialityLabel}
        />
      )}
      {hasAny && (
        <button
          type="button"
          onClick={() => onChange(EMPTY_FILTERS)}
          className="ml-auto rounded-full px-2 py-0.5 text-[11px] font-medium text-smsg-700 hover:bg-smsg-50"
        >
          필터 초기화
        </button>
      )}
    </div>
  )
}

function uniqueDefined<T>(arr: (T | undefined | null)[]): T[] {
  const out = new Set<T>()
  for (const v of arr) if (v != null) out.add(v as T)
  return Array.from(out).sort()
}

function confidentialityLabel(v: string): string {
  if (v === 'public') return '공개'
  if (v === 'internal') return '사내'
  if (v === 'restricted') return '제한'
  return v
}

function Dropdown({
  label,
  value,
  options,
  onChange,
  renderOption,
}: {
  label: string
  value: string | null | undefined
  options: string[]
  onChange: (v: string | null) => void
  renderOption?: (v: string) => string
}) {
  const display = value ? `${label}: ${renderOption ? renderOption(value) : value}` : label
  return (
    <label className="relative inline-flex">
      <span className="sr-only">{label}</span>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        className={cn(
          'appearance-none rounded-full border px-2.5 py-0.5 pr-6 text-[11px] font-medium transition-colors',
          value
            ? 'border-smsg-700 bg-smsg-700 text-white'
            : 'border-gray-300 bg-white text-gray-700 hover:border-smsg-300',
        )}
      >
        <option value="">{label}: 전체</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {renderOption ? renderOption(o) : o}
          </option>
        ))}
      </select>
      <span aria-hidden="true" className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 text-[10px]">
        {display ? '▾' : '▾'}
      </span>
    </label>
  )
}

function DocResults({
  q,
  grouped,
  loading,
  recent,
  onUseRecent,
  onRemoveRecent,
  onClearRecent,
  onPick,
  onGraph,
  activeIdx,
  onActivate,
  listboxId,
  optionId,
}: {
  q: string
  grouped: GroupedDocs
  loading: boolean
  recent: RecentSearchItem[]
  onUseRecent: (s: string) => void
  onRemoveRecent: (s: string) => void
  onClearRecent: () => void
  onPick: (hit: DocSearchHit, newTab: boolean) => void
  onGraph: (hit: DocSearchHit) => void
  activeIdx: number
  onActivate: (i: number) => void
  listboxId: string
  optionId: (i: number) => string
}) {
  if (!q.trim()) {
    return (
      <div className="text-xs text-gray-500">
        {recent.length > 0 ? (
          <>
            <div className="mb-1 flex items-center justify-between px-2 pt-1">
              <p className="font-semibold uppercase tracking-wide">최근 검색</p>
              <button
                type="button"
                onClick={onClearRecent}
                className="rounded px-1.5 py-0.5 text-[11px] font-medium text-smsg-700 hover:bg-smsg-50"
              >
                전체 지우기
              </button>
            </div>
            <ul>
              {recent.slice(0, 8).map((s) => (
                <li key={s.q} className="flex items-center gap-1">
                  <button
                    onClick={() => onUseRecent(s.q)}
                    className="flex flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-gray-700 hover:bg-smsg-50"
                  >
                    <HistoryIcon />
                    <span className="truncate">{s.q}</span>
                    {s.ts > 0 && (
                      <time className="ml-auto text-[10px] text-gray-400">{formatRelativeShort(s.ts)}</time>
                    )}
                  </button>
                  <button
                    type="button"
                    aria-label={`${s.q} 기록 지우기`}
                    onClick={() => onRemoveRecent(s.q)}
                    className="mr-1 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-red-600"
                  >
                    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <path d="M3.7 3.7l8.6 8.6M12.3 3.7l-8.6 8.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="px-2 py-6 text-center text-xs text-gray-400">검색어를 입력하세요.</p>
        )}
      </div>
    )
  }
  const total = grouped.title.length + grouped.body.length + grouped.tag.length
  if (loading && total === 0) {
    return <p className="px-2 py-4 text-center text-xs text-gray-500">검색 중…</p>
  }
  if (total === 0) {
    return <p className="px-2 py-6 text-center text-xs text-gray-400">결과 없음</p>
  }

  let cursor = 0
  const renderGroup = (label: string, list: DocSearchHit[]) => {
    if (list.length === 0) return null
    const node = (
      <section key={label}>
        <p className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
          {label}
        </p>
        <ul role="listbox" id={cursor === 0 ? listboxId : undefined} aria-label={label}>
          {list.map((hit) => {
            const i = cursor++
            const active = i === activeIdx
            return (
              <li key={hit.slug + i} className={cn(
                'group flex items-stretch rounded-md transition-colors',
                active ? 'bg-smsg-100' : 'hover:bg-smsg-50',
              )}>
                <button
                  type="button"
                  role="option"
                  id={optionId(i)}
                  aria-selected={active}
                  onMouseEnter={() => onActivate(i)}
                  onClick={(e) => onPick(hit, e.metaKey || e.ctrlKey)}
                  className="flex flex-1 items-start gap-2.5 rounded-md px-2 py-2 text-left"
                >
                  <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md bg-smsg-50">
                    <DocIcon />
                  </span>
                  <div className="min-w-0 flex-1">
                    <span
                      className="block truncate text-sm font-semibold text-smsg-900"
                      dangerouslySetInnerHTML={{ __html: sanitizeHighlight(hit._formatted?.title ?? hit.title) }}
                    />
                    {(hit._formatted?.summary || hit._formatted?.text || hit.snippet || hit.summary) && (
                      <span
                        className="mt-0.5 block truncate text-xs text-gray-600"
                        dangerouslySetInnerHTML={{
                          __html: sanitizeHighlight(
                            hit._formatted?.summary ?? hit._formatted?.text ?? hit.snippet ?? hit.summary ?? '',
                          ),
                        }}
                      />
                    )}
                    <span className="mt-0.5 block truncate font-mono text-[10px] text-gray-400">/{hit.slug}</span>
                  </div>
                </button>
                {/* 그래프로 보기 — active row 또는 hover 시 보이는 보조 액션 */}
                <button
                  type="button"
                  aria-label={`${hit.title} — 위키 그래프로 보기`}
                  title="위키 그래프로 보기"
                  onClick={(e) => {
                    e.stopPropagation()
                    onGraph(hit)
                  }}
                  className={cn(
                    'flex shrink-0 items-center gap-1 px-2 text-xs text-gray-500 hover:text-smsg-700',
                    active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                  )}
                >
                  <GraphIcon /> 그래프
                </button>
              </li>
            )
          })}
        </ul>
      </section>
    )
    return node
  }

  return (
    <div>
      {renderGroup('제목 매칭', grouped.title)}
      {renderGroup('본문 매칭', grouped.body)}
      {renderGroup('태그 매칭', grouped.tag)}
    </div>
  )
}

function TagResults({
  items,
  activeIdx,
  onActivate,
  onPick,
  listboxId,
  optionId,
}: {
  items: { tag: string; count: number }[]
  activeIdx: number
  onActivate: (i: number) => void
  onPick: (t: { tag: string; count: number }) => void
  listboxId: string
  optionId: (i: number) => string
}) {
  if (items.length === 0) {
    return <p className="px-2 py-6 text-center text-xs text-gray-400">태그 없음</p>
  }
  return (
    <ul role="listbox" id={listboxId} aria-label="태그 결과" className="space-y-1">
      {items.slice(0, 5).map((t, i) => {
        const active = i === activeIdx
        return (
          <li key={t.tag}>
            <button
              type="button"
              role="option"
              id={optionId(i)}
              aria-selected={active}
              onMouseEnter={() => onActivate(i)}
              onClick={() => onPick(t)}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors',
                active ? 'bg-smsg-100' : 'hover:bg-smsg-50',
              )}
            >
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-smsg-50 text-smsg-700">#</span>
              <span className="flex-1 truncate text-sm font-semibold text-smsg-900">#{t.tag}</span>
              {typeof t.count === 'number' && t.count > 0 && (
                <span className="text-[11px] text-gray-400">{t.count}건</span>
              )}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function PeopleResults({
  items,
  activeIdx,
  onActivate,
  onPick,
  listboxId,
  optionId,
}: {
  items: { id: string; label: string; email?: string }[]
  activeIdx: number
  onActivate: (i: number) => void
  onPick: (p: { id: string; label: string }) => void
  listboxId: string
  optionId: (i: number) => string
}) {
  if (items.length === 0) {
    return <p className="px-2 py-6 text-center text-xs text-gray-400">사람 없음</p>
  }
  return (
    <ul role="listbox" id={listboxId} aria-label="사람 결과" className="space-y-1">
      {items.slice(0, 5).map((p, i) => {
        const active = i === activeIdx
        return (
          <li key={p.id}>
            <button
              type="button"
              role="option"
              id={optionId(i)}
              aria-selected={active}
              onMouseEnter={() => onActivate(i)}
              onClick={() => onPick(p)}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors',
                active ? 'bg-smsg-100' : 'hover:bg-smsg-50',
              )}
            >
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-smsg-50 text-smsg-700">@</span>
              <div className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-smsg-900">{p.label}</span>
                {p.email && <span className="block truncate text-xs text-gray-500">{p.email}</span>}
              </div>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function WidgetResults({
  items,
  activeIdx,
  onActivate,
  listboxId,
  optionId,
}: {
  items: WidgetRegistryEntry[]
  activeIdx: number
  onActivate: (i: number) => void
  listboxId: string
  optionId: (i: number) => string
}) {
  if (items.length === 0) {
    return <p className="px-2 py-6 text-center text-xs text-gray-400">위젯 없음</p>
  }
  return (
    <ul role="listbox" id={listboxId} aria-label="위젯 결과" className="space-y-1">
      {items.map((w, i) => {
        const active = i === activeIdx
        return (
          <li
            key={w.type}
            role="option"
            id={optionId(i)}
            aria-selected={active}
            onMouseEnter={() => onActivate(i)}
            className={cn(
              'flex items-start gap-2.5 rounded-md px-2 py-2 transition-colors',
              active ? 'bg-smsg-100' : 'hover:bg-smsg-50',
            )}
          >
            <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md bg-smsg-50">
              <WidgetIcon />
            </span>
            <div className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-smsg-900">{w.name}</span>
              {w.description && (
                <span className="mt-0.5 block truncate text-xs text-gray-600">{w.description}</span>
              )}
              <span className="mt-0.5 block truncate font-mono text-[10px] text-gray-400">{w.type}</span>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

interface CommandRunCtx {
  navigate: (to: string) => void
  openShortcuts: () => void
}

interface CommandItem {
  id: string
  label: string
  hint?: string
  icon: string
  run: (ctx: CommandRunCtx) => void
}

function buildCommands({ canAdmin, location }: { canAdmin: boolean; location: string }): CommandItem[] {
  const list: CommandItem[] = [
    {
      id: 'new-doc',
      label: '+ 새 문서',
      hint: '새로운 백서를 작성합니다',
      icon: '+',
      run: ({ navigate }) => navigate('/docs/new'),
    },
    {
      id: 'settings',
      label: '환경설정',
      hint: '계정 및 표시 설정',
      icon: '⚙',
      run: ({ navigate }) => navigate('/settings'),
    },
    {
      id: 'shortcuts',
      label: '도움말 / 단축키',
      hint: 'Cmd+? 로도 열 수 있습니다',
      icon: '?',
      run: ({ openShortcuts }) => openShortcuts(),
    },
    {
      id: 'present',
      label: '프레젠테이션 모드',
      hint: location.startsWith('/docs/') ? '현재 문서를 슬라이드로 봅니다' : '프레젠테이션 페이지로 이동',
      icon: '▶',
      run: ({ navigate }) => {
        const m = location.match(/^\/docs\/([^/]+)/)
        if (m && m[1]) navigate(`/present/${m[1]}`)
        else navigate('/recent')
      },
    },
    {
      id: 'fullscreen',
      label: '전체 화면',
      hint: 'F11 와 동일한 효과',
      icon: '⛶',
      run: () => {
        try {
          if (document.fullscreenElement) {
            void document.exitFullscreen()
          } else {
            void document.documentElement.requestFullscreen()
          }
        } catch {
          /* ignore */
        }
      },
    },
    {
      id: 'theme',
      label: '테마 전환',
      hint: '라이트 / 다크 (시각적 토글)',
      icon: '◑',
      run: () => {
        try {
          const root = document.documentElement
          root.classList.toggle('dark')
        } catch {
          /* ignore */
        }
      },
    },
  ]
  if (canAdmin) {
    list.splice(1, 0, {
      id: 'admin-orgs',
      label: '조직 관리',
      hint: '관리자 전용',
      icon: '⚙',
      run: ({ navigate }) => navigate('/admin/orgs'),
    })
  }
  return list
}

function CommandResults({
  items,
  onRun,
  activeIdx,
  onActivate,
  listboxId,
  optionId,
}: {
  items: CommandItem[]
  onRun: (cmd: CommandItem) => void
  activeIdx: number
  onActivate: (i: number) => void
  listboxId: string
  optionId: (i: number) => string
}) {
  if (items.length === 0) {
    return <p className="px-2 py-6 text-center text-xs text-gray-400">명령 없음</p>
  }
  return (
    <ul role="listbox" id={listboxId} aria-label="명령 결과" className="space-y-1">
      {items.map((c, i) => {
        const active = i === activeIdx
        return (
          <li key={c.id}>
            <button
              type="button"
              role="option"
              id={optionId(i)}
              aria-selected={active}
              onMouseEnter={() => onActivate(i)}
              onClick={() => onRun(c)}
              className={cn(
                'flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left transition-colors',
                active ? 'bg-smsg-100' : 'hover:bg-smsg-50',
              )}
            >
              <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md bg-smsg-50 text-sm font-bold text-smsg-700">
                {c.icon}
              </span>
              <div className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-smsg-900">{c.label}</span>
                {c.hint && <span className="mt-0.5 block truncate text-xs text-gray-600">{c.hint}</span>}
              </div>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function formatRelativeShort(ts: number, now: number = Date.now()): string {
  if (!Number.isFinite(ts) || ts <= 0) return ''
  const diff = Math.max(0, now - ts)
  const min = 60_000
  const hour = 60 * min
  const day = 24 * hour
  if (diff < min) return '방금'
  if (diff < hour) return `${Math.floor(diff / min)}분 전`
  if (diff < day) return `${Math.floor(diff / hour)}시간 전`
  if (diff < 7 * day) return `${Math.floor(diff / day)}일 전`
  try {
    return new Date(ts).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })
  } catch {
    return ''
  }
}

/**
 * Allow only `<em>`/`</em>` and `<mark>`/`</mark>` in highlight strings.
 * (BE 의 meili 설정은 `highlightPreTag=<mark>` 이지만, 과거 응답이나 fallback
 * 데이터에서 `<em>` 이 섞여올 수 있어 둘 다 허용.) 나머지는 모두 escape.
 */
function sanitizeHighlight(input: string): string {
  if (!input) return ''
  const escaped = input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
  return escaped
    .replace(/&lt;em&gt;/g, '<em class="bg-smsg-100 not-italic font-semibold">')
    .replace(/&lt;\/em&gt;/g, '</em>')
    .replace(/&lt;mark&gt;/g, '<mark class="bg-smsg-100 not-italic font-semibold rounded-sm px-0.5">')
    .replace(/&lt;\/mark&gt;/g, '</mark>')
}
