import { create } from 'zustand'

/**
 * One row in the "최근 본 문서" history. We keep the title alongside the slug
 * so the rail can render without an extra fetch even when offline.
 */
export interface RecentDoc {
  slug: string
  title: string
  /** Epoch ms when the user opened the doc. */
  viewedAt: number
}

export interface RecentSnapshot {
  items: RecentDoc[]
}

export interface RecentActions {
  /** Insert/refresh an entry; dedupes by slug, caps at 20, sorts DESC. */
  push(slug: string, title: string): void
  /** Remove a single entry. */
  remove(slug: string): void
  /** Wipe everything. */
  clear(): void
  /** Force-load from localStorage (used in tests after manipulating storage). */
  hydrate(): void
}

export const STORAGE_KEY = 'mxwp.recentDocs'
export const MAX_ENTRIES = 20
export const MAX_TITLE_LEN = 200

/** Defensive read — never throws regardless of SSR / quota / parse failure. */
function readFromStorage(): RecentDoc[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    let parsed: unknown
    try {
      parsed = JSON.parse(raw) as unknown
    } catch {
      // Corrupted blob — drop it so the next write replaces cleanly.
      try {
        window.localStorage.removeItem(STORAGE_KEY)
      } catch {
        /* ignore */
      }
      return []
    }
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isRecentDoc).slice(0, MAX_ENTRIES)
  } catch {
    return []
  }
}

/** Defensive write — silently swallows quota / private-mode / SSR errors. */
function writeToStorage(items: RecentDoc[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
  } catch {
    // QuotaExceededError or similar. Try shrinking the payload by half before
    // giving up, so the most recent entries still persist.
    try {
      const half = Math.max(1, Math.floor(items.length / 2))
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, half)))
    } catch {
      /* swallow — quota / private mode */
    }
  }
}

function isRecentDoc(v: unknown): v is RecentDoc {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return (
    typeof o.slug === 'string' &&
    typeof o.title === 'string' &&
    typeof o.viewedAt === 'number' &&
    Number.isFinite(o.viewedAt)
  )
}

export const useRecentStore = create<RecentSnapshot & RecentActions>((set, get) => ({
  items: readFromStorage(),
  push: (slug, title) => {
    if (!slug || typeof slug !== 'string') return
    const safeTitle = (typeof title === 'string' && title ? title : slug).slice(0, MAX_TITLE_LEN)
    const current = Array.isArray(get().items) ? get().items : []
    const next = [
      { slug, title: safeTitle, viewedAt: Date.now() },
      ...current.filter((it) => it && it.slug !== slug),
    ]
      .sort((a, b) => b.viewedAt - a.viewedAt)
      .slice(0, MAX_ENTRIES)
    writeToStorage(next)
    set({ items: next })
  },
  remove: (slug) => {
    if (!slug) return
    const current = Array.isArray(get().items) ? get().items : []
    const next = current.filter((it) => it && it.slug !== slug)
    writeToStorage(next)
    set({ items: next })
  },
  clear: () => {
    writeToStorage([])
    set({ items: [] })
  },
  hydrate: () => set({ items: readFromStorage() }),
}))

/**
 * Convenience used by `DocumentReader` to record a view on mount.
 * Keep titles trimmed to avoid runaway storage entries (e.g. drafts with
 * pasted blobs).
 */
export function pushRecent(slug: string, title: string): void {
  if (!slug || typeof slug !== 'string') return
  const safeTitle = (typeof title === 'string' && title ? title : slug).slice(
    0,
    MAX_TITLE_LEN,
  )
  useRecentStore.getState().push(slug, safeTitle)
}
