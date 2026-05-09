import {
  describe,
  it,
  expect,
  beforeEach,
  beforeAll,
  afterAll,
} from 'vitest'

class MemoryStorage {
  private data = new Map<string, string>()
  getItem(k: string): string | null {
    return this.data.has(k) ? this.data.get(k)! : null
  }
  setItem(k: string, v: string): void {
    this.data.set(k, String(v))
  }
  removeItem(k: string): void {
    this.data.delete(k)
  }
  clear(): void {
    this.data.clear()
  }
  key(i: number): string | null {
    return Array.from(this.data.keys())[i] ?? null
  }
  get length(): number {
    return this.data.size
  }
}

const originalWindow = (globalThis as { window?: unknown }).window

beforeAll(() => {
  ;(globalThis as { window?: unknown }).window = {
    localStorage: new MemoryStorage(),
  }
})

afterAll(() => {
  if (originalWindow === undefined) {
    delete (globalThis as { window?: unknown }).window
  } else {
    ;(globalThis as { window?: unknown }).window = originalWindow
  }
})

import {
  useSettingsStore,
  STORAGE_KEY,
  DEFAULT_NOTIFICATION_PREFS,
  NOTIFICATION_KINDS,
  mergeNotificationPrefs,
} from '../store'

describe('settings/store — notification_prefs', () => {
  beforeEach(() => {
    ;(
      globalThis as unknown as { window: { localStorage: MemoryStorage } }
    ).window.localStorage.clear()
    useSettingsStore.getState().reset()
  })

  it('exposes the documented default matrix', () => {
    const s = useSettingsStore.getState()
    expect(s.notification_prefs.comment_mention).toEqual({
      in_app: true,
      email: true,
    })
    expect(s.notification_prefs.review_request).toEqual({
      in_app: true,
      email: true,
    })
    expect(s.notification_prefs.review_decision).toEqual({
      in_app: true,
      email: false,
    })
    expect(s.notification_prefs.subscription_event).toEqual({
      in_app: true,
      email: false,
    })
    expect(s.notification_prefs.subscription_digest).toEqual({
      in_app: true,
      email: true,
    })
  })

  it('the exported DEFAULT matrix matches the live store defaults', () => {
    expect(useSettingsStore.getState().notification_prefs).toEqual(
      DEFAULT_NOTIFICATION_PREFS,
    )
  })

  it('setNotificationPref toggles one cell and persists the new blob', () => {
    useSettingsStore.getState().setNotificationPref(
      'comment_mention',
      'email',
      false,
    )
    const s = useSettingsStore.getState()
    expect(s.notification_prefs.comment_mention.email).toBe(false)
    // Other cells untouched.
    expect(s.notification_prefs.comment_mention.in_app).toBe(true)
    expect(s.notification_prefs.review_request.email).toBe(true)
    const raw = (
      globalThis as unknown as { window: { localStorage: MemoryStorage } }
    ).window.localStorage.getItem(STORAGE_KEY)
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw!) as {
      notification_prefs: { comment_mention: { email: boolean } }
    }
    expect(parsed.notification_prefs.comment_mention.email).toBe(false)
  })

  it('setAllNotificationPrefs(false) flips every channel off', () => {
    useSettingsStore.getState().setAllNotificationPrefs(false)
    const s = useSettingsStore.getState()
    for (const kind of NOTIFICATION_KINDS) {
      expect(s.notification_prefs[kind].in_app).toBe(false)
      expect(s.notification_prefs[kind].email).toBe(false)
    }
  })

  it('setAllNotificationPrefs(true) flips every channel on', () => {
    useSettingsStore.getState().setAllNotificationPrefs(false)
    useSettingsStore.getState().setAllNotificationPrefs(true)
    const s = useSettingsStore.getState()
    for (const kind of NOTIFICATION_KINDS) {
      expect(s.notification_prefs[kind].in_app).toBe(true)
      expect(s.notification_prefs[kind].email).toBe(true)
    }
  })

  it('replaceNotificationPrefs with a partial blob fills missing keys with defaults', () => {
    useSettingsStore.getState().replaceNotificationPrefs({
      comment_mention: { in_app: false, email: false },
      // others omitted
    } as never)
    const s = useSettingsStore.getState()
    expect(s.notification_prefs.comment_mention).toEqual({
      in_app: false,
      email: false,
    })
    // review_request fell through to its default (true / true).
    expect(s.notification_prefs.review_request).toEqual({
      in_app: true,
      email: true,
    })
  })

  it('reset() restores the default prefs matrix', () => {
    useSettingsStore.getState().setAllNotificationPrefs(false)
    useSettingsStore.getState().reset()
    expect(useSettingsStore.getState().notification_prefs).toEqual(
      DEFAULT_NOTIFICATION_PREFS,
    )
  })

  it('hydrate() rehydrates prefs from a partial localStorage blob', () => {
    const ls = (
      globalThis as unknown as { window: { localStorage: MemoryStorage } }
    ).window.localStorage
    ls.setItem(
      STORAGE_KEY,
      JSON.stringify({
        notification_prefs: {
          subscription_digest: { in_app: false, email: false },
        },
      }),
    )
    useSettingsStore.getState().hydrate()
    const s = useSettingsStore.getState()
    expect(s.notification_prefs.subscription_digest).toEqual({
      in_app: false,
      email: false,
    })
    // Untouched key keeps its default.
    expect(s.notification_prefs.comment_mention).toEqual({
      in_app: true,
      email: true,
    })
  })

  it('mergeNotificationPrefs ignores unknown kinds and bad types', () => {
    const merged = mergeNotificationPrefs({
      comment_mention: { in_app: false, email: 'nope' as unknown as boolean },
      // @ts-expect-error — testing junk input.
      bogus_kind: { in_app: true, email: true },
    })
    expect(merged.comment_mention.in_app).toBe(false)
    // Bad type fell through to default (true).
    expect(merged.comment_mention.email).toBe(true)
    // Unknown kind dropped — merged shape only contains known kinds.
    expect(Object.keys(merged).sort()).toEqual([...NOTIFICATION_KINDS].sort())
  })
})
