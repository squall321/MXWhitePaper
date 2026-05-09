/**
 * AddToSeriesButton — small dropdown in the doc reader header (editor+) that
 * lets the editor:
 *   1. Pick an existing series → POST /series/:slug/items.
 *   2. "+ 새 시리즈로 만들기" → prompt for slug+title, POST /series, then add.
 *
 * Needs the document's UUID (not just the slug) because the server stores
 * series_items by document_id. When the parent passes only a slug it should
 * supply documentId from `data.row.id` of the loaded doc.
 */
import { useEffect, useState } from 'react'
import { useAuthStore } from '@/features/auth/store'
import {
  addSeriesItem,
  createSeries,
  listSeries,
  type SeriesSummary,
} from './api'

export interface AddToSeriesButtonProps {
  /** Slug of the document (only used for an audit-friendly action label). */
  slug: string
  /** UUID of the document — required to add to a series. */
  documentId: string
}

export function AddToSeriesButton({
  slug,
  documentId,
}: AddToSeriesButtonProps) {
  const user = useAuthStore((s) => s.user)
  const role = user?.role ?? ''
  const isEditor = !!user && ['editor', 'owner', 'admin'].includes(role)

  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<SeriesSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [draftSlug, setDraftSlug] = useState('')
  const [draftTitle, setDraftTitle] = useState('')

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    void listSeries()
      .then((rows) => {
        if (!cancelled) setItems(rows)
      })
      .catch(() => {
        if (!cancelled) setItems([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  if (!isEditor) return null

  const close = () => {
    setOpen(false)
    setCreating(false)
    setError(null)
  }

  const addToExisting = async (seriesSlug: string) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await addSeriesItem(seriesSlug, documentId)
      close()
    } catch (e) {
      setError(e instanceof Error ? e.message : '추가에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const createAndAdd = async () => {
    const s = draftSlug.trim()
    const t = draftTitle.trim()
    if (!s || !t) {
      setError('slug 와 title 을 모두 입력하세요.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await createSeries({ slug: s, title: t })
      await addSeriesItem(s, documentId)
      close()
    } catch (e) {
      setError(e instanceof Error ? e.message : '시리즈 생성 실패')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative inline-block" data-testid="add-to-series-root">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        data-testid="add-to-series-button"
        aria-label={`문서 ${slug} 를 시리즈에 추가`}
        className="inline-flex items-center gap-1 rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
      >
        <span aria-hidden="true">📚</span>
        시리즈에 추가
      </button>
      {open && (
        <div
          role="menu"
          data-testid="add-to-series-menu"
          className="absolute right-0 z-50 mt-1 w-64 rounded-md border border-gray-200 bg-white p-2 text-xs shadow-md dark:border-gray-700 dark:bg-gray-900"
        >
          {error && (
            <p
              role="alert"
              className="mb-2 rounded bg-red-50 px-2 py-1 text-red-700 dark:bg-red-900/30 dark:text-red-200"
            >
              {error}
            </p>
          )}
          {!creating && (
            <>
              {loading && <p className="text-gray-500">불러오는 중…</p>}
              {!loading && items.length === 0 && (
                <p className="text-gray-500">아직 시리즈가 없습니다.</p>
              )}
              {!loading &&
                items.map((it) => (
                  <button
                    key={it.id}
                    type="button"
                    onClick={() => void addToExisting(it.slug)}
                    disabled={busy}
                    data-testid={`add-to-series-pick-${it.slug}`}
                    className="block w-full truncate rounded px-2 py-1 text-left hover:bg-gray-50 disabled:opacity-50 dark:hover:bg-gray-800"
                  >
                    {it.title}
                    <span className="ml-1 text-[10px] text-gray-500">
                      ({it.item_count}편)
                    </span>
                  </button>
                ))}
              <div className="mt-2 border-t border-gray-100 pt-2 dark:border-gray-800">
                <button
                  type="button"
                  onClick={() => setCreating(true)}
                  data-testid="add-to-series-new"
                  className="block w-full rounded px-2 py-1 text-left text-smsg-700 hover:bg-gray-50 dark:text-smsg-200 dark:hover:bg-gray-800"
                >
                  + 새 시리즈로 만들기
                </button>
              </div>
            </>
          )}
          {creating && (
            <div className="space-y-1">
              <label className="block">
                <span className="text-gray-600 dark:text-gray-300">slug</span>
                <input
                  value={draftSlug}
                  onChange={(e) => setDraftSlug(e.target.value)}
                  data-testid="add-to-series-slug"
                  className="mt-0.5 w-full rounded border border-gray-300 px-1.5 py-0.5 dark:border-gray-700 dark:bg-gray-800"
                />
              </label>
              <label className="block">
                <span className="text-gray-600 dark:text-gray-300">title</span>
                <input
                  value={draftTitle}
                  onChange={(e) => setDraftTitle(e.target.value)}
                  data-testid="add-to-series-title"
                  className="mt-0.5 w-full rounded border border-gray-300 px-1.5 py-0.5 dark:border-gray-700 dark:bg-gray-800"
                />
              </label>
              <div className="flex justify-end gap-1 pt-1">
                <button
                  type="button"
                  onClick={() => setCreating(false)}
                  className="rounded border border-gray-300 px-2 py-0.5 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={() => void createAndAdd()}
                  disabled={busy}
                  data-testid="add-to-series-create-confirm"
                  className="rounded bg-smsg-700 px-2 py-0.5 font-medium text-white hover:bg-smsg-900 disabled:opacity-50"
                >
                  생성 + 추가
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
