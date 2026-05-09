import { Link } from 'react-router-dom'
import type { ActivityEvent } from '../api'
import { colorForKey, formatRelative, initialsFor } from '../format'

interface ActivityEventCardProps {
  event: ActivityEvent
  /** Compact (widget) variant collapses padding + hides metadata text. */
  compact?: boolean
  /** Override "now" so tests get deterministic relative times. */
  now?: number
}

/**
 * One event row used by both the widget and the full-page feed.
 *
 * Click target:
 *   - prefer `target.slug` → /docs/<slug>
 *   - falls back to a non-link wrapper when there's no slug (e.g. snippet).
 */
export function ActivityEventCard({ event, compact = false, now }: ActivityEventCardProps) {
  const slug = event.target.slug
  const initials = initialsFor(event.actor.name)
  const tone = colorForKey(event.actor.user_id || event.actor.name || event.id)
  const relative = formatRelative(event.timestamp, now)

  const inner = (
    <div
      data-testid="activity-event-card"
      data-kind={event.kind}
      className={
        'flex items-start gap-3 ' +
        (compact ? 'py-2' : 'rounded-md border border-gray-200 bg-white px-3 py-3 dark:border-gray-800 dark:bg-gray-900')
      }
    >
      <span
        aria-hidden="true"
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-semibold text-white"
        style={{ backgroundColor: tone }}
      >
        {initials}
      </span>
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-sm text-smsg-900 dark:text-gray-100">
          {event.summary}
        </p>
        <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
          <span data-testid="activity-event-relative">{relative || '—'}</span>
          {!compact && event.target.title && (
            <>
              <span className="mx-1.5 text-gray-300">·</span>
              <span className="truncate" title={event.target.title}>
                {event.target.title}
              </span>
            </>
          )}
        </p>
      </div>
    </div>
  )

  if (slug) {
    return (
      <Link
        to={`/docs/${encodeURIComponent(slug)}`}
        className="block hover:no-underline"
        data-testid="activity-event-link"
      >
        {inner}
      </Link>
    )
  }
  return <div data-testid="activity-event-static">{inner}</div>
}
