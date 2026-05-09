import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  deleteSnippet,
  getSnippet,
  listSnippets,
  patchSnippet,
  type Snippet,
  type SnippetScope,
  type SnippetSummary,
} from '@/features/block-library/api'

/**
 * `/snippets` — 사용자 스니펫 관리.
 *
 * 3-col grid 로 본인 + 공유받은 스니펫을 표시한다. 카드별 액션:
 *   - rename — 이름 인라인 편집 + 저장.
 *   - delete — 확인 후 DELETE.
 *   - share  — scope 토글 (private → team → org → private).
 *   - view-content — 모달 펼쳐 blocks JSON 미리보기.
 *
 * 필터 / 정렬:
 *   - scope 필터 (전체 / 내 것 / 팀 / 조직).
 *   - 정렬 (use_count desc — popular / updated_at desc — recent).
 */
type ScopeFilter = 'all' | SnippetScope
type SortKey = 'use_count' | 'updated_at'

const SCOPE_LABEL: Record<SnippetScope, string> = {
  private: '나만',
  team: '팀',
  org: '조직',
}

const NEXT_SCOPE: Record<SnippetScope, SnippetScope> = {
  private: 'team',
  team: 'org',
  org: 'private',
}

export function SnippetManagerPage() {
  const [items, setItems] = useState<SnippetSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>('all')
  const [sort, setSort] = useState<SortKey>('updated_at')
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null)
  const [deleting, setDeleting] = useState<SnippetSummary | null>(null)
  const [viewing, setViewing] = useState<Snippet | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const rows = await listSnippets({ limit: 200 })
      setItems(rows)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '불러오지 못했습니다.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const visible = useMemo(() => {
    let filtered = items
    if (scopeFilter !== 'all') {
      filtered = filtered.filter((it) => it.scope === scopeFilter)
    }
    const sorted = [...filtered]
    if (sort === 'use_count') {
      sorted.sort((a, b) => b.use_count - a.use_count)
    } else {
      sorted.sort((a, b) => {
        const ax = a.updated_at ?? ''
        const bx = b.updated_at ?? ''
        return bx.localeCompare(ax)
      })
    }
    return sorted
  }, [items, scopeFilter, sort])

  const handleRename = async (id: string) => {
    if (!editing || editing.id !== id) return
    const value = editing.value.trim()
    if (!value) return
    setBusyId(id)
    try {
      await patchSnippet(id, { name: value })
      setItems((cur) =>
        cur.map((it) => (it.id === id ? { ...it, name: value } : it)),
      )
      setEditing(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '이름 변경 실패')
    } finally {
      setBusyId(null)
    }
  }

  const handleShare = async (it: SnippetSummary) => {
    const next = NEXT_SCOPE[it.scope]
    setBusyId(it.id)
    try {
      await patchSnippet(it.id, { scope: next })
      setItems((cur) =>
        cur.map((row) => (row.id === it.id ? { ...row, scope: next } : row)),
      )
    } catch (e) {
      setErr(e instanceof Error ? e.message : '공유 범위 변경 실패')
    } finally {
      setBusyId(null)
    }
  }

  const handleDelete = async () => {
    if (!deleting) return
    setBusyId(deleting.id)
    try {
      await deleteSnippet(deleting.id)
      setItems((cur) => cur.filter((it) => it.id !== deleting.id))
      setDeleting(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '삭제 실패')
    } finally {
      setBusyId(null)
    }
  }

  const handleView = async (id: string) => {
    setBusyId(id)
    try {
      const full = await getSnippet(id)
      setViewing(full)
      // use_count was bumped on the BE; sync the local row.
      setItems((cur) =>
        cur.map((it) => (it.id === id ? { ...it, use_count: full.use_count } : it)),
      )
    } catch (e) {
      setErr(e instanceof Error ? e.message : '본문을 불러오지 못했습니다.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div
      className="mx-auto max-w-5xl px-6 py-8"
      data-testid="snippet-manager-page"
    >
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-smsg-900 dark:text-smsg-100">
            스니펫 관리
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            저장한 블록 묶음을 관리합니다. 공유 범위와 이름을 바꾸거나 삭제할 수 있어요.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-gray-600 dark:text-gray-300">
            범위
            <select
              value={scopeFilter}
              onChange={(e) => setScopeFilter(e.target.value as ScopeFilter)}
              data-testid="snippet-manager-scope-filter"
              className="ml-1 rounded border border-gray-300 px-1.5 py-0.5 text-xs dark:border-gray-700 dark:bg-gray-800"
            >
              <option value="all">전체</option>
              <option value="private">나만</option>
              <option value="team">팀</option>
              <option value="org">조직</option>
            </select>
          </label>
          <label className="text-xs text-gray-600 dark:text-gray-300">
            정렬
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              data-testid="snippet-manager-sort"
              className="ml-1 rounded border border-gray-300 px-1.5 py-0.5 text-xs dark:border-gray-700 dark:bg-gray-800"
            >
              <option value="updated_at">최근 수정순</option>
              <option value="use_count">사용 많은 순</option>
            </select>
          </label>
        </div>
      </header>

      {err && (
        <p
          role="alert"
          className="mb-4 rounded bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-200"
        >
          {err}
        </p>
      )}

      {loading && <p className="text-sm text-gray-500">불러오는 중…</p>}

      {!loading && visible.length === 0 && (
        <p className="text-sm text-gray-500">스니펫이 없습니다.</p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((it) => (
          <article
            key={it.id}
            data-testid={`snippet-card-${it.id}`}
            className="rounded-md border border-gray-200 bg-white p-3 shadow-sm dark:border-gray-700 dark:bg-gray-900"
          >
            <div className="flex items-start justify-between gap-2">
              {editing?.id === it.id ? (
                <input
                  autoFocus
                  value={editing.value}
                  onChange={(e) => setEditing({ id: it.id, value: e.target.value })}
                  onBlur={() => void handleRename(it.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleRename(it.id)
                    if (e.key === 'Escape') setEditing(null)
                  }}
                  className="w-full rounded border border-gray-300 px-1.5 py-0.5 text-sm dark:border-gray-700 dark:bg-gray-800"
                  data-testid={`snippet-card-rename-input-${it.id}`}
                />
              ) : (
                <h3 className="text-sm font-semibold text-smsg-900 dark:text-smsg-100">
                  {it.name}
                </h3>
              )}
              <span
                className="shrink-0 rounded-full bg-smsg-100 px-2 py-0.5 text-[10px] text-smsg-800 dark:bg-smsg-900/40 dark:text-smsg-100"
                data-testid={`snippet-card-scope-${it.id}`}
              >
                {SCOPE_LABEL[it.scope]}
              </span>
            </div>
            {it.description && (
              <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                {it.description}
              </p>
            )}
            {it.preview && (
              <p className="mt-1 truncate text-[11px] text-gray-500">{it.preview}</p>
            )}
            <p className="mt-2 text-[10px] text-gray-500">
              블록 {it.block_count}개 · 사용 {it.use_count}회
            </p>
            <div className="mt-3 flex flex-wrap gap-1 text-[11px]">
              <button
                type="button"
                onClick={() => setEditing({ id: it.id, value: it.name })}
                disabled={busyId === it.id}
                data-testid={`snippet-card-rename-${it.id}`}
                className="rounded border border-gray-300 px-2 py-0.5 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800"
              >
                이름 바꾸기
              </button>
              <button
                type="button"
                onClick={() => void handleShare(it)}
                disabled={busyId === it.id}
                data-testid={`snippet-card-share-${it.id}`}
                className="rounded border border-gray-300 px-2 py-0.5 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800"
              >
                공유 범위 변경
              </button>
              <button
                type="button"
                onClick={() => void handleView(it.id)}
                disabled={busyId === it.id}
                data-testid={`snippet-card-view-${it.id}`}
                className="rounded border border-gray-300 px-2 py-0.5 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800"
              >
                내용 보기
              </button>
              <button
                type="button"
                onClick={() => setDeleting(it)}
                disabled={busyId === it.id}
                data-testid={`snippet-card-delete-${it.id}`}
                className="rounded border border-red-300 px-2 py-0.5 text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-700 dark:text-red-200 dark:hover:bg-red-900/30"
              >
                삭제
              </button>
            </div>
          </article>
        ))}
      </div>

      {deleting && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="스니펫 삭제 확인"
          data-testid="snippet-manager-delete-confirm"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
          onClick={(e) => {
            if (e.target === e.currentTarget) setDeleting(null)
          }}
        >
          <div className="w-full max-w-sm rounded-md border border-gray-200 bg-white p-4 shadow-lg dark:border-gray-700 dark:bg-gray-900">
            <h3 className="text-sm font-semibold text-smsg-900 dark:text-smsg-100">
              스니펫 삭제
            </h3>
            <p className="mt-2 text-xs text-gray-600 dark:text-gray-300">
              "{deleting.name}" 을(를) 삭제할까요? 이 작업은 되돌릴 수 없어요.
            </p>
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleting(null)}
                className="rounded border border-gray-300 px-3 py-1 text-xs hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => void handleDelete()}
                className="rounded bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700"
                data-testid="snippet-manager-delete-confirm-yes"
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
          aria-label="스니펫 내용"
          data-testid="snippet-manager-view"
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-24"
          onClick={(e) => {
            if (e.target === e.currentTarget) setViewing(null)
          }}
        >
          <div className="w-full max-w-2xl rounded-md border border-gray-200 bg-white p-4 shadow-lg dark:border-gray-700 dark:bg-gray-900">
            <header className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-smsg-900 dark:text-smsg-100">
                {viewing.name}
              </h3>
              <button
                type="button"
                onClick={() => setViewing(null)}
                className="rounded border border-gray-300 px-2 py-0.5 text-xs hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
              >
                닫기
              </button>
            </header>
            <pre className="max-h-96 overflow-auto rounded bg-gray-50 p-2 text-[11px] dark:bg-gray-800">
              {JSON.stringify(viewing.blocks, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}
