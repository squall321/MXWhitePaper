import { useEffect, useState } from 'react'
import { Link, useOutletContext, useParams, useNavigate } from 'react-router-dom'
import { Button, Card, EmptyState } from '@/components/ui'
import {
  useDeleteSavedView,
  usePatchSavedView,
  useSavedViewResults,
  useSavedViews,
} from '@/features/saved-views/hooks'
import type {
  SavedView,
  SavedViewFilters,
} from '@/features/saved-views/api'
import type { AppOutletContext } from '@/App'

/**
 * `/views/:id` — 저장된 뷰 결과 페이지.
 *
 *   - GET /me/saved-views/:id/results 를 호출해 매칭 문서 리스트 표시.
 *   - 헤더의 "필터 편집" 버튼 → 인라인 편집 모달.
 *   - 헤더의 "삭제" → confirm + DELETE 후 / 로 redirect.
 *   - Layout 패턴은 Recent.tsx 와 동일 (sidebars cleared, divide-y 리스트).
 */
export function SavedViewPage() {
  const { id = '' } = useParams<{ id: string }>()
  const { setLeftRail, setRightRail } = useOutletContext<AppOutletContext>()
  const navigate = useNavigate()

  // List query is shared with the rail — used here to look up the view's
  // metadata (name/icon/filters) without an extra GET-by-id endpoint.
  const allViews = useSavedViews()
  const view = allViews.data?.find((v) => v.id === id) ?? null

  const results = useSavedViewResults(id, { limit: 50, offset: 0 })
  const del = useDeleteSavedView()

  const [editOpen, setEditOpen] = useState(false)

  useEffect(() => {
    setLeftRail(undefined)
    setRightRail(null)
    return () => {
      setLeftRail(undefined)
      setRightRail(null)
    }
  }, [setLeftRail, setRightRail])

  const onDelete = () => {
    if (!view) return
    if (!window.confirm(`"${view.name}" 뷰를 삭제할까요?`)) return
    del.mutate(view.id, {
      onSuccess: () => navigate('/'),
    })
  }

  if (!view && allViews.isLoading) {
    return (
      <p className="px-2 py-12 text-center text-sm text-gray-500" data-testid="saved-view-loading">
        불러오는 중…
      </p>
    )
  }
  if (!view) {
    return (
      <EmptyState
        title="저장된 뷰를 찾을 수 없습니다"
        description="삭제되었거나 다른 사용자의 뷰일 수 있습니다."
        action={
          <Link to="/" className="inline-block">
            <Button>홈으로</Button>
          </Link>
        }
      />
    )
  }

  const items = results.data?.items ?? []
  const total = results.data?.total ?? 0

  return (
    <section className="space-y-6" data-testid="saved-view-page">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-smsg-900 sm:text-3xl">
            <span aria-hidden="true">{view.icon || '📂'}</span> {view.name}
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            <FilterSummary filters={view.filters} /> · 총 <strong>{total}</strong>건
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            data-testid="saved-view-edit-button"
            onClick={() => setEditOpen(true)}
          >
            필터 편집
          </Button>
          <Button
            variant="ghost"
            data-testid="saved-view-delete-button"
            onClick={onDelete}
          >
            삭제
          </Button>
        </div>
      </header>

      {results.isLoading ? (
        <p className="px-2 py-12 text-center text-sm text-gray-500">
          결과를 불러오는 중…
        </p>
      ) : items.length === 0 ? (
        <EmptyState
          title="결과가 없습니다"
          description="필터를 조정해 보세요."
        />
      ) : (
        <Card padded={false}>
          <ul className="divide-y divide-gray-100" data-testid="saved-view-results">
            {items.map((doc) => (
              <li
                key={doc.id}
                className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-smsg-50"
              >
                <div className="min-w-0 flex-1">
                  <Link
                    to={`/docs/${encodeURIComponent(doc.slug)}`}
                    className="block hover:no-underline"
                  >
                    <p className="line-clamp-2 text-sm font-medium text-smsg-900">
                      {doc.title}
                    </p>
                    <p className="mt-0.5 truncate font-mono text-[11px] text-gray-500">
                      {doc.slug}
                    </p>
                    {doc.summary && (
                      <p className="mt-0.5 line-clamp-2 text-xs text-gray-600">
                        {doc.summary}
                      </p>
                    )}
                  </Link>
                </div>
                {doc.updated_at && (
                  <time
                    dateTime={doc.updated_at}
                    className="shrink-0 pt-0.5 text-[11px] text-gray-500"
                  >
                    {doc.updated_at.slice(0, 10)}
                  </time>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {editOpen && (
        <SavedViewFilterEditModal
          view={view}
          onClose={() => setEditOpen(false)}
        />
      )}
    </section>
  )
}

function FilterSummary({ filters }: { filters: SavedViewFilters }) {
  const parts: string[] = []
  if (filters.part) parts.push(`부서=${filters.part}`)
  if (filters.tag) parts.push(`태그=${filters.tag}`)
  if (filters.author) parts.push(`작성자=${filters.author}`)
  if (filters.from) parts.push(`from=${filters.from}`)
  if (filters.to) parts.push(`to=${filters.to}`)
  if (filters.q) parts.push(`q="${filters.q}"`)
  if (filters.status) parts.push(`상태=${filters.status}`)
  return <span data-testid="saved-view-filter-summary">{parts.join(' · ') || '필터 없음'}</span>
}

interface EditModalProps {
  view: SavedView
  onClose: () => void
}

function SavedViewFilterEditModal({ view, onClose }: EditModalProps) {
  const [name, setName] = useState(view.name)
  const [icon, setIcon] = useState(view.icon ?? '📂')
  const [filters, setFilters] = useState<SavedViewFilters>(view.filters)
  const patch = usePatchSavedView()

  const setF = <K extends keyof SavedViewFilters>(
    k: K,
    v: SavedViewFilters[K] | string,
  ) => {
    setFilters((f) => {
      const next = { ...f }
      if (v == null || v === '') delete next[k]
      else (next[k] as unknown) = v
      return next
    })
  }

  const save = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    patch.mutate(
      {
        id: view.id,
        body: { name: trimmed, icon: icon || null, filters },
      },
      { onSuccess: onClose },
    )
  }

  return (
    <div
      role="dialog"
      aria-label="저장된 뷰 필터 편집"
      data-testid="saved-view-filter-modal"
      className="fixed inset-0 z-modal flex items-center justify-center bg-black/30"
      onClick={onClose}
    >
      <div
        className="w-96 max-w-[92vw] rounded-md bg-white p-4 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-3 text-sm font-semibold">저장된 뷰 편집</h3>
        <div className="space-y-2">
          <label className="block text-xs text-gray-700">
            <span className="mb-0.5 block font-semibold">이름</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm"
            />
          </label>
          <label className="block text-xs text-gray-700">
            <span className="mb-0.5 block font-semibold">아이콘</span>
            <input
              type="text"
              value={icon}
              onChange={(e) => setIcon(e.target.value.slice(0, 4))}
              maxLength={4}
              className="w-20 rounded border border-gray-300 bg-white px-2 py-1 text-base"
            />
          </label>
          <FilterField
            label="부서 (slug)"
            value={filters.part ?? ''}
            onChange={(v) => setF('part', v)}
          />
          <FilterField
            label="태그"
            value={filters.tag ?? ''}
            onChange={(v) => setF('tag', v)}
          />
          <FilterField
            label="작성자 (UUID 또는 email)"
            value={filters.author ?? ''}
            onChange={(v) => setF('author', v)}
          />
          <FilterField
            label="from (YYYY-MM-DD)"
            value={filters.from ?? ''}
            onChange={(v) => setF('from', v)}
          />
          <FilterField
            label="to (YYYY-MM-DD)"
            value={filters.to ?? ''}
            onChange={(v) => setF('to', v)}
          />
          <FilterField
            label="검색어 (q)"
            value={filters.q ?? ''}
            onChange={(v) => setF('q', v)}
          />
          <label className="block text-xs text-gray-700">
            <span className="mb-0.5 block font-semibold">상태</span>
            <select
              value={filters.status ?? ''}
              onChange={(e) =>
                setF(
                  'status',
                  e.target.value as SavedViewFilters['status'] | '',
                )
              }
              className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm"
            >
              <option value="">(상태 무관)</option>
              <option value="draft">draft</option>
              <option value="published">published</option>
              <option value="archived">archived</option>
            </select>
          </label>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
          >
            취소
          </button>
          <button
            type="button"
            data-testid="saved-view-filter-save"
            onClick={save}
            disabled={!name.trim() || patch.isPending}
            className="rounded bg-smsg-700 px-3 py-1 text-xs font-semibold text-white hover:bg-smsg-900 disabled:opacity-60"
          >
            저장
          </button>
        </div>
      </div>
    </div>
  )
}

function FilterField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <label className="block text-xs text-gray-700">
      <span className="mb-0.5 block font-semibold">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm"
      />
    </label>
  )
}
