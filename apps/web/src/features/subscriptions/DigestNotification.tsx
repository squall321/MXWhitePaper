import { Link } from 'react-router-dom'

/**
 * Subscription digest payload as emitted by `digest_runner.emit_digests_for_user`.
 *
 * Mirrors the JSON shape the BE inserts into `notifications.payload` whenever a
 * matured pending bundle fires.
 */
export interface DigestItem {
  document_id: string
  event_kind: string
  payload: Record<string, unknown>
  queued_at: string | null
}

export interface DigestPayload {
  subscription_id: string
  cadence: 'daily' | 'weekly'
  since: string | null
  until: string | null
  item_count: number
  items: DigestItem[]
}

interface DigestNotificationProps {
  payload: DigestPayload
  onClose?: () => void
}

const KIND_LABEL: Record<string, string> = {
  doc_edited: '문서 수정',
  comment_added: '댓글',
  review_decided: '리뷰 결정',
  doc_published: '발행',
}

function readSlug(p: Record<string, unknown>): string | null {
  const v = p['slug']
  return typeof v === 'string' ? v : null
}

function readTitle(p: Record<string, unknown>): string | null {
  const v = p['title']
  return typeof v === 'string' ? v : null
}

function readChangeLog(p: Record<string, unknown>): string | null {
  const v = p['change_log']
  return typeof v === 'string' ? v : null
}

/**
 * Rich card for a `subscription_digest` notification — bundles N events into
 * a single readable list. Used inside the bell drawer (or anywhere a
 * `DigestPayload` lands).
 */
export function DigestNotification({ payload, onClose }: DigestNotificationProps) {
  const cadenceLabel = payload.cadence === 'weekly' ? '이번 주' : '오늘'
  return (
    <article
      data-testid="digest-notification"
      data-cadence={payload.cadence}
      className="space-y-2 rounded-md border border-gray-200 bg-white px-3 py-2 shadow-sm"
    >
      <header className="flex items-baseline justify-between">
        <p className="text-xs font-semibold text-smsg-900">
          {cadenceLabel} 모아보기 ({payload.item_count}건)
        </p>
        {payload.until && (
          <time className="text-[11px] text-gray-400" dateTime={payload.until}>
            {payload.until.slice(0, 10)}
          </time>
        )}
      </header>
      <ul className="space-y-1" data-testid="digest-items">
        {payload.items.map((it, i) => {
          const slug = readSlug(it.payload)
          const title = readTitle(it.payload) ?? slug ?? it.document_id
          const change = readChangeLog(it.payload)
          const kind = KIND_LABEL[it.event_kind] ?? it.event_kind
          const inner = (
            <span className="flex items-baseline gap-2">
              <span className="rounded bg-smsg-50 px-1.5 py-0.5 text-[10px] font-semibold text-smsg-700">
                {kind}
              </span>
              <span className="truncate text-sm text-gray-800">{title}</span>
              {change && (
                <span className="truncate text-[11px] text-gray-500">
                  — {change}
                </span>
              )}
            </span>
          )
          return (
            <li key={`${it.document_id}-${i}`} data-testid="digest-item">
              {slug ? (
                <Link
                  to={`/docs/${encodeURIComponent(slug)}`}
                  onClick={onClose}
                  className="block rounded px-1 py-1 hover:bg-smsg-50 hover:no-underline"
                >
                  {inner}
                </Link>
              ) : (
                <div className="block rounded px-1 py-1">{inner}</div>
              )}
            </li>
          )
        })}
      </ul>
    </article>
  )
}
