import { create } from 'zustand'

/**
 * One toast-equivalent event surfaced into the bell drawer.
 * Categories let us group entries: 시스템 (boot / network) / 활동 (saves /
 * uploads) / 댓글 (Phase 4 placeholder).
 */
export type NotificationCategory = 'system' | 'activity' | 'comment'

export interface NotificationItem {
  /** Stable id used as React key + dedupe target. */
  id: string
  /** Korean message rendered in the drawer row. */
  message: string
  /** Optional auxiliary text (slug, anchor, …). */
  detail?: string
  /** Slug → click navigates to the doc reader. */
  slug?: string
  category: NotificationCategory
  /** Epoch ms when the event happened. */
  createdAt: number
  /** Persisted unread flag — flips on click or "전체 읽음 처리". */
  read: boolean
}

export interface NotificationsSnapshot {
  items: NotificationItem[]
  /** Cached unread count. Recomputed on every mutation. */
  unread: number
}

export interface NotificationsActions {
  /** Push a new event. Auto-trims to MAX_ENTRIES (50). */
  push(input: Omit<NotificationItem, 'id' | 'createdAt' | 'read'> & {
    id?: string
    createdAt?: number
    read?: boolean
  }): NotificationItem
  /** Mark a single notification read. */
  markRead(id: string): void
  /** Mark every notification read. */
  markAllRead(): void
  /** Wipe everything. */
  clear(): void
  /** Force-load from localStorage (used by tests). */
  hydrate(): void
}

export const STORAGE_KEY = 'mxwp.notifications'
export const MAX_ENTRIES = 50
export const MAX_MSG_LEN = 280

function readFromStorage(): NotificationItem[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    let parsed: unknown
    try {
      parsed = JSON.parse(raw) as unknown
    } catch {
      try {
        window.localStorage.removeItem(STORAGE_KEY)
      } catch {
        /* ignore */
      }
      return []
    }
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isNotificationItem).slice(0, MAX_ENTRIES)
  } catch {
    return []
  }
}

function writeToStorage(items: NotificationItem[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
  } catch {
    try {
      const half = Math.max(1, Math.floor(items.length / 2))
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, half)))
    } catch {
      /* swallow — quota / private mode */
    }
  }
}

function isNotificationItem(v: unknown): v is NotificationItem {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return (
    typeof o.id === 'string' &&
    typeof o.message === 'string' &&
    typeof o.createdAt === 'number' &&
    Number.isFinite(o.createdAt) &&
    (o.category === 'system' || o.category === 'activity' || o.category === 'comment') &&
    typeof o.read === 'boolean'
  )
}

function makeId(): string {
  return `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function countUnread(items: NotificationItem[]): number {
  let n = 0
  for (const it of items) if (it && !it.read) n += 1
  return n
}

export const useNotificationsStore = create<NotificationsSnapshot & NotificationsActions>(
  (set, get) => {
    const initial = readFromStorage()
    return {
      items: initial,
      unread: countUnread(initial),
      push: (input) => {
        const safeMessage = String(input.message ?? '').slice(0, MAX_MSG_LEN)
        if (!safeMessage) {
          // Refuse the empty event but keep state stable.
          const placeholder: NotificationItem = {
            id: input.id ?? makeId(),
            message: '',
            category: input.category,
            createdAt: input.createdAt ?? Date.now(),
            read: input.read ?? false,
          }
          return placeholder
        }
        const next: NotificationItem = {
          id: input.id ?? makeId(),
          message: safeMessage,
          detail: input.detail ? String(input.detail).slice(0, MAX_MSG_LEN) : undefined,
          slug: input.slug,
          category: input.category,
          createdAt: input.createdAt ?? Date.now(),
          read: input.read ?? false,
        }
        const current = Array.isArray(get().items) ? get().items : []
        const items = [next, ...current.filter((it) => it && it.id !== next.id)].slice(0, MAX_ENTRIES)
        writeToStorage(items)
        set({ items, unread: countUnread(items) })
        return next
      },
      markRead: (id) => {
        if (!id) return
        const current = Array.isArray(get().items) ? get().items : []
        let changed = false
        const items = current.map((it) => {
          if (!it || it.id !== id || it.read) return it
          changed = true
          return { ...it, read: true }
        })
        if (!changed) return
        writeToStorage(items)
        set({ items, unread: countUnread(items) })
      },
      markAllRead: () => {
        const current = Array.isArray(get().items) ? get().items : []
        if (current.every((it) => !it || it.read)) return
        const items = current.map((it) => (it && !it.read ? { ...it, read: true } : it))
        writeToStorage(items)
        set({ items, unread: 0 })
      },
      clear: () => {
        writeToStorage([])
        set({ items: [], unread: 0 })
      },
      hydrate: () => {
        const items = readFromStorage()
        set({ items, unread: countUnread(items) })
      },
    }
  },
)

/** Imperative helper used outside React (autosave, finalize, boot, …). */
export function pushNotification(
  input: Omit<NotificationItem, 'id' | 'createdAt' | 'read'> & {
    id?: string
    createdAt?: number
    read?: boolean
  },
): NotificationItem {
  return useNotificationsStore.getState().push(input)
}
