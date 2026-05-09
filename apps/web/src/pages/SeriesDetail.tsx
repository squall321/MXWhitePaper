import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  addSeriesItem,
  getSeries,
  removeSeriesItem,
  reorderSeriesItem,
  type SeriesDetail,
  type SeriesItem,
} from '@/features/series/api'
import { getDocument } from '@/features/document/api'

/**
 * `/series/:slug` — 시리즈 단건 관리.
 *
 * - 시리즈 메타 (제목/설명/커버) 표시.
 * - 항목 목록은 dnd-kit 드래그로 재정렬. 드롭 시 BE PATCH 로 새 position 반영.
 * - 문서 추가는 slug 입력 → getDocument 로 id 조회 → POST /series/:slug/items.
 */
export function SeriesDetailPage() {
  const { slug } = useParams<{ slug: string }>()
  const [series, setSeries] = useState<SeriesDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pickerSlug, setPickerSlug] = useState('')

  const reload = useCallback(async () => {
    if (!slug) return
    setLoading(true)
    setErr(null)
    try {
      const detail = await getSeries(slug)
      setSeries(detail)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '불러오지 못했습니다.')
    } finally {
      setLoading(false)
    }
  }, [slug])

  useEffect(() => {
    void reload()
  }, [reload])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  )

  const commitOrder = useCallback(
    async (rows: SeriesItem[]) => {
      if (!slug) return
      setBusy(true)
      setErr(null)
      try {
        // Re-number positions densely (0..N-1) and PATCH only items whose
        // position changed. This keeps writes minimal on small reorders.
        for (let i = 0; i < rows.length; i++) {
          const r = rows[i]
          if (!r) continue
          if (r.position !== i) {
            await reorderSeriesItem(slug, r.document_id, i)
          }
        }
        await reload()
      } catch (e) {
        setErr(e instanceof Error ? e.message : '재정렬 실패')
      } finally {
        setBusy(false)
      }
    },
    [slug, reload],
  )

  const handleDragEnd = (ev: DragEndEvent) => {
    if (!series) return
    const { active, over } = ev
    if (!over || active.id === over.id) return
    const items = series.items
    const oldIdx = items.findIndex((it) => it.document_id === active.id)
    const newIdx = items.findIndex((it) => it.document_id === over.id)
    if (oldIdx < 0 || newIdx < 0) return
    const next = arrayMove(items, oldIdx, newIdx)
    setSeries({ ...series, items: next })
    void commitOrder(next)
  }

  const handleAdd = async () => {
    if (!slug) return
    const ds = pickerSlug.trim()
    if (!ds) return
    setBusy(true)
    setErr(null)
    try {
      const doc = await getDocument(ds)
      await addSeriesItem(slug, doc.row.id)
      setPickerSlug('')
      await reload()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '문서 추가 실패')
    } finally {
      setBusy(false)
    }
  }

  const handleRemove = async (documentId: string) => {
    if (!slug) return
    setBusy(true)
    setErr(null)
    try {
      await removeSeriesItem(slug, documentId)
      await reload()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '제거 실패')
    } finally {
      setBusy(false)
    }
  }

  if (!slug) {
    return <p className="text-sm text-red-600">missing slug</p>
  }

  return (
    <div
      className="mx-auto max-w-3xl px-6 py-8"
      data-testid="series-detail-page"
    >
      <div className="mb-3 text-xs">
        <Link
          to="/series"
          className="text-smsg-700 hover:underline dark:text-smsg-200"
        >
          ← 시리즈 목록
        </Link>
      </div>
      {loading && <p className="text-sm text-gray-500">불러오는 중…</p>}
      {err && (
        <p
          role="alert"
          className="mb-4 rounded bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-200"
        >
          {err}
        </p>
      )}
      {series && (
        <>
          <header className="mb-6 flex items-start gap-3">
            <span
              aria-hidden="true"
              className="grid h-16 w-16 shrink-0 place-items-center rounded bg-smsg-50 text-3xl text-smsg-700 dark:bg-smsg-900/40 dark:text-smsg-100"
            >
              📚
            </span>
            <div className="min-w-0 flex-1">
              <h1
                data-testid="series-detail-title"
                className="text-2xl font-bold text-smsg-900 dark:text-smsg-100"
              >
                {series.title}
              </h1>
              {series.description && (
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                  {series.description}
                </p>
              )}
              <p className="mt-1 text-xs text-gray-500">
                /{series.slug} · {series.items.length}편
              </p>
            </div>
          </header>

          <section className="mb-4">
            <h2 className="mb-2 text-sm font-semibold text-smsg-900 dark:text-smsg-100">
              문서 목록
            </h2>
            {series.items.length === 0 && (
              <p className="text-sm text-gray-500">아직 문서가 없습니다.</p>
            )}
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={series.items.map((it) => it.document_id)}
                strategy={verticalListSortingStrategy}
              >
                <ol
                  className="space-y-1"
                  data-testid="series-detail-items"
                >
                  {series.items.map((it, idx) => (
                    <SeriesItemRow
                      key={it.document_id}
                      item={it}
                      index={idx}
                      busy={busy}
                      onRemove={() => void handleRemove(it.document_id)}
                    />
                  ))}
                </ol>
              </SortableContext>
            </DndContext>
          </section>

          <section
            className="rounded border border-smsg-100 bg-white p-3 text-sm dark:border-smsg-900/40 dark:bg-gray-900"
            data-testid="series-detail-add"
          >
            <h3 className="mb-2 text-xs font-semibold text-smsg-900 dark:text-smsg-100">
              + 문서 추가
            </h3>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex-1 text-xs">
                <span className="sr-only">문서 slug</span>
                <input
                  value={pickerSlug}
                  onChange={(e) => setPickerSlug(e.target.value)}
                  placeholder="문서 slug 를 입력"
                  data-testid="series-detail-add-slug"
                  className="w-full rounded border border-gray-300 px-1.5 py-0.5 dark:border-gray-700 dark:bg-gray-800"
                />
              </label>
              <button
                type="button"
                onClick={() => void handleAdd()}
                disabled={busy || !pickerSlug.trim()}
                data-testid="series-detail-add-confirm"
                className="rounded bg-smsg-700 px-2 py-0.5 text-xs font-medium text-white hover:bg-smsg-900 disabled:opacity-50"
              >
                추가
              </button>
            </div>
            <p className="mt-1 text-[11px] text-gray-500">
              문서 slug 는 URL 의 /docs/뒤 부분과 같아요.
            </p>
          </section>
        </>
      )}
    </div>
  )
}

interface SeriesItemRowProps {
  item: SeriesItem
  index: number
  busy: boolean
  onRemove: () => void
}

function SeriesItemRow({ item, index, busy, onRemove }: SeriesItemRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.document_id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  }
  return (
    <li
      ref={setNodeRef}
      style={style}
      data-testid={`series-detail-item-${item.slug}`}
      className="flex items-center gap-2 rounded border border-gray-200 bg-white px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-900"
    >
      <span
        {...attributes}
        {...listeners}
        aria-label="끌어서 재정렬"
        className="cursor-grab select-none text-gray-400"
      >
        <svg
          width="10"
          height="14"
          viewBox="0 0 10 14"
          fill="currentColor"
          aria-hidden="true"
        >
          <circle cx="3" cy="3" r="1" />
          <circle cx="7" cy="3" r="1" />
          <circle cx="3" cy="7" r="1" />
          <circle cx="7" cy="7" r="1" />
          <circle cx="3" cy="11" r="1" />
          <circle cx="7" cy="11" r="1" />
        </svg>
      </span>
      <span className="w-6 shrink-0 text-right text-xs text-gray-500">
        {index + 1}.
      </span>
      <Link
        to={`/docs/${encodeURIComponent(item.slug)}`}
        className="min-w-0 flex-1 truncate text-smsg-700 hover:underline dark:text-smsg-200"
      >
        {item.title}
      </Link>
      <button
        type="button"
        onClick={onRemove}
        disabled={busy}
        data-testid={`series-detail-remove-${item.slug}`}
        className="rounded border border-red-300 px-1.5 py-0.5 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-700 dark:text-red-200 dark:hover:bg-red-900/30"
      >
        제거
      </button>
    </li>
  )
}
