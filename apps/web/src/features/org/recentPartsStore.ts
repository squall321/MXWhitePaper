import { create } from 'zustand'

/**
 * One row in "최근 본 파트". We hold the part name + its tree path so the
 * pinned section can render without re-walking the tree.
 */
export interface RecentPart {
  id: string
  slug: string
  name: string
  /** Breadcrumb e.g. "MX 사업부 / 개발실 / HE팀 / CAE그룹" */
  path?: string
  visitedAt: number
}

export interface RecentPartsSnapshot {
  items: RecentPart[]
}

export interface RecentPartsActions {
  push(part: { id: string; slug: string; name: string; path?: string }): void
  remove(id: string): void
  clear(): void
  hydrate(): void
}

export const STORAGE_KEY = 'mxwp.recentParts'
export const MAX_ENTRIES = 8

function readFromStorage(): RecentPart[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isRecentPart).slice(0, MAX_ENTRIES)
  } catch {
    return []
  }
}

function writeToStorage(items: RecentPart[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
  } catch {
    /* ignore */
  }
}

function isRecentPart(v: unknown): v is RecentPart {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return (
    typeof o.id === 'string' &&
    typeof o.slug === 'string' &&
    typeof o.name === 'string' &&
    typeof o.visitedAt === 'number' &&
    Number.isFinite(o.visitedAt)
  )
}

export const useRecentPartsStore = create<RecentPartsSnapshot & RecentPartsActions>(
  (set, get) => ({
    items: readFromStorage(),
    push: (part) => {
      if (!part || !part.id) return
      const current = Array.isArray(get().items) ? get().items : []
      const next: RecentPart[] = [
        { ...part, visitedAt: Date.now() },
        ...current.filter((it) => it && it.id !== part.id),
      ].slice(0, MAX_ENTRIES)
      writeToStorage(next)
      set({ items: next })
    },
    remove: (id) => {
      const current = Array.isArray(get().items) ? get().items : []
      const next = current.filter((it) => it && it.id !== id)
      writeToStorage(next)
      set({ items: next })
    },
    clear: () => {
      writeToStorage([])
      set({ items: [] })
    },
    hydrate: () => set({ items: readFromStorage() }),
  }),
)
