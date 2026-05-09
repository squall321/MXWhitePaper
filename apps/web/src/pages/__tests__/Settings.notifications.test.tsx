import {
  describe,
  it,
  expect,
  beforeEach,
  beforeAll,
  afterAll,
  vi,
} from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'

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

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>(
    'react-router-dom',
  )
  return {
    ...actual,
    useOutletContext: () => ({
      setLeftRail: () => {},
      setRightRail: () => {},
      openPalette: () => {},
    }),
  }
})

// Stub the API helper so the test doesn't fire real HTTP requests on mount.
vi.mock('@/features/settings/notificationPrefsApi', () => ({
  fetchNotificationPrefs: async () => null,
  putNotificationPrefs: async () => null,
}))

import { useSettingsStore } from '@/features/settings/store'
import { SettingsPage } from '../Settings'

function renderSettings(): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={['/settings']}>
      <SettingsPage />
    </MemoryRouter>,
  )
}

describe('<SettingsPage /> notification prefs card', () => {
  beforeEach(() => {
    ;(
      globalThis as unknown as { window: { localStorage: MemoryStorage } }
    ).window.localStorage.clear()
    useSettingsStore.getState().reset()
  })

  it('renders the 알림 card with the documented event labels', () => {
    const html = renderSettings()
    expect(html).toContain('settings-notification-prefs-card')
    expect(html).toContain('settings-notif-prefs-table')
    expect(html).toContain('댓글 멘션')
    expect(html).toContain('리뷰 요청')
    expect(html).toContain('리뷰 결정')
    expect(html).toContain('구독 이벤트')
    expect(html).toContain('구독 다이제스트')
  })

  it('renders header buttons and one switch per (kind, channel)', () => {
    const html = renderSettings()
    expect(html).toContain('settings-notif-prefs-all-on')
    expect(html).toContain('settings-notif-prefs-all-off')
    // 5 kinds × 2 channels = 10 cells.
    for (const kind of [
      'comment_mention',
      'review_request',
      'review_decision',
      'subscription_event',
      'subscription_digest',
    ]) {
      expect(html).toContain(`settings-notif-pref-${kind}-in_app`)
      expect(html).toContain(`settings-notif-pref-${kind}-email`)
    }
  })

  it('renders aria-checked reflecting the default matrix', () => {
    const html = renderSettings()
    // comment_mention.email default is true. aria-checked may come before
    // data-testid in the rendered output, so match either order.
    expect(html).toMatch(
      /aria-checked="true"[^>]*data-testid="settings-notif-pref-comment_mention-email"/,
    )
    // review_decision.email default is false.
    expect(html).toMatch(
      /aria-checked="false"[^>]*data-testid="settings-notif-pref-review_decision-email"/,
    )
  })
})
