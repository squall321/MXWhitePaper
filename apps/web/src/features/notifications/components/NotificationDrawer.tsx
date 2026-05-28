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

interface NotificationDrawerProps {
  open: boolean
  onClose: () => void
}

type Filter = 'all' | NotificationCategory

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: '전체' },
  { id: 'system', label: '시스템' },
  { id: 'activity', label: '활동' },
  { id: 'comment', label: '댓글' },
]

/**
 * Right-side drawer listing the last 50 notifications. Categories are
 * filterable; rows are clickable (mark-read + navigate to `/docs/<slug>`).
 */
export function NotificationDrawer({ open, onClose }: NotificationDrawerProps) {
  const items = useNotificationsStore((s) => s.items)
  const markRead = useNotificationsStore((s) => s.markRead)
  const markAllRead = useNotificationsStore((s) => s.markAllRead)
  const clear = useNotificationsStore((s) => s.clear)
  const [filter, setFilter] = useState<Filter>('all')

  const filtered = useMemo(() => {
    const list = Array.isArray(items) ? items : []
    if (filter === 'all') return list
    return list.filter((it) => it && it.category === filter)
  }, [items, filter])

  const hasUnread = useMemo(
    () => (Array.isArray(items) ? items : []).some((it) => it && !it.read),
    [items],
  )

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
    const unreadServerIds = (Array.isArray(items) ? items : [])
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
    <Drawer open={open} onClose={onClose} side="right" ariaLabel="알림 센터">
      <div className="flex h-full flex-col">
        <header className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <h2 className="text-base font-semibold text-smsg-900">알림</h2>
          <button
            type="button"
            aria-label="닫기"
            onClick={onClose}
            className="rounded p-1 text-gray-500 hover:bg-gray-100"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M3.7 3.7l8.6 8.6M12.3 3.7l-8.6 8.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="flex flex-wrap items-center gap-1.5 border-b border-gray-200 bg-white px-4 py-2">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={cn(
                'rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors',
                filter === f.id
                  ? 'border-smsg-700 bg-smsg-700 text-white'
                  : 'border-gray-300 bg-white text-gray-700 hover:border-smsg-300',
              )}
            >
              {f.label}
            </button>
          ))}
          <span className="ml-auto flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleMarkAllRead}
              disabled={!hasUnread}
              data-testid="bell-mark-all"
            >
              전체 읽음 처리
            </Button>
            {filtered.length > 0 && (
              <Button type="button" variant="ghost" size="sm" onClick={() => clear()}>
                전체 지우기
              </Button>
            )}
          </span>
        </div>

        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <EmptyState
              title="알림이 없어요"
              description="문서를 저장하거나 댓글이 달리면 여기에 표시돼요."
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
          <span>{categoryLabel(item.category)}</span>
          <span aria-hidden="true">·</span>
          <time dateTime={new Date(item.createdAt).toISOString()}>
            {formatRelative(item.createdAt)}
          </time>
        </p>
      </div>
      {!item.read && (
        <span
          aria-label="읽지 않음"
          className="ml-1 mt-1.5 h-1.5 w-1.5 rounded-full bg-smsg-700"
        />
      )}
    </div>
  )
  if (item.slug) {
    return (
      <li>
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
      </li>
    )
  }
  return (
    <li>
      <button
        type="button"
        onClick={onActivate}
        className="block w-full text-left transition-colors hover:bg-smsg-50"
      >
        {inner}
      </button>
    </li>
  )
}

function toneClass(c: NotificationCategory): string {
  if (c === 'system') return 'bg-amber-500'
  if (c === 'comment') return 'bg-emerald-500'
  return 'bg-smsg-500'
}

function categoryLabel(c: NotificationCategory): string {
  if (c === 'system') return '시스템'
  if (c === 'comment') return '댓글'
  return '활동'
}

/**
 * Server-issued notification rows use a UUID v4 id (36 chars, 4 dashes).
 * Local-only events use the `n-…` prefix from `store.makeId()`.
 */
function isServerId(id: string): boolean {
  return id.length === 36 && id.split('-').length === 5
}

function formatRelative(ts: number, now: number = Date.now()): string {
  if (!Number.isFinite(ts)) return ''
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
