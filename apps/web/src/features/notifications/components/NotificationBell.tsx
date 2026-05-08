import { useState } from 'react'
import { useNotificationsStore } from '../store'
import { NotificationDrawer } from './NotificationDrawer'

/**
 * Bell icon for the TopBar. Shows an unread badge that disappears once
 * `markAllRead()` runs (via the drawer button or per-row click).
 */
export function NotificationBell() {
  const unread = useNotificationsStore((s) => s.unread)
  const [open, setOpen] = useState(false)
  const label = unread > 0 ? `알림 ${unread}건` : '알림'

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid="topbar-bell"
        className="relative grid h-9 w-9 place-items-center rounded-md text-white/90 transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:shadow-focus"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M6 8a6 6 0 1112 0v3.5l1.6 2.4a1 1 0 01-.83 1.55H5.23a1 1 0 01-.83-1.55L6 11.5V8z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path
            d="M9.5 17.5a2.5 2.5 0 005 0"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
        {unread > 0 && (
          <span
            data-testid="topbar-bell-badge"
            className="absolute -right-0.5 -top-0.5 grid h-4 min-w-[1rem] place-items-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white shadow-sm"
            aria-hidden="true"
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      <NotificationDrawer open={open} onClose={() => setOpen(false)} />
    </>
  )
}
