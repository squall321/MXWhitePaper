import { create } from 'zustand'

/**
 * bulkDocStore — ephemeral, in-memory selection of document slugs for
 * the admin "bulk doc operations" flow (move / tag / transition / delete).
 *
 * Mirrors the editor `bulkSelectionStore` pattern but operates on slugs
 * instead of block IDs. Deliberately NOT persisted (admins reorganizing many
 * docs want the selection cleared when they navigate away).
 *
 * Consumers:
 *   - List pages (Recent, TagPage, SearchResults, ReadList) toggle slugs
 *     when the admin clicks a row checkbox.
 *   - `BulkDocActionsBar` reads the selection size to render the floating
 *     bottom bar with action buttons.
 *
 * The store does NOT validate that slugs still exist on the server — stale
 * slugs just produce per-slug `errors[]` from POST /admin/bulk-docs.
 */
interface BulkDocState {
  selected: Set<string>
}

export interface BulkDocStore extends BulkDocState {
  /** Flip membership of a single slug. */
  toggle(slug: string): void
  /** Replace the selection with `slugs`. */
  setMany(slugs: string[]): void
  /** Drop everything. */
  clear(): void
  /** Subscribable membership probe. */
  isSelected(slug: string): boolean
  /** Current count. */
  size(): number
}

export const useBulkDocStore = create<BulkDocStore>((set, get) => ({
  selected: new Set<string>(),

  toggle: (slug) => {
    if (!slug) return
    const next = new Set(get().selected)
    if (next.has(slug)) next.delete(slug)
    else next.add(slug)
    set({ selected: next })
  },

  setMany: (slugs) => {
    if (!Array.isArray(slugs)) return
    const next = new Set<string>()
    for (const s of slugs) {
      if (typeof s === 'string' && s) next.add(s)
    }
    set({ selected: next })
  },

  clear: () => {
    if (get().selected.size === 0) return
    set({ selected: new Set<string>() })
  },

  isSelected: (slug) => get().selected.has(slug),

  size: () => get().selected.size,
}))
