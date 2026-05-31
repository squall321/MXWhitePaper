import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Drawer } from '@/components/ui/Drawer'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { cn } from '@/components/ui/cn'
import {
  useNotificationsStore,
  type NotificationCategory,
  type NotificationItem,
} from '../store'
import { markNotificationRead } from '../api'
import { useT, type LocaleKey } from '@/lib/i18n'

interface NotificationDrawerProps {
  open: boolean
  onClose: () => void
}

type Filter = 'all' | NotificationCategory

/**
 * Pure helper exposed for unit tests — tally unread notifications by
 * category, plus a special `all` bucket for the total. Keeps the
 * D6-polish counter logic testable without booting the drawer's SSR
 * harness (zustand's getServerSnapshot ignores setState mutations).
 */
export function tallyUnreadByFilter(items: readonly NotificationItem[]): Record<Filter, number> {
  const tally: Record<Filter, number> = { all: 0, system: 0, activity: 0, comment: 0 }
  for (const it of items) {
    if (!it || it.read) continue
    tally.all += 1
    tally[it.category] += 1
  }
  return tally
}

const FILTERS: { id: Filter; labelKey: LocaleKey }[] = [
  { id: 'all', labelKey: 'notifications.filter.all' },
  { id: 'system', labelKey: 'notifications.filter.system' },
  { id: 'activity', labelKey: 'notifications.filter.activity' },
  { id: 'comment', labelKey: 'notifications.filter.comment' },
]

/**
 * Right-side drawer listing the last 50 notifications. Categories are
 * filterable; rows are clickable (mark-read + navigate to `/docs/<slug>`).
 *
 * D6 polish — per-category unread counts on the filter chips so a quick
 * glance at the drawer header shows "5 new comments vs 1 system" instead
 * of just "6 unread" lumped together, plus an inline mark-read action on
 * each row so users can clear individual notifications without
 * navigating into the doc.
 */
export function NotificationDrawer({ open, onClose }: NotificationDrawerProps) {
  const t = useT()
  const items = useNotificationsStore((s) => s.items)
  const markRead = useNotificationsStore((s) => s.markRead)
  const markAllRead = useNotificationsStore((s) => s.markAllRead)
  const clear = useNotificationsStore((s) => s.clear)
  const [filter, setFilter] = useState<Filter>('all')

  const safeItems = useMemo(() => (Array.isArray(items) ? items : []), [items])

  const filtered = useMemo(() => {
    if (filter === 'all') return safeItems
    return safeItems.filter((it) => it && it.category === filter)
  }, [safeItems, filter])

  const hasUnread = useMemo(
    () => safeItems.some((it) => it && !it.read),
    [safeItems],
  )

  /** Per-category unread tally for the filter chips. `all` is the total. */
  const unreadByFilter = useMemo(() => tallyUnreadByFilter(safeItems), [safeItems])

  // 서버에서 push 된 알림은 `id` 가 UUID — 로컬 이벤트 (`n-…`) 와 구분되니
  // mark-read 시 BE 에도 동기화한다. 로컬 이벤트는 BE 가 모르므로 skip.
  const handleMarkRead = (id: string) => {
    markRead(id)
    if (isServerId(id)) {
      void markNotificationRead(id).catch(() => {
        /* 다음 polling 라운드가 read_at 을 다시 가져와 결국 정합 — 토스트 안 띄움. */
      })
    }
  }
  const handleMarkAllRead = () => {
    const unreadServerIds = safeItems
      .filter((it) => it && !it.read && isServerId(it.id))
      .map((it) => it.id)
    markAllRead()
    for (const id of unreadServerIds) {
      void markNotificationRead(id).catch(() => {
        /* 같은 이유로 swallow. */
      })
    }
  }

  return (
    <Drawer open={open} onClose={onClose} side="right" ariaLabel={t('notifications.drawer.ariaLabel')}>
      <div className="flex h-full flex-col">
        <header className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <h2 className="text-base font-semibold text-smsg-900">{t('notifications.drawer.title')}</h2>
          <button
            type="button"
            aria-label={t('notifications.drawer.close')}
            onClick={onClose}
            className="rounded p-1 text-gray-500 hover:bg-gray-100"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M3.7 3.7l8.6 8.6M12.3 3.7l-8.6 8.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="flex flex-wrap items-center gap-1.5 border-b border-gray-200 bg-white px-4 py-2">
          {FILTERS.map((f) => {
            const count = unreadByFilter[f.id]
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                data-testid={`bell-filter-${f.id}`}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors',
                  filter === f.id
                    ? 'border-smsg-700 bg-smsg-700 text-white'
                    : 'border-gray-300 bg-white text-gray-700 hover:border-smsg-300',
                )}
              >
                <span>{t(f.labelKey)}</span>
                {count > 0 && (
                  <span
                    data-testid={`bell-filter-${f.id}-count`}
                    aria-hidden="true"
                    className={cn(
                      'grid h-4 min-w-[1rem] place-items-center rounded-full px-1 text-[10px] font-bold',
                      filter === f.id ? 'bg-white text-smsg-700' : 'bg-red-500 text-white',
                    )}
                  >
                    {count > 99 ? '99+' : count}
                  </span>
                )}
              </button>
            )
          })}
          <span className="ml-auto flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleMarkAllRead}
              disabled={!hasUnread}
              data-testid="bell-mark-all"
            >
              {t('notifications.action.markAllRead')}
            </Button>
            {filtered.length > 0 && (
              <Button type="button" variant="ghost" size="sm" onClick={() => clear()}>
                {t('notifications.action.clearAll')}
              </Button>
            )}
          </span>
        </div>

        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <EmptyState
              title={t('notifications.empty.title')}
              description={t('notifications.empty.description')}
              className="px-3 py-10"
            />
          ) : (
            <ul className="divide-y divide-gray-100" data-testid="bell-list">
              {filtered.map((it) => (
                <NotificationRow
                  key={it.id}
                  item={it}
                  onActivate={() => handleMarkRead(it.id)}
                  onClose={onClose}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </Drawer>
  )
}

function NotificationRow({
  item,
  onActivate,
  onClose,
}: {
  item: NotificationItem
  onActivate: () => void
  onClose: () => void
}) {
  const t = useT()
  const inner = (
    <div className="flex items-start gap-3 px-4 py-3">
      <span aria-hidden="true" className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', toneClass(item.category))} />
      <div className="min-w-0 flex-1">
        <p className={cn('text-sm', item.read ? 'text-gray-600' : 'font-semibold text-smsg-900')}>
          {item.message}
        </p>
        {item.detail && (
          <p className="mt-0.5 truncate text-xs text-gray-500">{item.detail}</p>
        )}
        <p className="mt-1 flex items-center gap-2 text-[11px] text-gray-400">
          <span>{t(categoryLabelKey(item.category))}</span>
          <span aria-hidden="true">·</span>
          <time dateTime={new Date(item.createdAt).toISOString()}>
            {formatRelative(t, item.createdAt)}
          </time>
        </p>
      </div>
      {!item.read && (
        <span
          aria-label={t('notifications.row.unreadDot')}
          className="ml-1 mt-1.5 h-1.5 w-1.5 rounded-full bg-smsg-700"
        />
      )}
    </div>
  )
  // D6 polish — inline "mark read" affordance on unread rows. Sits on the
  // far right; absolute so it doesn't push the row text. We render this
  // OUTSIDE the Link/button so the click target stays distinct from the
  // navigate-to-doc primary action.
  const inlineRead = !item.read ? (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onActivate()
      }}
      aria-label={t('notifications.action.markOneRead')}
      data-testid="bell-row-mark-read"
      className="absolute right-3 top-3 hidden rounded border border-smsg-300 bg-white px-1.5 py-0.5 text-[10px] font-medium text-smsg-700 shadow-sm hover:bg-smsg-50 group-hover:inline-block group-focus-within:inline-block"
    >
      ✓
    </button>
  ) : null

  if (item.slug) {
    return (
      <li className="group relative">
        <Link
          to={`/docs/${encodeURIComponent(item.slug)}`}
          onClick={() => {
            onActivate()
            onClose()
          }}
          className="block hover:bg-smsg-50 hover:no-underline"
        >
          {inner}
        </Link>
        {inlineRead}
      </li>
    )
  }
  return (
    <li className="group relative">
      <button
        type="button"
        onClick={onActivate}
        className="block w-full text-left transition-colors hover:bg-smsg-50"
      >
        {inner}
      </button>
      {inlineRead}
    </li>
  )
}

function toneClass(c: NotificationCategory): string {
  if (c === 'system') return 'bg-amber-500'
  if (c === 'comment') return 'bg-emerald-500'
  return 'bg-smsg-500'
}

function categoryLabelKey(c: NotificationCategory): LocaleKey {
  if (c === 'system') return 'notifications.filter.system'
  if (c === 'comment') return 'notifications.filter.comment'
  return 'notifications.filter.activity'
}

/**
 * Server-issued notification rows use a UUID v4 id (36 chars, 4 dashes).
 * Local-only events use the `n-…` prefix from `store.makeId()`.
 */
function isServerId(id: string): boolean {
  return id.length === 36 && id.split('-').length === 5
}

/**
 * Render an epoch ms timestamp as a relative time string. Buckets stop
 * at "N days ago"; older entries fall back to the locale's intl date
 * formatter (no more `'ko-KR'` hardcoding).
 *
 * Exported via the `t()` callback so the same buckets translate to
 * whatever the current locale defines for the same keys.
 */
function formatRelative(
  t: (key: LocaleKey, vars?: Record<string, string | number>) => string,
  ts: number,
  now: number = Date.now(),
): string {
  if (!Number.isFinite(ts)) return ''
  const diff = Math.max(0, now - ts)
  const min = 60_000
  const hour = 60 * min
  const day = 24 * hour
  if (diff < min) return t('notifications.time.justNow')
  if (diff < hour) return t('notifications.time.minutesAgo', { m: Math.floor(diff / min) })
  if (diff < day) return t('notifications.time.hoursAgo', { h: Math.floor(diff / hour) })
  if (diff < 2 * day) return t('notifications.time.yesterday')
  if (diff < 7 * day) return t('notifications.time.daysAgo', { d: Math.floor(diff / day) })
  try {
    return new Date(ts).toLocaleDateString(undefined, { year: '2-digit', month: '2-digit', day: '2-digit' })
  } catch {
    return ''
  }
}
