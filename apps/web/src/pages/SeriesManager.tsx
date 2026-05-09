import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  createSeries,
  listSeries,
  type SeriesSummary,
} from '@/features/series/api'

/**
 * `/series` — 시리즈(책) 관리.
 *
 * 3-col grid 로 시리즈를 표시한다. 카드별:
 *   - title + cover_image_id placeholder + item_count + "관리" 링크.
 *
 * "+ 새 시리즈" 버튼은 slug + title 만 받는 간단한 입력 폼을 띄운다.
 */
export function SeriesManagerPage() {
  const [items, setItems] = useState<SeriesSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newSlug, setNewSlug] = useState('')
  const [newTitle, setNewTitle] = useState('')
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const rows = await listSeries()
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

  const handleCreate = async () => {
    const slug = newSlug.trim()
    const title = newTitle.trim()
    if (!slug || !title) {
      setErr('slug 와 title 을 모두 입력하세요.')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      await createSeries({ slug, title })
      setNewSlug('')
      setNewTitle('')
      setCreating(false)
      await reload()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '시리즈 생성 실패')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="mx-auto max-w-5xl px-6 py-8"
      data-testid="series-manager-page"
    >
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-smsg-900 dark:text-smsg-100">
            시리즈 관리
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            여러 문서를 묶어 책처럼 prev/next 로 탐색할 수 있게 해 보세요.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreating((v) => !v)}
          data-testid="series-manager-new"
          className="rounded bg-smsg-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-smsg-900"
        >
          + 새 시리즈
        </button>
      </header>

      {creating && (
        <div
          data-testid="series-manager-new-form"
          className="mb-6 rounded border border-smsg-100 bg-white p-3 text-sm dark:border-smsg-900/40 dark:bg-gray-900"
        >
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="text-xs">
              <span className="text-gray-600 dark:text-gray-300">slug</span>
              <input
                value={newSlug}
                onChange={(e) => setNewSlug(e.target.value)}
                data-testid="series-manager-new-slug"
                className="mt-0.5 w-full rounded border border-gray-300 px-1.5 py-0.5 dark:border-gray-700 dark:bg-gray-800"
              />
            </label>
            <label className="text-xs">
              <span className="text-gray-600 dark:text-gray-300">title</span>
              <input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                data-testid="series-manager-new-title"
                className="mt-0.5 w-full rounded border border-gray-300 px-1.5 py-0.5 dark:border-gray-700 dark:bg-gray-800"
              />
            </label>
          </div>
          <div className="mt-2 flex justify-end gap-2 text-xs">
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="rounded border border-gray-300 px-2 py-0.5 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
            >
              취소
            </button>
            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={busy}
              data-testid="series-manager-new-confirm"
              className="rounded bg-smsg-700 px-2 py-0.5 font-medium text-white hover:bg-smsg-900 disabled:opacity-50"
            >
              생성
            </button>
          </div>
        </div>
      )}

      {err && (
        <p
          role="alert"
          className="mb-4 rounded bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-200"
        >
          {err}
        </p>
      )}

      {loading && <p className="text-sm text-gray-500">불러오는 중…</p>}

      {!loading && items.length === 0 && (
        <p className="text-sm text-gray-500">시리즈가 없습니다.</p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((it) => (
          <article
            key={it.id}
            data-testid={`series-card-${it.slug}`}
            className="rounded-md border border-gray-200 bg-white p-3 shadow-sm dark:border-gray-700 dark:bg-gray-900"
          >
            <div className="flex items-start gap-2">
              <span
                aria-hidden="true"
                className="grid h-12 w-12 shrink-0 place-items-center rounded bg-smsg-50 text-2xl text-smsg-700 dark:bg-smsg-900/40 dark:text-smsg-100"
              >
                📚
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-sm font-semibold text-smsg-900 dark:text-smsg-100">
                  {it.title}
                </h3>
                {it.description && (
                  <p className="mt-0.5 line-clamp-2 text-xs text-gray-600 dark:text-gray-300">
                    {it.description}
                  </p>
                )}
                <p className="mt-1 text-[11px] text-gray-500">
                  {it.item_count}편
                  {it.first_item_title && (
                    <span className="ml-1">· 첫 편: {it.first_item_title}</span>
                  )}
                </p>
              </div>
            </div>
            <div className="mt-3 flex justify-end">
              <Link
                to={`/series/${encodeURIComponent(it.slug)}`}
                data-testid={`series-card-manage-${it.slug}`}
                className="rounded border border-gray-300 px-2 py-0.5 text-xs hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
              >
                관리
              </Link>
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}
