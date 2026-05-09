import { useSyncExternalStore } from 'react'
import { create } from 'zustand'

/**
 * Spellcheck preference toggles persisted in localStorage. Kept separate
 * from the existing `mxwp.uiSettings` blob so the two features can evolve
 * independently (e.g. server-side dict sync only flips a key here).
 */
export const STORAGE_KEY = 'mxwp:spellcheck-prefs:v1'

export interface SpellcheckPrefs {
  /** Master switch. When false, contentEditables get spellCheck="false". */
  enabled: boolean
  /** Auto-detect lang per block (Hangul → ko, ASCII → en). */
  autoDetectLang: boolean
}

export interface SpellcheckPrefsActions {
  set<K extends keyof SpellcheckPrefs>(key: K, value: SpellcheckPrefs[K]): void
  reset(): void
  hydrate(): void
}

const DEFAULTS: SpellcheckPrefs = {
  enabled: true,
  autoDetectLang: true,
}

function readFromStorage(): SpellcheckPrefs {
  if (typeof window === 'undefined') return { ...DEFAULTS }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULTS }
    const parsed = JSON.parse(raw) as Partial<SpellcheckPrefs>
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULTS }
    return { ...DEFAULTS, ...parsed }
  } catch {
    return { ...DEFAULTS }
  }
}

function writeToStorage(p: SpellcheckPrefs): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(p))
  } catch {
    /* swallow */
  }
}

export const useSpellcheckPrefsStore = create<SpellcheckPrefs & SpellcheckPrefsActions>(
  (set, get) => ({
    ...readFromStorage(),
    set: (key, value) => {
      const next = { ...get(), [key]: value } as SpellcheckPrefs
      writeToStorage(stripActions(next))
      set({ [key]: value } as Partial<SpellcheckPrefs>)
    },
    reset: () => {
      writeToStorage(DEFAULTS)
      set({ ...DEFAULTS })
    },
    hydrate: () => set(readFromStorage()),
  }),
)

function stripActions(o: SpellcheckPrefs & Partial<SpellcheckPrefsActions>): SpellcheckPrefs {
  const { enabled, autoDetectLang } = o
  return { enabled, autoDetectLang }
}

/**
 * SSR-aware selector hook. Unlike `useSpellcheckPrefsStore(selector)` (which
 * uses zustand v5's default `getInitialState` for the server snapshot and
 * therefore renders stale values during `renderToStaticMarkup`), this variant
 * uses `getState` for both client AND server snapshots so SSR reflects the
 * current store state. The trade-off is intentional: we never hydrate this
 * store from server-rendered HTML, so the "must be deterministic" guarantee
 * only matters for testing.
 */
export function useSpellcheckPref<T>(selector: (s: SpellcheckPrefs) => T): T {
  return useSyncExternalStore(
    useSpellcheckPrefsStore.subscribe,
    () => selector(useSpellcheckPrefsStore.getState()),
    () => selector(useSpellcheckPrefsStore.getState()),
  )
}

/**
 * Pure helper used by `<InlineTextBlockEditor />` to pick a `lang` attribute
 * value. Hangul anywhere → 'ko' (covers mixed Korean+English contexts).
 * Pure ASCII letters → 'en'. Anything else (no letters at all, only digits,
 * other scripts) falls through to 'ko' — matches the UI default and avoids
 * the browser flagging brand names like "MX" as misspelled English words.
 */
export function detectLang(text: string): 'ko' | 'en' {
  if (/[가-힣]/.test(text)) return 'ko'
  // No Hangul at all. If we see any ASCII letter, treat as English.
  if (/[A-Za-z]/.test(text)) return 'en'
  return 'ko'
}
