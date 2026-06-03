/**
 * Sprint 6 (G2) — Slicer state coordinator.
 *
 * A `SlicerBlock` (chip group) writes its currently-active values into
 * this store keyed by the slicer's ULID. Other widgets that opt in via
 * `boundSlicers: [...slicerIds]` read the corresponding entries and
 * fold them into their filter pipeline.
 *
 * Why a separate zustand store (not the editor store):
 *   - Slicer state is *transient view state*, not part of the
 *     persisted document. The editor store models the canonical
 *     DocumentJSON snapshot; mixing volatile UI selection into it
 *     would dirty every snapshot for an ephemeral toggle.
 *   - The store is keyed by slicer id (not by the bound widget) so a
 *     single chip group can drive N widgets without re-bookkeeping.
 *
 * Selection rules:
 *   - `multiSelect = false` (default): selecting a value replaces the set
 *     with `[value]`. Selecting the same value again clears the set
 *     ("show everything") rather than locking the user into one chip.
 *   - `multiSelect = true`: clicking a value toggles its membership.
 *   - Empty active set means "no filter" — the bound widget passes raw rows
 *     through unchanged. This matches Excel's pivot slicer "All" state.
 */
import { create } from 'zustand'

interface SlicerState {
  /** id → active value set, expressed as a plain array (Sets don't serialise well). */
  active: Record<string, string[]>
  setSingle: (slicerId: string, value: string | null) => void
  toggle: (slicerId: string, value: string) => void
  clear: (slicerId: string) => void
  setActive: (slicerId: string, values: string[]) => void
  /** Read helper for non-React consumers (e.g. test utilities). */
  getActive: (slicerId: string) => string[]
}

export const useSlicerStore = create<SlicerState>((set, get) => ({
  active: {},
  setSingle: (slicerId, value) => {
    set((s) => {
      const next = { ...s.active }
      if (value === null) delete next[slicerId]
      else next[slicerId] = [value]
      return { active: next }
    })
  },
  toggle: (slicerId, value) => {
    set((s) => {
      const current = s.active[slicerId] ?? []
      const has = current.includes(value)
      const list = has ? current.filter((v) => v !== value) : [...current, value]
      const next = { ...s.active }
      if (list.length === 0) delete next[slicerId]
      else next[slicerId] = list
      return { active: next }
    })
  },
  clear: (slicerId) => {
    set((s) => {
      if (!(slicerId in s.active)) return s
      const next = { ...s.active }
      delete next[slicerId]
      return { active: next }
    })
  },
  setActive: (slicerId, values) => {
    set((s) => {
      const next = { ...s.active }
      if (values.length === 0) delete next[slicerId]
      else next[slicerId] = [...values]
      return { active: next }
    })
  },
  getActive: (slicerId) => get().active[slicerId] ?? [],
}))

/** Selector hook — re-renders only when this slicer's active set changes. */
export function useSlicerActive(slicerId: string | null | undefined): string[] {
  return useSlicerStore((s) => (slicerId ? s.active[slicerId] ?? [] : []))
}
