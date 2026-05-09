import { useEffect, useMemo, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { Button, Card, EmptyState } from '@/components/ui'
import {
  useBookmarks,
  useRecentReads,
} from '@/features/bookmarks/hooks/useBookmarks'
import type { RecentRead } from '@/features/bookmarks/api'
import { formatRelative } from '@/features/recent/components/RecentRail'
import type { AppOutletContext } from '@/App'
import { BulkDocCheckbox } from '@/features/admin/bulk-docs/BulkDocCheckbox'
import { BulkDocActionsBar } from '@/features/admin/bulk-docs/BulkDocActionsBar'

type SortMode = 'last-read' | 'most-time' | 'unread-first'

/**
 * 서버 영속 "내가 읽은 문서" 페이지.
 *
 *   - 최근 50개 열람 기록 (BE `/reads/recent`)
 *   - "책갈피만" 토글 → bookmarked=true 인 문서만
 *   - 정렬: 최근 / 누적 시간 / 미열람 우선 (read_seconds=0 가 위)
 */
export function ReadListPage() {
  const reads = useRecentReads(50)
  const bookmarks = useBookmarks(null)
  const [bookmarkedOnly, setBookmarkedOnly] = useState(false)
  const [sort, setSort] = useState<SortMode>('last-read')
  const { setLeftRail, setRightRail } = useOutletContext<AppOutletContext>()

  useEffect(() => {
    setLeftRail(null)
    setRightRail(null)
    return () => {
      setLeftRail(undefined)
      setRightRail(null)
    }
  }, [setLeftRail, setRightRail])

  const items = useMemo(() => {
    const list = [...(reads.data ?? [])]
    const filtered = bookmarkedOnly ? list.filter((r) => r.bookmarked) : list
    return filtered.sort((a, b) => sortReads(a, b, sort))
  }, [reads.data, bookmarkedOnly, sort])

  const bookmarkedCount = (bookmarks.data ?? []).length

  return (
    <section className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-smsg-900 sm:text-3xl">
            읽은 문서
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            서버에 저장된 내 열람 기록 (최근 50개) — 누적 시간과 책갈피 표시까지 함께 보여줘요.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setBookmarkedOnly((v) => !v)}
            data-testid="reads-bookmarked-toggle"
            className={[
              'rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
              bookmarkedOnly
                ? 'border-smsg-700 bg-smsg-700 text-white'
                : 'border-gray-200 bg-white text-gray-600 hover:border-smsg-300 hover:text-smsg-700',
            ].join(' ')}
          >
            책갈피만
            {bookmarkedCount > 0 && (
              <span className="ml-1 text-[11px] opacity-80">({bookmarkedCount})</span>
            )}
          </button>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortMode)}
            aria-label="정렬"
            data-testid="reads-sort"
            className="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700"
          >
            <option value="last-read">최근 열람순</option>
            <option value="most-time">읽은 시간 많은 순</option>
            <option value="unread-first">미열람 우선</option>
          </select>
        </div>
      </header>

      {reads.isPending ? (
        <p className="text-sm text-gray-500">불러오는 중…</p>
      ) : items.length === 0 ? (
        <EmptyState
          title={bookmarkedOnly ? '책갈피된 열람 기록이 없어요' : '아직 읽은 문서가 없어요'}
          description="홈에서 카드를 클릭하면 자동으로 기록돼요."
          action={
            <Link to="/" className="inline-block">
              <Button>홈으로</Button>
            </Link>
          }
        />
      ) : (
        <Card padded={false}>
          <ul className="divide-y divide-gray-100" data-testid="reads-list">
            {items.map((doc) => (
              <li
                key={doc.document_id}
                className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-smsg-50"
              >
                <BulkDocCheckbox slug={doc.slug} />
                <div className="min-w-0 flex-1">
                  <Link
                    to={`/docs/${encodeURIComponent(doc.slug)}`}
                    className="block hover:no-underline"
                  >
                    <p className="line-clamp-2 text-sm font-medium text-smsg-900">
                      {doc.title}
                      {doc.bookmarked && (
                        <span className="ml-2 inline-flex items-center align-middle text-smsg-700" aria-label="책갈피됨">
                          <svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                            <path d="M5 3h10a1 1 0 011 1v14l-6-3.5L4 18V4a1 1 0 011-1z" />
                          </svg>
                        </span>
                      )}
                    </p>
                    {doc.summary && (
                      <p className="mt-0.5 line-clamp-2 text-xs text-gray-500">{doc.summary}</p>
                    )}
                    <p className="mt-1 truncate font-mono text-[11px] text-gray-400">{doc.slug}</p>
                  </Link>
                </div>
                <div className="shrink-0 text-right text-[11px] text-gray-500">
                  <p>
                    <time dateTime={doc.read_at ?? undefined}>
                      {doc.read_at ? formatRelative(new Date(doc.read_at).getTime()) : '—'}
                    </time>
                  </p>
                  <p className="text-gray-400">읽은 시간: {formatSeconds(doc.read_seconds)}</p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <BulkDocActionsBar />
    </section>
  )
}

function sortReads(a: RecentRead, b: RecentRead, mode: SortMode): number {
  if (mode === 'most-time') {
    return (b.read_seconds ?? 0) - (a.read_seconds ?? 0)
  }
  if (mode === 'unread-first') {
    const at = a.read_seconds === 0 ? 0 : 1
    const bt = b.read_seconds === 0 ? 0 : 1
    if (at !== bt) return at - bt
  }
  // last-read or fallback tiebreak
  const ax = a.read_at ? new Date(a.read_at).getTime() : 0
  const bx = b.read_at ? new Date(b.read_at).getTime() : 0
  return bx - ax
}

function formatSeconds(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '미열람'
  if (sec < 60) return `${sec}초`
  const m = Math.floor(sec / 60)
  if (m < 60) return `${m}분`
  const h = Math.floor(m / 60)
  return `${h}시간 ${m % 60}분`
}
