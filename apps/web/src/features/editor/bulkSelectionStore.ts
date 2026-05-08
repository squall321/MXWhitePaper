import { create } from 'zustand'

/**
 * bulkSelectionStore — pure in-memory selection of block IDs for bulk
 * operations (delete / duplicate / move-to-section / copy-to-clipboard).
 *
 * Deliberately NOT persisted: selection is an ephemeral UI state — when the
 * user navigates away or hits Esc the selection should evaporate. That
 * differs from `sectionCollapseStore` which DOES survive navigation.
 *
 * Consumers:
 *   - `SimpleStackEditor` adds/removes block IDs as the user clicks
 *     checkboxes (or shift-clicks a range, ctrl/cmd-clicks one).
 *   - `BulkActionsBar` reads `selected` and shows the action buttons.
 *
 * The store does NOT validate that the IDs still exist in the document —
 * stale IDs simply become no-ops in the action handlers.
 */
interface BulkSelectionState {
  selected: Set<string>
}

export interface BulkSelectionStore extends BulkSelectionState {
  /** Flip membership of a single block id. */
  toggle(blockId: string): void
  /** Replace the selection with `ids` (used for shift-click range select). */
  setMany(ids: string[]): void
  /** Drop everything. */
  clear(): void
  /** Cheap subscription-friendly check. */
  isSelected(id: string): boolean
  /** Current count. */
  size(): number
}

export const useBulkSelectionStore = create<BulkSelectionStore>((set, get) => ({
  selected: new Set<string>(),

  toggle: (blockId) => {
    if (!blockId) return
    const next = new Set(get().selected)
    if (next.has(blockId)) next.delete(blockId)
    else next.add(blockId)
    set({ selected: next })
  },

  setMany: (ids) => {
    if (!Array.isArray(ids)) return
    const next = new Set<string>()
    for (const id of ids) {
      if (typeof id === 'string' && id) next.add(id)
    }
    set({ selected: next })
  },

  clear: () => {
    if (get().selected.size === 0) return
    set({ selected: new Set<string>() })
  },

  isSelected: (id) => get().selected.has(id),

  size: () => get().selected.size,
}))
