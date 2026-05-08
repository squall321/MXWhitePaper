import { create } from 'zustand'

/**
 * sectionCollapseStore — per-document section-collapse state.
 *
 * The whole map is held client-side and persisted to `localStorage` so a user
 * who collapsed §3 yesterday still sees it collapsed on the next visit. We
 * deliberately do NOT push this to the document JSON: collapse is a personal
 * UI preference, not part of the canonical doc.
 *
 * Storage shape:
 *   { [slug]: { [sectionId]: true } }
 *
 * Only `true` is stored — an absent entry means "expanded". This keeps the
 * blob compact and forward-compatible (no need for explicit `false` values).
 */

const STORAGE_KEY = 'mxwp:section-collapse:v1'

type CollapsedMap = Record<string, Record<string, true>>

interface SectionCollapseState {
  /** Reactive snapshot of the persisted map (subscribers re-render on change). */
  map: CollapsedMap
}

export interface SectionCollapseStore extends SectionCollapseState {
  isCollapsed(slug: string, sectionId: string): boolean
  toggle(slug: string, sectionId: string): void
  /** Force a section to a specific state — used by TOC expand-on-click. */
  setCollapsed(slug: string, sectionId: string, collapsed: boolean): void
  /** Drop every collapsed flag for `slug` (reader hits "전체 펴기"). */
  expandAll(slug: string): void
  /**
   * Marks every section in `sectionIds` as collapsed for `slug`. The caller
   * supplies the section list because the store doesn't know about the doc
   * tree. (We only collapse known sections — the WikiArticle bar walks the
   * tree once and forwards the IDs.)
   */
  collapseAll(slug: string, sectionIds: string[]): void
  /** Re-read from localStorage; only used by tests. */
  hydrate(): void
}

function readFromStorage(): CollapsedMap {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: CollapsedMap = {}
    for (const [slug, inner] of Object.entries(parsed as Record<string, unknown>)) {
      if (!inner || typeof inner !== 'object' || Array.isArray(inner)) continue
      const sub: Record<string, true> = {}
      for (const [sid, v] of Object.entries(inner as Record<string, unknown>)) {
        if (v === true) sub[sid] = true
      }
      if (Object.keys(sub).length > 0) out[slug] = sub
    }
    return out
  } catch {
    return {}
  }
}

function writeToStorage(map: CollapsedMap): void {
  if (typeof window === 'undefined') return
  try {
    // Drop empty inner objects so the blob doesn't grow forever.
    const compact: CollapsedMap = {}
    for (const [slug, inner] of Object.entries(map)) {
      if (inner && Object.keys(inner).length > 0) compact[slug] = inner
    }
    if (Object.keys(compact).length === 0) {
      window.localStorage.removeItem(STORAGE_KEY)
    } else {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(compact))
    }
  } catch {
    /* swallow — quota / private mode */
  }
}

export const useSectionCollapseStore = create<SectionCollapseStore>((set, get) => ({
  map: readFromStorage(),

  isCollapsed: (slug, sectionId) => {
    if (!slug || !sectionId) return false
    return get().map[slug]?.[sectionId] === true
  },

  toggle: (slug, sectionId) => {
    if (!slug || !sectionId) return
    const cur = get().map
    const inner = cur[slug] ? { ...cur[slug] } : {}
    if (inner[sectionId]) {
      delete inner[sectionId]
    } else {
      inner[sectionId] = true
    }
    const next: CollapsedMap = { ...cur }
    if (Object.keys(inner).length === 0) delete next[slug]
    else next[slug] = inner
    writeToStorage(next)
    set({ map: next })
  },

  setCollapsed: (slug, sectionId, collapsed) => {
    if (!slug || !sectionId) return
    const cur = get().map
    const inner = cur[slug] ? { ...cur[slug] } : {}
    if (collapsed) inner[sectionId] = true
    else delete inner[sectionId]
    const next: CollapsedMap = { ...cur }
    if (Object.keys(inner).length === 0) delete next[slug]
    else next[slug] = inner
    writeToStorage(next)
    set({ map: next })
  },

  expandAll: (slug) => {
    if (!slug) return
    const cur = get().map
    if (!cur[slug]) return
    const next: CollapsedMap = { ...cur }
    delete next[slug]
    writeToStorage(next)
    set({ map: next })
  },

  collapseAll: (slug, sectionIds) => {
    if (!slug || !Array.isArray(sectionIds) || sectionIds.length === 0) return
    const cur = get().map
    const inner: Record<string, true> = { ...(cur[slug] ?? {}) }
    for (const id of sectionIds) {
      if (typeof id === 'string' && id) inner[id] = true
    }
    const next: CollapsedMap = { ...cur, [slug]: inner }
    writeToStorage(next)
    set({ map: next })
  },

  hydrate: () => set({ map: readFromStorage() }),
}))

/** Test/dev helper — exported separately so production code goes through actions. */
export const SECTION_COLLAPSE_STORAGE_KEY = STORAGE_KEY
