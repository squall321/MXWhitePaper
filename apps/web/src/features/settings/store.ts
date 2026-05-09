import { create } from 'zustand'

/**
 * Cosmetic UI preferences. All values currently are client-only — the dark
 * theme tokens exist but the actual toggle is staged for a later sprint, and
 * "알림 / 자동저장 / 코드블록 fade" are wired into nothing yet. They round-trip
 * through localStorage so the toggles in /settings persist across reloads.
 */
/** Tri-state theme preference. `system` follows `prefers-color-scheme`. */
export type ThemeMode = 'light' | 'dark' | 'system'

/** "이메일 알림" 빈도 — 즉시 / 매일 / 매주. BE digest cadence와 키 정렬. */
export type EmailCadence = 'instant' | 'daily' | 'weekly'

export interface UiSettings {
  notifications: boolean
  autoSave: boolean
  codeFade: boolean
  /**
   * Legacy boolean toggle. Kept for back-compat with persisted state and the
   * Quick Settings modal. `themeMode` is the canonical source of truth.
   */
  darkMode: boolean
  /** 'light' | 'dark' | 'system' — applied by the ThemeProvider. */
  themeMode: ThemeMode
  /** UI language. ko default, en secondary. */
  language: 'ko' | 'en'
  /** "다이제스트 이메일 받기" 토글. 기본은 이메일이 있을 때 true. */
  emailDigest: boolean
  /** 디지스트 빈도. 즉시 / 매일 / 매주. */
  emailCadence: EmailCadence
}

export interface SettingsActions {
  set<K extends keyof UiSettings>(key: K, value: UiSettings[K]): void
  reset(): void
  hydrate(): void
}

export const STORAGE_KEY = 'mxwp.uiSettings'

const DEFAULTS: UiSettings = {
  notifications: true,
  autoSave: true,
  codeFade: true,
  darkMode: false,
  themeMode: 'system',
  language: 'ko',
  emailDigest: true,
  emailCadence: 'daily',
}

function readFromStorage(): UiSettings {
  if (typeof window === 'undefined') return { ...DEFAULTS }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULTS }
    const parsed = JSON.parse(raw) as Partial<UiSettings>
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULTS }
    return { ...DEFAULTS, ...parsed }
  } catch {
    return { ...DEFAULTS }
  }
}

function writeToStorage(s: UiSettings): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
  } catch {
    /* swallow — quota / private mode */
  }
}

export const useSettingsStore = create<UiSettings & SettingsActions>((set, get) => ({
  ...readFromStorage(),
  set: (key, value) => {
    const next = { ...get(), [key]: value } as UiSettings
    writeToStorage(stripActions(next))
    set({ [key]: value } as Partial<UiSettings>)
  },
  reset: () => {
    writeToStorage(DEFAULTS)
    set({ ...DEFAULTS })
  },
  hydrate: () => set(readFromStorage()),
}))

function stripActions(o: UiSettings & Partial<SettingsActions>): UiSettings {
  // Avoid persisting function references.
  const {
    notifications,
    autoSave,
    codeFade,
    darkMode,
    themeMode,
    language,
    emailDigest,
    emailCadence,
  } = o
  return {
    notifications,
    autoSave,
    codeFade,
    darkMode,
    themeMode,
    language,
    emailDigest,
    emailCadence,
  }
}
