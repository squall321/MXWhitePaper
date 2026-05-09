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

/**
 * Cycle 0019 — per-event-per-channel notification toggles. Mirrors the BE
 * `users.notification_prefs` JSONB column and the kinds whitelist in
 * `apps/api/app/services/notification_prefs.py`.
 */
export type NotificationKind =
  | 'comment_mention'
  | 'review_request'
  | 'review_decision'
  | 'subscription_event'
  | 'subscription_digest'

export type NotificationChannel = 'in_app' | 'email'

export interface ChannelPrefs {
  in_app: boolean
  email: boolean
}

export type NotificationPrefs = Record<NotificationKind, ChannelPrefs>

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
  /** Per-event-per-channel notification toggles (Cycle 0019). */
  notification_prefs: NotificationPrefs
}

/** Default prefs matrix — kept in sync with BE `notification_prefs.DEFAULTS`. */
export const NOTIFICATION_KINDS: NotificationKind[] = [
  'comment_mention',
  'review_request',
  'review_decision',
  'subscription_event',
  'subscription_digest',
]

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  comment_mention: { in_app: true, email: true },
  review_request: { in_app: true, email: true },
  review_decision: { in_app: true, email: false },
  subscription_event: { in_app: true, email: false },
  subscription_digest: { in_app: true, email: true },
}

function cloneDefaultNotificationPrefs(): NotificationPrefs {
  return {
    comment_mention: { ...DEFAULT_NOTIFICATION_PREFS.comment_mention },
    review_request: { ...DEFAULT_NOTIFICATION_PREFS.review_request },
    review_decision: { ...DEFAULT_NOTIFICATION_PREFS.review_decision },
    subscription_event: { ...DEFAULT_NOTIFICATION_PREFS.subscription_event },
    subscription_digest: { ...DEFAULT_NOTIFICATION_PREFS.subscription_digest },
  }
}

/** Coerce an arbitrary partial blob into a full prefs map (defaults filled). */
export function mergeNotificationPrefs(
  partial: Partial<Record<NotificationKind, Partial<ChannelPrefs>>> | undefined,
): NotificationPrefs {
  const out = cloneDefaultNotificationPrefs()
  if (!partial || typeof partial !== 'object') return out
  for (const kind of NOTIFICATION_KINDS) {
    const kv = partial[kind]
    if (!kv || typeof kv !== 'object') continue
    if (typeof kv.in_app === 'boolean') out[kind].in_app = kv.in_app
    if (typeof kv.email === 'boolean') out[kind].email = kv.email
  }
  return out
}

export interface SettingsActions {
  set<K extends keyof UiSettings>(key: K, value: UiSettings[K]): void
  reset(): void
  hydrate(): void
  /** Toggle a single (kind, channel) cell. */
  setNotificationPref(
    kind: NotificationKind,
    channel: NotificationChannel,
    value: boolean,
  ): void
  /** Bulk set every (kind, channel) cell to the same boolean. */
  setAllNotificationPrefs(value: boolean): void
  /** Replace the whole prefs blob (used after a server hydrate). */
  replaceNotificationPrefs(next: NotificationPrefs): void
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
  notification_prefs: cloneDefaultNotificationPrefs(),
}

function readFromStorage(): UiSettings {
  if (typeof window === 'undefined')
    return { ...DEFAULTS, notification_prefs: cloneDefaultNotificationPrefs() }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw)
      return {
        ...DEFAULTS,
        notification_prefs: cloneDefaultNotificationPrefs(),
      }
    const parsed = JSON.parse(raw) as Partial<UiSettings>
    if (!parsed || typeof parsed !== 'object')
      return {
        ...DEFAULTS,
        notification_prefs: cloneDefaultNotificationPrefs(),
      }
    return {
      ...DEFAULTS,
      ...parsed,
      // Merge nested prefs with defaults so a partial persisted blob doesn't
      // wipe newly-added kinds.
      notification_prefs: mergeNotificationPrefs(parsed.notification_prefs),
    }
  } catch {
    return { ...DEFAULTS, notification_prefs: cloneDefaultNotificationPrefs() }
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
    const fresh: UiSettings = {
      ...DEFAULTS,
      notification_prefs: cloneDefaultNotificationPrefs(),
    }
    writeToStorage(fresh)
    set(fresh)
  },
  hydrate: () => set(readFromStorage()),
  setNotificationPref: (kind, channel, value) => {
    const cur = get().notification_prefs
    const next: NotificationPrefs = {
      ...cur,
      [kind]: { ...cur[kind], [channel]: value },
    }
    const merged = { ...get(), notification_prefs: next } as UiSettings
    writeToStorage(stripActions(merged))
    set({ notification_prefs: next })
  },
  setAllNotificationPrefs: (value) => {
    const next = cloneDefaultNotificationPrefs()
    for (const kind of NOTIFICATION_KINDS) {
      next[kind] = { in_app: value, email: value }
    }
    const merged = { ...get(), notification_prefs: next } as UiSettings
    writeToStorage(stripActions(merged))
    set({ notification_prefs: next })
  },
  replaceNotificationPrefs: (next) => {
    // Defensively merge against defaults so a malformed server payload can't
    // strand the UI without a kind.
    const safe = mergeNotificationPrefs(next)
    const merged = { ...get(), notification_prefs: safe } as UiSettings
    writeToStorage(stripActions(merged))
    set({ notification_prefs: safe })
  },
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
    notification_prefs,
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
    notification_prefs,
  }
}
