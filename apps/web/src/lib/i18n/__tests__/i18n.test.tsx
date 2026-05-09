import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { t, useT, useLocale } from '../index'
import { ko } from '../ko'
import { en } from '../en'
import { useSettingsStore } from '@/features/settings/store'

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

describe('i18n.t()', () => {
  it('returns the Korean string by default', () => {
    expect(t('settings.title')).toBe('환경설정')
  })

  it('returns the English string when explicitly asked', () => {
    expect(t('settings.title', undefined, 'en')).toBe('Settings')
  })

  it('falls back to Korean when a key is missing in English', () => {
    // Force a hole in the English table — substitute via cast.
    const enAny = en as unknown as Record<string, string | undefined>
    const saved = enAny['settings.title']
    enAny['settings.title'] = undefined
    try {
      expect(t('settings.title', undefined, 'en')).toBe('환경설정')
    } finally {
      enAny['settings.title'] = saved
    }
  })

  it('substitutes {param} placeholders', () => {
    const koAny = ko as unknown as Record<string, string>
    const KEY = '__test.greet'
    koAny[KEY] = '안녕하세요, {name}님!'
    try {
      expect(t(KEY, { name: '구건모' })).toBe('안녕하세요, 구건모님!')
    } finally {
      delete koAny[KEY]
    }
  })

  it('returns the key itself when missing in both tables', () => {
    expect(t('totally.unknown.key')).toBe('totally.unknown.key')
  })

  it('every English key has a matching Korean key', () => {
    for (const k of Object.keys(en)) {
      expect((ko as Record<string, unknown>)[k]).toBeDefined()
    }
  })

  it('key counts match between ko and en (no orphans)', () => {
    const koKeys = Object.keys(ko).sort()
    const enKeys = Object.keys(en).sort()
    expect(enKeys).toEqual(koKeys)
  })

  it('bundle has at least 350 keys after the cycle 7 extraction', () => {
    expect(Object.keys(ko).length).toBeGreaterThanOrEqual(350)
  })

  it('namespace coverage — editor.* keys span every block', () => {
    const editorKeys = Object.keys(ko).filter((k) => k.startsWith('editor.'))
    expect(editorKeys.length).toBeGreaterThan(150)
    // Spot-check a key from every block we extracted in cycle 7.
    const namespaces = [
      'editor.table.',
      'editor.code.',
      'editor.callout.',
      'editor.video.',
      'editor.iframe.',
      'editor.file.',
      'editor.docLink.',
      'editor.tabs.',
      'editor.accordion.',
      'editor.columns.',
      'editor.flow.',
      'editor.orgChart.',
      'editor.gantt.',
      'editor.chart.',
      'editor.kpi.',
      'editor.math.',
      'editor.calc.',
      'editor.dataSource.',
      'editor.dashboard.',
      'editor.image.',
      'editor.gallery.',
      'editor.wb.',
    ]
    for (const ns of namespaces) {
      const matches = editorKeys.filter((k) => k.startsWith(ns))
      expect(matches.length).toBeGreaterThan(0)
    }
  })

  it('namespace coverage — page.* keys cover the Recent / AdminDashboard / AdminOrgs / Analytics surfaces', () => {
    const pageKeys = Object.keys(ko).filter((k) => k.startsWith('page.'))
    for (const ns of [
      'page.recent.',
      'page.adminDashboard.',
      'page.adminOrgs.',
      'page.analytics.',
      'page.settings.',
    ]) {
      const matches = pageKeys.filter((k) => k.startsWith(ns))
      expect(matches.length).toBeGreaterThan(0)
    }
  })
})

describe('i18n hooks (useT / useLocale)', () => {
  it('useT renders the Korean string while the store language is ko', () => {
    useSettingsStore.getState().reset()
    let probe = ''
    function ProbeKo() {
      const tt = useT()
      probe = tt('settings.title')
      return null
    }
    renderToStaticMarkup(<ProbeKo />)
    expect(probe).toBe('환경설정')
    useSettingsStore.getState().reset()
  })

  it('useLocale exposes both `locale` and a bound `t`', () => {
    useSettingsStore.getState().reset()
    let pair: { locale: string; greeting: string } = { locale: '', greeting: '' }
    function Probe() {
      const { locale, t: tt } = useLocale()
      pair = { locale, greeting: tt('common.close') }
      return null
    }
    renderToStaticMarkup(<Probe />)
    expect(pair.locale).toBe('ko')
    expect(pair.greeting).toBe('닫기')
  })

  it('imperative t() picks up live store language changes', () => {
    // SSR-friendly path: imperative t() reads useSettingsStore.getState()
    // directly so it sees mutations that don't propagate through
    // useSyncExternalStore on the server.
    useSettingsStore.getState().set('language', 'en')
    expect(t('settings.title')).toBe('Settings')
    useSettingsStore.getState().reset()
    expect(t('settings.title')).toBe('환경설정')
  })
})
