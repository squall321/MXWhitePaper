import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  deleteServerTemplate,
  getServerTemplate,
  listServerTemplates,
  patchServerTemplate,
  type ServerTemplate,
  type ServerTemplateScope,
  type ServerTemplateSummary,
} from '@/features/templates/serverApi'

/**
 * `/admin/templates` — server template manager (cycle 0020).
 *
 * Mirrors the SnippetManager UX: a single-column list of templates with
 * inline rename, scope cycle (private → team → org → private), preview
 * (modal showing section JSON), and delete-with-confirm. Loaded as a tab
 * inside `AdminDashboard` so admins don't have to bounce between pages,
 * but also reachable directly via `/admin/templates`.
 *
 * Permissions: admin route guard is applied at AdminDashboard level. When
 * embedded standalone we trust the BE — owner/admin checks happen on the
 * mutation calls.
 */
type ScopeFilter = 'all' | ServerTemplateScope

const SCOPE_LABEL: Record<ServerTemplateScope, string> = {
  private: '나만',
  team: '팀',
  org: '조직',
}

const NEXT_SCOPE: Record<ServerTemplateScope, ServerTemplateScope> = {
  private: 'team',
  team: 'org',
  org: 'private',
}

export function TemplateManagerPage() {
  const [items, setItems] = useState<ServerTemplateSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>('all')
  const [editing, setEditing] = useState<{ slug: string; value: string } | null>(
    null,
  )
  const [deleting, setDeleting] = useState<ServerTemplateSummary | null>(null)
  const [viewing, setViewing] = useState<ServerTemplate | null>(null)
  const [busySlug, setBusySlug] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const opts = scopeFilter === 'all' ? {} : { scope: scopeFilter }
      setItems(await listServerTemplates(opts))
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [scopeFilter])

  useEffect(() => {
    void reload()
  }, [reload])

  const sorted = useMemo(
    () =>
      [...items].sort((a, b) => {
        const av = a.use_count ?? 0
        const bv = b.use_count ?? 0
        if (av !== bv) return bv - av
        return (b.updated_at ?? '').localeCompare(a.updated_at ?? '')
      }),
    [items],
  )

  const onRename = async (slug: string, nextTitle: string) => {
    setBusySlug(slug)
    try {
      await patchServerTemplate(slug, { title: nextTitle })
      setEditing(null)
      await reload()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusySlug(null)
    }
  }

  const onCycleScope = async (it: ServerTemplateSummary) => {
    setBusySlug(it.slug)
    try {
      await patchServerTemplate(it.slug, { scope: NEXT_SCOPE[it.scope] })
      await reload()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusySlug(null)
    }
  }

  const onDelete = async () => {
    if (!deleting) return
    setBusySlug(deleting.slug)
    try {
      await deleteServerTemplate(deleting.slug)
      setDeleting(null)
      await reload()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusySlug(null)
    }
  }

  const onPreview = async (slug: string) => {
    try {
      setViewing(await getServerTemplate(slug))
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  return (
    <div
      className="mx-auto max-w-5xl px-4 py-6"
      data-testid="template-manager-page"
    >
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-smsg-900 dark:text-gray-100">
            조직 템플릿 관리
          </h1>
          <p className="mt-1 text-xs text-gray-500">
            서버측에 발행된 문서 템플릿입니다. 이름 변경 / 공유 범위 / 미리
            보기 / 삭제가 가능합니다.
          </p>
        </div>
      </header>

      <div
        role="tablist"
        aria-label="공유 범위 필터"
        className="mb-4 flex flex-wrap gap-1.5"
      >
        {(['all', 'private', 'team', 'org'] as const).map((sf) => (
          <button
            key={sf}
            type="button"
            role="tab"
            aria-selected={scopeFilter === sf}
            data-testid={`template-scope-filter-${sf}`}
            onClick={() => setScopeFilter(sf)}
            className={
              'rounded-full border px-3 py-1 text-xs font-medium transition-colors ' +
              (scopeFilter === sf
                ? 'border-smsg-500 bg-smsg-500 text-white'
                : 'border-gray-200 bg-white text-gray-700 hover:border-smsg-300 hover:bg-smsg-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300')
            }
          >
            {sf === 'all' ? '전체' : SCOPE_LABEL[sf]}
          </button>
        ))}
      </div>

      {loading && (
        <p role="status" className="text-sm text-gray-500">
          불러오는 중…
        </p>
      )}
      {err && (
        <p role="alert" className="text-sm text-red-600">
          {err}
        </p>
      )}

      <ul
        className="divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white dark:divide-gray-800 dark:border-gray-700 dark:bg-gray-900"
        data-testid="template-manager-list"
      >
        {sorted.map((it) => (
          <li
            key={it.id}
            className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between"
            data-testid={`template-row-${it.slug}`}
          >
            <div className="min-w-0 flex-1">
              {editing?.slug === it.slug ? (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={editing.value}
                    onChange={(e) =>
                      setEditing({ slug: it.slug, value: e.target.value })
                    }
                    className="w-full rounded border border-gray-300 px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-950"
                    data-testid={`template-rename-input-${it.slug}`}
                  />
                  <button
                    type="button"
                    className="rounded bg-smsg-500 px-2 py-1 text-xs text-white"
                    disabled={busySlug === it.slug}
                    onClick={() => void onRename(it.slug, editing.value)}
                    data-testid={`template-rename-save-${it.slug}`}
                  >
                    저장
                  </button>
                  <button
                    type="button"
                    className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600"
                    onClick={() => setEditing(null)}
                  >
                    취소
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-semibold text-smsg-900 dark:text-gray-100">
                    {it.title}
                  </span>
                  <span
                    className={
                      'rounded-full px-2 py-0.5 text-[11px] font-medium ' +
                      (it.scope === 'org'
                        ? 'bg-emerald-100 text-emerald-700'
                        : it.scope === 'team'
                        ? 'bg-blue-100 text-blue-700'
                        : 'bg-gray-100 text-gray-600')
                    }
                  >
                    {SCOPE_LABEL[it.scope]}
                  </span>
                  <span className="text-[11px] text-gray-500">
                    /{it.slug} · {it.section_count}섹션 · used {it.use_count}×
                  </span>
                </div>
              )}
              {it.description && !editing && (
                <p className="mt-1 text-[12px] text-gray-500">
                  {it.description}
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                onClick={() => void onPreview(it.slug)}
                data-testid={`template-preview-${it.slug}`}
              >
                미리보기
              </button>
              <button
                type="button"
                className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                onClick={() =>
                  setEditing({ slug: it.slug, value: it.title })
                }
                data-testid={`template-rename-${it.slug}`}
              >
                이름 변경
              </button>
              <button
                type="button"
                className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                onClick={() => void onCycleScope(it)}
                data-testid={`template-scope-toggle-${it.slug}`}
              >
                공유 범위 변경
              </button>
              <button
                type="button"
                className="rounded border border-red-200 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                onClick={() => setDeleting(it)}
                data-testid={`template-delete-${it.slug}`}
              >
                삭제
              </button>
            </div>
          </li>
        ))}
        {!loading && sorted.length === 0 && (
          <li className="p-6 text-center text-sm text-gray-500">
            발행된 템플릿이 없습니다.
          </li>
        )}
      </ul>

      {deleting && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setDeleting(null)}
        >
          <div
            className="w-full max-w-sm space-y-3 rounded-lg bg-white p-4 dark:bg-gray-900"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold text-smsg-900 dark:text-gray-100">
              템플릿 삭제
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              <strong>{deleting.title}</strong> 을(를) 삭제할까요? 되돌릴 수
              없습니다.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="rounded border border-gray-300 px-3 py-1 text-sm"
                onClick={() => setDeleting(null)}
              >
                취소
              </button>
              <button
                type="button"
                className="rounded bg-red-600 px-3 py-1 text-sm text-white"
                disabled={busySlug === deleting.slug}
                onClick={() => void onDelete()}
                data-testid="template-delete-confirm"
              >
                삭제
              </button>
            </div>
          </div>
        </div>
      )}

      {viewing && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setViewing(null)}
        >
          <div
            className="max-h-[80vh] w-full max-w-2xl overflow-hidden rounded-lg bg-white shadow-xl dark:bg-gray-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-gray-200 p-3 dark:border-gray-700">
              <h2 className="font-semibold">{viewing.title}</h2>
              <button
                type="button"
                onClick={() => setViewing(null)}
                aria-label="닫기"
                className="rounded px-2 py-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                ✕
              </button>
            </div>
            <pre
              className="max-h-[70vh] overflow-auto bg-gray-50 p-3 text-[11px] text-gray-700 dark:bg-gray-950 dark:text-gray-300"
              data-testid="template-preview-json"
            >
              {JSON.stringify(viewing.sections, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}
