import { create } from 'zustand'

/**
 * One bookmarked document. Title is captured at the time of starring so the
 * 즐겨찾기 drawer can render without a network round-trip.
 */
export interface Favorite {
  slug: string
  title: string
  /** Epoch ms when the user added the bookmark. */
  starredAt: number
}

export interface FavoritesSnapshot {
  items: Favorite[]
}

export interface FavoritesActions {
  /** Add or refresh a bookmark; dedupes by slug. */
  add(slug: string, title: string): void
  /** Remove a bookmark by slug. */
  remove(slug: string): void
  /** Convenience: add when missing, remove when present. */
  toggle(slug: string, title: string): void
  /** True when the slug is currently starred. */
  has(slug: string): boolean
  /** Wipe everything. */
  clear(): void
  /** Force-load from localStorage (used in tests after manipulating storage). */
  hydrate(): void
}

export const STORAGE_KEY = 'mxwp.favorites'
export const MAX_ENTRIES = 200
export const MAX_TITLE_LEN = 200

function readFromStorage(): Favorite[] {
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
    return parsed.filter(isFavorite).slice(0, MAX_ENTRIES)
  } catch {
    return []
  }
}

function writeToStorage(items: Favorite[]): void {
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

function isFavorite(v: unknown): v is Favorite {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return (
    typeof o.slug === 'string' &&
    typeof o.title === 'string' &&
    typeof o.starredAt === 'number' &&
    Number.isFinite(o.starredAt)
  )
}

export const useFavoritesStore = create<FavoritesSnapshot & FavoritesActions>(
  (set, get) => ({
    items: readFromStorage(),
    add: (slug, title) => {
      if (!slug || typeof slug !== 'string') return
      const safeTitle = (typeof title === 'string' && title ? title : slug).slice(
        0,
        MAX_TITLE_LEN,
      )
      const current = Array.isArray(get().items) ? get().items : []
      const next = [
        { slug, title: safeTitle, starredAt: Date.now() },
        ...current.filter((it) => it && it.slug !== slug),
      ].slice(0, MAX_ENTRIES)
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
    toggle: (slug, title) => {
      const has = (get().items ?? []).some((it) => it && it.slug === slug)
      if (has) get().remove(slug)
      else get().add(slug, title)
    },
    has: (slug) => (get().items ?? []).some((it) => it && it.slug === slug),
    clear: () => {
      writeToStorage([])
      set({ items: [] })
    },
    hydrate: () => set({ items: readFromStorage() }),
  }),
)

/** Imperative read for non-React callers. */
export function isFavorited(slug: string): boolean {
  if (!slug) return false
  return useFavoritesStore.getState().has(slug)
}
