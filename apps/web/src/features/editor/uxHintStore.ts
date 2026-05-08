import { create } from 'zustand'

/**
 * uxHintStore — first-time-only hints for editor affordances.
 *
 * Tracks whether each hint has been shown so we never nag returning users.
 * Persisted to `localStorage` so the dismissal survives across reloads/tabs.
 *
 * Why not piggy-back on the onboarding flag? Hints fire on hover, not on
 * mount, so they need their own life-cycle. Keeping the bookkeeping in a
 * dedicated store keeps the responsibility narrow and easy to test.
 */

export const UX_HINT_STORAGE_KEY = 'mxwp:ux-hints:v1'

/** Currently-tracked hint kinds. New hints just add to this union. */
export type UxHintKind = 'block-affordances' | 'block-resize'

interface UxHintMap {
  /** `true` ⇒ the hint has already been seen and must never be shown again. */
  [k: string]: true
}

export interface UxHintStore {
  shown: UxHintMap
  /** True the first time a hint is requested (auto-marks shown). */
  shouldShow(kind: UxHintKind): boolean
  /** Explicit dismissal — same as `shouldShow` returning `true`, but callable. */
  markShown(kind: UxHintKind): void
  /** Re-read the persisted blob (tests reset by clearing storage + calling this). */
  hydrate(): void
}

function readFromStorage(): UxHintMap {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(UX_HINT_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: UxHintMap = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (v === true) out[k] = true
    }
    return out
  } catch {
    return {}
  }
}

function writeToStorage(map: UxHintMap): void {
  if (typeof window === 'undefined') return
  try {
    if (Object.keys(map).length === 0) {
      window.localStorage.removeItem(UX_HINT_STORAGE_KEY)
    } else {
      window.localStorage.setItem(UX_HINT_STORAGE_KEY, JSON.stringify(map))
    }
  } catch {
    /* swallow — quota / private mode */
  }
}

export const useUxHintStore = create<UxHintStore>((set, get) => ({
  shown: readFromStorage(),

  shouldShow: (kind) => {
    const cur = get().shown
    if (cur[kind]) return false
    // Mark as shown synchronously so concurrent components don't both pop.
    const next = { ...cur, [kind]: true as const }
    writeToStorage(next)
    set({ shown: next })
    return true
  },

  markShown: (kind) => {
    const cur = get().shown
    if (cur[kind]) return
    const next = { ...cur, [kind]: true as const }
    writeToStorage(next)
    set({ shown: next })
  },

  hydrate: () => set({ shown: readFromStorage() }),
}))
