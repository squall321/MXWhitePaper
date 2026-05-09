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

/**
 * Presentation mode slide transitions. `none` cuts hard, `fade` cross-fades
 * (200ms), `slide-left` translates the next slide in from the right (300ms).
 * Honoured by Presentation.tsx and synced to PresenterView via BroadcastChannel.
 */
export type SlideTransition = 'none' | 'fade' | 'slide-left'

/**
 * Visual theme for the Presentation stage. `light` is the historical default
 * (white background, dark text). `dark` flips to white-on-near-black with the
 * Samsung Blue accent. `bright` is a high-energy Samsung Blue background with
 * white text — useful for launch decks.
 */
export type SlideTheme = 'light' | 'dark' | 'bright'

/** 표시 밀도 — 기본 padding 또는 압축 padding을 선택. */
export type Density = 'comfortable' | 'compact'

/** 본문 글자 크기 배율. `--text-base`에 곱해서 적용. */
export type FontScale = 0.875 | 1 | 1.125 | 1.25

/** 기본 줄간격 토큰. */
export type LineHeight = 'tight' | 'normal' | 'relaxed'

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
  /** Presentation slide transition style. */
  slide_transition: SlideTransition
  /** Presentation visual theme. */
  slide_theme: SlideTheme
  /** Per-block staggered fade-in inside a slide. */
  slide_stagger: boolean
  /** 표시 밀도 — 기본 / 압축. */
  density: Density
  /** 본문 글자 크기 배율. */
  fontScale: FontScale
  /** 줄간격. */
  lineHeight: LineHeight
  /** 고대비 모드 — `data-contrast="high"`를 `<html>`에 적용. */
  highContrast: boolean
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
  slide_transition: 'fade',
  slide_theme: 'light',
  slide_stagger: true,
  density: 'comfortable',
  fontScale: 1,
  lineHeight: 'normal',
  highContrast: false,
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
    slide_transition,
    slide_theme,
    slide_stagger,
    density,
    fontScale,
    lineHeight,
    highContrast,
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
    slide_transition,
    slide_theme,
    slide_stagger,
    density,
    fontScale,
    lineHeight,
    highContrast,
  }
}
