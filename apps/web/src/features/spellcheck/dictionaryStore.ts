import { useSyncExternalStore } from 'react'
import { create } from 'zustand'

/**
 * Personal spellcheck dictionary — words the user has marked as "correct"
 * so the browser's red squiggle should be suppressed for them.
 *
 * Client-only for now: a server-side personal dictionary syncing across
 * devices is a follow-up. Persists to localStorage under
 * `mxwp:spellcheck-dict:v1` so the list survives reloads.
 *
 * Words are stored case-sensitive (Korean has no case anyway and English
 * users may legitimately want different casings — `iOS` vs `ios`).
 * Whitespace is trimmed; empty strings and duplicates are no-ops.
 */
export const STORAGE_KEY = 'mxwp:spellcheck-dict:v1'

export interface DictionaryState {
  words: string[]
  add(word: string): void
  remove(word: string): void
  has(word: string): boolean
  list(): string[]
  hydrate(): void
  clear(): void
}

function readFromStorage(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((w): w is string => typeof w === 'string')
  } catch {
    return []
  }
}

function writeToStorage(words: string[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(words))
  } catch {
    /* swallow — quota / private mode */
  }
}

export const useDictionaryStore = create<DictionaryState>((set, get) => ({
  words: readFromStorage(),
  add: (word) => {
    const w = word.trim()
    if (!w) return
    const cur = get().words
    if (cur.includes(w)) return
    const next = [...cur, w]
    writeToStorage(next)
    set({ words: next })
  },
  remove: (word) => {
    const w = word.trim()
    if (!w) return
    const cur = get().words
    if (!cur.includes(w)) return
    const next = cur.filter((x) => x !== w)
    writeToStorage(next)
    set({ words: next })
  },
  has: (word) => get().words.includes(word.trim()),
  list: () => [...get().words],
  hydrate: () => set({ words: readFromStorage() }),
  clear: () => {
    writeToStorage([])
    set({ words: [] })
  },
}))

/**
 * SSR-aware selector hook. See `useSpellcheckPref` in `preferencesStore.ts`
 * for the rationale — same pattern.
 */
export function useDictionarySelector<T>(selector: (s: DictionaryState) => T): T {
  return useSyncExternalStore(
    useDictionaryStore.subscribe,
    () => selector(useDictionaryStore.getState()),
    () => selector(useDictionaryStore.getState()),
  )
}
