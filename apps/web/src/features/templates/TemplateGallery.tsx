import { useEffect, useState } from 'react'
import {
  TEMPLATES,
  TEMPLATE_CATEGORY_LABELS,
  type TemplateCategory,
  type TemplateDef,
} from './templates'
import {
  listServerTemplates,
  type ServerTemplateSummary,
} from './serverApi'

interface Props {
  onPick: (tpl: TemplateDef) => void
  /** Highlight the currently-selected template id. */
  selectedId?: string
  /** Optional: server-template picker. If omitted, the "조직 템플릿" tab is
   *  hidden — the gallery is also rendered in contexts that don't yet handle
   *  server templates (e.g. legacy callers). */
  onPickServer?: (t: ServerTemplateSummary) => void
}

type Filter = TemplateCategory | 'all'
type Source = 'builtin' | 'server'

/**
 * Visual grid (3-col on desktop, 1-col on mobile) of available templates.
 *
 * Cycle 7 shipped 14 hard-coded templates exposed via `TEMPLATES`. Cycle 0020
 * adds an opt-in "조직 템플릿" tab that fetches `/doc-templates` and renders
 * a parallel grid of server-published templates. The two sources live in the
 * same `<Card>` so users don't need to navigate away to compare.
 *
 * A category filter row lets the user narrow by bucket (전체 / 보고서 / 협업
 * / 기술 문서 / 공지). Filter is local state — it doesn't persist across
 * navigations on purpose, since the gallery is shown on the "+ 새 문서"
 * entry point only.
 */
export function TemplateGallery({ onPick, selectedId, onPickServer }: Props) {
  const [filter, setFilter] = useState<Filter>('all')
  const [source, setSource] = useState<Source>('builtin')
  const [serverItems, setServerItems] = useState<ServerTemplateSummary[]>([])
  const [serverLoading, setServerLoading] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  useEffect(() => {
    if (!onPickServer) return
    let cancelled = false
    setServerLoading(true)
    setServerError(null)
    listServerTemplates({ limit: 200 })
      .then((items) => {
        if (!cancelled) setServerItems(items)
      })
      .catch((e: unknown) => {
        if (!cancelled) setServerError((e as Error).message)
      })
      .finally(() => {
        if (!cancelled) setServerLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [onPickServer])

  const visibleBuiltin =
    filter === 'all' ? TEMPLATES : TEMPLATES.filter((t) => t.category === filter)
  const visibleServer =
    filter === 'all'
      ? serverItems
      : serverItems.filter((t) => t.category === filter)

  return (
    <div className="flex flex-col gap-3">
      {onPickServer && (
        <div
          role="tablist"
          aria-label="템플릿 출처"
          data-testid="template-source-tabs"
          className="flex gap-1 border-b border-gray-200 dark:border-gray-700"
        >
          <SourceTab
            active={source === 'builtin'}
            onClick={() => setSource('builtin')}
          >
            내장 템플릿
          </SourceTab>
          <SourceTab
            active={source === 'server'}
            onClick={() => setSource('server')}
          >
            조직 템플릿{serverItems.length > 0 ? ` (${serverItems.length})` : ''}
          </SourceTab>
        </div>
      )}

      <div
        role="tablist"
        aria-label="템플릿 카테고리"
        data-testid="template-category-filter"
        className="flex flex-wrap gap-1.5"
      >
        {TEMPLATE_CATEGORY_LABELS.map((cat) => {
          const active = filter === cat.value
          return (
            <button
              key={cat.value}
              type="button"
              role="tab"
              aria-selected={active}
              data-category={cat.value}
              onClick={() => setFilter(cat.value)}
              className={
                'rounded-full border px-3 py-1 text-xs font-medium transition-colors ' +
                (active
                  ? 'border-smsg-500 bg-smsg-500 text-white'
                  : 'border-gray-200 bg-white text-gray-700 hover:border-smsg-300 hover:bg-smsg-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800')
              }
            >
              {cat.label}
            </button>
          )
        })}
      </div>

      {source === 'builtin' && (
        <div
          role="list"
          aria-label="문서 템플릿"
          data-testid="template-gallery"
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
        >
          {visibleBuiltin.map((tpl) => {
            const selected = selectedId === tpl.id
            return (
              <button
                key={tpl.id}
                type="button"
                role="listitem"
                data-template-id={tpl.id}
                aria-pressed={selected}
                onClick={() => onPick(tpl)}
                className={
                  'flex flex-col items-start gap-2 rounded-lg border p-3 text-left transition-colors ' +
                  (selected
                    ? 'border-smsg-500 bg-smsg-50 dark:bg-gray-800'
                    : 'border-gray-200 bg-white hover:border-smsg-300 hover:bg-smsg-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:bg-gray-800')
                }
              >
                <div
                  aria-hidden="true"
                  className="flex h-10 w-full items-center justify-center gap-1 rounded-md bg-gray-50 text-base dark:bg-gray-800"
                >
                  {tpl.thumbnailIcons.map((ic, i) => (
                    <span key={i} className="px-1">{ic}</span>
                  ))}
                </div>
                <p className="text-sm font-semibold text-smsg-900 dark:text-gray-100">
                  {tpl.title}
                </p>
                <p className="text-[12px] leading-snug text-gray-600 dark:text-gray-400">
                  {tpl.description}
                </p>
              </button>
            )
          })}
        </div>
      )}

      {source === 'server' && onPickServer && (
        <div
          role="list"
          aria-label="조직 템플릿"
          data-testid="template-gallery-server"
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
        >
          {serverLoading && (
            <p className="col-span-full text-center text-xs text-gray-500">
              불러오는 중…
            </p>
          )}
          {serverError && (
            <p className="col-span-full text-center text-xs text-red-600">
              로드 실패: {serverError}
            </p>
          )}
          {!serverLoading && !serverError && visibleServer.length === 0 && (
            <p className="col-span-full text-center text-xs text-gray-500">
              아직 발행된 조직 템플릿이 없습니다.
            </p>
          )}
          {visibleServer.map((tpl) => (
            <button
              key={tpl.id}
              type="button"
              role="listitem"
              data-template-slug={tpl.slug}
              onClick={() => onPickServer(tpl)}
              className="flex flex-col items-start gap-2 rounded-lg border border-gray-200 bg-white p-3 text-left transition-colors hover:border-smsg-300 hover:bg-smsg-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:bg-gray-800"
            >
              <div className="flex w-full items-center justify-between gap-2">
                <p className="truncate text-sm font-semibold text-smsg-900 dark:text-gray-100">
                  {tpl.title}
                </p>
                <span
                  data-testid="template-scope-badge"
                  className={
                    'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ' +
                    (tpl.scope === 'org'
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                      : tpl.scope === 'team'
                      ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                      : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400')
                  }
                >
                  {tpl.scope}
                </span>
              </div>
              {tpl.description && (
                <p className="text-[12px] leading-snug text-gray-600 dark:text-gray-400">
                  {tpl.description}
                </p>
              )}
              <div className="flex w-full items-center justify-between text-[11px] text-gray-500 dark:text-gray-400">
                <span>by {tpl.author_name ?? '—'}</span>
                <span>used {tpl.use_count}×</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function SourceTab({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={
        'border-b-2 px-3 py-1.5 text-xs font-medium transition-colors ' +
        (active
          ? 'border-smsg-500 text-smsg-900 dark:text-gray-100'
          : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300')
      }
    >
      {children}
    </button>
  )
}
