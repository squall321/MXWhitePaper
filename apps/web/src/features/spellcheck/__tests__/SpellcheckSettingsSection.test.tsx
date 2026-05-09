import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

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

import { useSpellcheckPrefsStore } from '../preferencesStore'
import { useDictionaryStore } from '../dictionaryStore'
import { SpellcheckSettingsSection } from '../SpellcheckSettingsSection'

function ls(): MemoryStorage {
  return (globalThis as unknown as { window: { localStorage: MemoryStorage } })
    .window.localStorage
}

describe('<SpellcheckSettingsSection />', () => {
  beforeEach(() => {
    ls().clear()
    useSpellcheckPrefsStore.getState().reset()
    useDictionaryStore.getState().clear()
  })

  it('renders the section heading and toggles', () => {
    const html = renderToStaticMarkup(<SpellcheckSettingsSection />)
    expect(html).toContain('맞춤법 검사')
    expect(html).toContain('맞춤법 검사 사용')
    expect(html).toContain('자동 언어 감지')
    expect(html).toContain('settings-toggle-spellcheck')
    expect(html).toContain('settings-toggle-spellcheck-autolang')
  })

  it('renders default toggles as aria-checked="true"', () => {
    const html = renderToStaticMarkup(<SpellcheckSettingsSection />)
    // Both toggles default-on.
    const switches = html.match(/aria-checked="true"/g) ?? []
    expect(switches.length).toBeGreaterThanOrEqual(2)
  })

  it('shows empty-state when the dict has no words', () => {
    const html = renderToStaticMarkup(<SpellcheckSettingsSection />)
    expect(html).toContain('아직 등록된 단어가 없습니다.')
  })

  it('renders dict words as table rows', () => {
    useDictionaryStore.getState().add('MXWP')
    useDictionaryStore.getState().add('맞춤법')
    const html = renderToStaticMarkup(<SpellcheckSettingsSection />)
    expect(html).toContain('settings-spellcheck-row')
    expect(html).toContain('MXWP')
    expect(html).toContain('맞춤법')
    expect(html).not.toContain('아직 등록된 단어가 없습니다.')
  })

  it('exposes import / export buttons', () => {
    const html = renderToStaticMarkup(<SpellcheckSettingsSection />)
    expect(html).toContain('settings-spellcheck-export')
    expect(html).toContain('settings-spellcheck-import')
    expect(html).toContain('내보내기')
    expect(html).toContain('가져오기')
  })

  it('exposes the add-word input', () => {
    const html = renderToStaticMarkup(<SpellcheckSettingsSection />)
    expect(html).toContain('settings-spellcheck-add-input')
    expect(html).toContain('settings-spellcheck-add-button')
    expect(html).toContain('+ 단어 추가')
  })

  it('reflects toggle state when prefs flipped off', () => {
    useSpellcheckPrefsStore.getState().set('enabled', false)
    const html = renderToStaticMarkup(<SpellcheckSettingsSection />)
    // The top toggle should be aria-checked="false". Attribute ordering
    // varies, so we match the pair within a single <button> tag.
    expect(html).toMatch(
      /<button[^>]*aria-checked="false"[^>]*data-testid="settings-toggle-spellcheck"/,
    )
  })
})

describe('dictionary CRUD via store (SSR-friendly proxy for UI behavior)', () => {
  // Note: the actual button click handlers can't fire under renderToStaticMarkup
  // (no event loop). We test the store delegate the UI uses.
  beforeEach(() => {
    ls().clear()
    useDictionaryStore.getState().clear()
  })

  it('add-then-remove flow', () => {
    useDictionaryStore.getState().add('foo')
    expect(useDictionaryStore.getState().has('foo')).toBe(true)
    useDictionaryStore.getState().remove('foo')
    expect(useDictionaryStore.getState().has('foo')).toBe(false)
  })
})
