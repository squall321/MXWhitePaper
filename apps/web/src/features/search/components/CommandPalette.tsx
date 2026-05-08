import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  useDocumentSearch,
  useRecentSearches,
  useWidgetRegistry,
} from '../hooks/useSearch'
import type { DocSearchHit, WidgetRegistryEntry } from '../api'
import { cn } from '@/components/ui/cn'

interface CommandPaletteProps {
  open: boolean
  onClose: () => void
  /** Optional initial query (e.g., when launched from the top-bar input). */
  initialQuery?: string
}

type Tab = 'docs' | 'widgets'

/**
 * ⌘K command palette — keyboard-first, Mac-style. Two tabs:
 *   - 문서: full-text search via `/search`, debounced 200ms
 *   - 위젯: lists `/widgets/registry`, filtered client-side by name+desc
 *
 * ESC closes. Click on a hit navigates to /docs/<slug>.
 */
export function CommandPalette({ open, onClose, initialQuery = '' }: CommandPaletteProps) {
  const [tab, setTab] = useState<Tab>('docs')
  const [q, setQ] = useState(initialQuery)
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const recent = useRecentSearches()

  const { data: docHits = [], isFetching: docsFetching } = useDocumentSearch(q)
  const { data: widgetList = [] } = useWidgetRegistry()

  const widgetMatches = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return widgetList
    return widgetList.filter(
      (w) =>
        w.name.toLowerCase().includes(needle) ||
        w.type.toLowerCase().includes(needle) ||
        (w.description ?? '').toLowerCase().includes(needle),
    )
  }, [widgetList, q])

  // Reset on open.
  useEffect(() => {
    if (open) {
      setQ(initialQuery)
      setTab('docs')
      const t = window.setTimeout(() => inputRef.current?.focus(), 0)
      return () => window.clearTimeout(t)
    }
  }, [open, initialQuery])

  // ESC + click-outside.
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

  if (!open) return null

  const goDoc = (hit: DocSearchHit) => {
    recent.push(q)
    onClose()
    navigate(`/docs/${encodeURIComponent(hit.slug)}`)
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="명령 팔레트"
      className="fixed inset-0 z-modal flex items-start justify-center bg-black/40 px-4 pt-[10vh] anim-fade backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-xl overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg animate-slide-up">
        <div className="flex items-center gap-2 border-b border-gray-200 px-3 py-3">
          <SearchIcon className="text-gray-400" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="문서, 위젯, 명령어를 검색하세요..."
            className="min-w-0 flex-1 bg-transparent px-1 py-1 text-base text-gray-900 placeholder-gray-400 outline-none"
          />
          <kbd className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">
            Esc
          </kbd>
        </div>

        <div className="flex border-b border-gray-200 text-xs">
          <TabBtn active={tab === 'docs'} onClick={() => setTab('docs')} label="문서" count={docHits.length} />
          <TabBtn active={tab === 'widgets'} onClick={() => setTab('widgets')} label="위젯" count={widgetMatches.length} />
        </div>

        <div className="max-h-80 overflow-y-auto p-2">
          {tab === 'docs' ? (
            <DocResults
              q={q}
              hits={docHits}
              loading={docsFetching}
              recent={recent.items}
              onUseRecent={(s) => setQ(s)}
              onPick={goDoc}
            />
          ) : (
            <WidgetResults items={widgetMatches} />
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-gray-200 bg-gray-50 px-3 py-2 text-[11px] text-gray-500">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1"><Hint>↑↓</Hint> 이동</span>
            <span className="flex items-center gap-1"><Hint>Enter</Hint> 선택</span>
            <span className="flex items-center gap-1"><Hint>Esc</Hint> 닫기</span>
          </div>
          <span className="hidden sm:inline">MX White Paper</span>
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

function TabBtn({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count?: number }) {
  return (
    <button
      type="button"
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
        <span className={cn(
          'rounded-full px-1.5 py-px text-[10px] font-medium',
          active ? 'bg-smsg-700 text-white' : 'bg-gray-100 text-gray-500',
        )}>
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

function DocResults({
  q,
  hits,
  loading,
  recent,
  onUseRecent,
  onPick,
}: {
  q: string
  hits: DocSearchHit[]
  loading: boolean
  recent: string[]
  onUseRecent: (s: string) => void
  onPick: (hit: DocSearchHit) => void
}) {
  if (!q.trim()) {
    return (
      <div className="text-xs text-gray-500">
        {recent.length > 0 ? (
          <>
            <p className="mb-1 px-2 pt-1 font-semibold uppercase tracking-wide">최근 검색</p>
            <ul>
              {recent.map((s) => (
                <li key={s}>
                  <button
                    onClick={() => onUseRecent(s)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-gray-700 hover:bg-smsg-50"
                  >
                    <HistoryIcon />
                    <span className="truncate">{s}</span>
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
  if (loading && hits.length === 0) {
    return <p className="px-2 py-4 text-center text-xs text-gray-500">검색 중…</p>
  }
  if (hits.length === 0) {
    return <p className="px-2 py-6 text-center text-xs text-gray-400">결과 없음</p>
  }
  return (
    <ul className="space-y-1">
      {hits.map((hit) => (
        <li key={hit.slug}>
          <button
            onClick={() => onPick(hit)}
            className="flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-smsg-50"
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
            <kbd className="ml-2 mt-1 hidden rounded border border-gray-200 bg-white px-1 py-0.5 font-mono text-[10px] font-medium text-gray-500 group-hover:inline-block">
              ↵
            </kbd>
          </button>
        </li>
      ))}
    </ul>
  )
}

function WidgetResults({ items }: { items: WidgetRegistryEntry[] }) {
  if (items.length === 0) {
    return <p className="px-2 py-6 text-center text-xs text-gray-400">위젯 없음</p>
  }
  return (
    <ul className="space-y-1">
      {items.map((w) => (
        <li
          key={w.type}
          className="flex items-start gap-2.5 rounded-md px-2 py-2 transition-colors hover:bg-smsg-50"
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
      ))}
    </ul>
  )
}

/**
 * Allow only `<em>` and `</em>` in highlight strings (MeiliSearch-style).
 * Everything else is HTML-escaped.
 */
function sanitizeHighlight(input: string): string {
  if (!input) return ''
  const escaped = input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
  return escaped
    .replace(/&lt;em&gt;/g, '<em class="bg-yellow-100 not-italic font-semibold">')
    .replace(/&lt;\/em&gt;/g, '</em>')
}
