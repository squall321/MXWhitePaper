import { Link } from 'react-router-dom'
import { useRecentStore, type RecentDoc } from '../store'
import { EmptyState } from '@/components/ui'

interface RecentRailProps {
  /** Rendering variant. Sidebar shows up to 10; inline (e.g. Home strip)
   *  defaults to the same 10 but the wrapper visually adapts via className. */
  max?: number
  /** Override the items (used by tests + the `/recent` page). */
  items?: RecentDoc[]
  /** Show the "전체 보기" link to `/recent`. */
  showSeeAll?: boolean
}

/**
 * "최근 본 문서" right-rail panel. Reads from the persisted recent store and
 * lists the most recent entries with a relative-time label.
 *
 * Visual language matches `<RightRail>` (TOC/related/backlinks): same `Card`
 * border, same heading style, same hover affordance.
 */
export function RecentRail({ max = 10, items, showSeeAll = true }: RecentRailProps) {
  const storeItems = useRecentStore((s) => s.items)
  const list = (items ?? storeItems).slice(0, max)

  return (
    <section aria-label="최근 본 문서" className="px-3">
      <header className="flex items-center justify-between pb-2">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
          <span aria-hidden="true">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.4" />
              <path d="M8 4.5V8l2.4 1.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </span>
          최근 본 문서
        </h3>
        {showSeeAll && list.length > 0 && (
          <Link to="/recent" className="text-xs text-link hover:underline">
            전체 보기
          </Link>
        )}
      </header>

      {list.length === 0 ? (
        <EmptyState
          title="아직 본 문서가 없어요"
          description="메인에서 카드를 클릭해 보세요."
          className="px-3 py-6"
        />
      ) : (
        <ul className="space-y-1">
          {list.map((doc) => (
            <li key={doc.slug}>
              <Link
                to={`/docs/${encodeURIComponent(doc.slug)}`}
                className="group block rounded-md border border-transparent px-2 py-1.5 transition-colors hover:border-smsg-100 hover:bg-smsg-50 hover:no-underline"
              >
                <p className="line-clamp-2 text-sm font-medium text-smsg-900 group-hover:text-smsg-700">
                  {doc.title}
                </p>
                <time className="text-[11px] text-gray-500" dateTime={new Date(doc.viewedAt).toISOString()}>
                  {formatRelative(doc.viewedAt)}
                </time>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/**
 * Korean-friendly relative time. Uses `Date.now()` so it's deterministic only
 * relative to "now" — RecentRail is a non-essential rail so an SSR mismatch
 * isn't a concern (the client immediately re-renders).
 */
export function formatRelative(ts: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - ts)
  const min = 60_000
  const hour = 60 * min
  const day = 24 * hour
  if (diff < min) return '방금 전'
  if (diff < hour) return `${Math.floor(diff / min)}분 전`
  if (diff < day) return `${Math.floor(diff / hour)}시간 전`
  if (diff < 2 * day) return '어제'
  if (diff < 7 * day) return `${Math.floor(diff / day)}일 전`
  try {
    return new Date(ts).toLocaleDateString('ko-KR', { year: '2-digit', month: '2-digit', day: '2-digit' })
  } catch {
    return ''
  }
}
