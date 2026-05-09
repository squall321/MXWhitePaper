import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { listActivity, type ActivityEvent } from './api'
import { ActivityEventCard } from './components/ActivityEventCard'

interface ActivityWidgetProps {
  /** Cap. Defaults to 5 — embedded variants want a small footprint. */
  limit?: number
  /** When provided, used instead of querying. Lets tests render synchronously. */
  items?: ActivityEvent[]
  /** Optional title override. */
  title?: string
}

/**
 * Compact 5-event activity rail. Embedded on Home / AdminDashboard / future
 * profile pages. Falls back to a soft empty state instead of a hard error so
 * an embedded surface never breaks its host page.
 */
export function ActivityWidget({
  limit = 5,
  items,
  title = '최근 활동',
}: ActivityWidgetProps) {
  const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : 5
  const enabled = !items
  const query = useQuery({
    queryKey: ['activity', 'widget', safeLimit],
    queryFn: () => listActivity({ limit: safeLimit }),
    enabled,
    staleTime: 30_000,
  })

  const sourceUnsafe = items ?? query.data
  const source: ActivityEvent[] = Array.isArray(sourceUnsafe) ? sourceUnsafe : []
  const list = source.slice(0, safeLimit)

  return (
    <section
      aria-label={title}
      data-testid="activity-widget"
      className="rounded-md border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900"
    >
      <header className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          {title}
        </h3>
        <Link to="/activity" className="text-xs text-link hover:underline">
          전체 보기
        </Link>
      </header>

      {enabled && query.isPending ? (
        <p className="text-sm text-gray-500">불러오는 중…</p>
      ) : list.length === 0 ? (
        <p className="text-sm text-gray-500" data-testid="activity-widget-empty">
          최근 활동이 없습니다.
        </p>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {list.map((ev) => (
            <li key={ev.id}>
              <ActivityEventCard event={ev} compact />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
