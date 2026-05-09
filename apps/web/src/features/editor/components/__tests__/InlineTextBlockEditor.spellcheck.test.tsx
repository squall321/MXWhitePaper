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

import { useSpellcheckPrefsStore } from '@/features/spellcheck/preferencesStore'
import { InlineTextBlockEditor } from '../InlineTextBlockEditor'
import type { Slug, Ulid } from '@/types/document'

const SLUG = 'demo' as Slug
const BLOCK = '01J0000000000000000000ABCD' as Ulid

function ls(): MemoryStorage {
  return (globalThis as unknown as { window: { localStorage: MemoryStorage } })
    .window.localStorage
}

function render(text: string): string {
  return renderToStaticMarkup(
    <InlineTextBlockEditor
      slug={SLUG}
      blockId={BLOCK}
      blockType="paragraph"
      initialText={text}
    />,
  )
}

describe('<InlineTextBlockEditor /> — spellcheck + lang attrs', () => {
  beforeEach(() => {
    ls().clear()
    useSpellcheckPrefsStore.getState().reset()
  })

  it('Hangul text → lang="ko"', () => {
    const html = render('안녕하세요')
    expect(html).toMatch(/lang="ko"/)
  })

  it('ASCII text → lang="en"', () => {
    const html = render('hello world')
    expect(html).toMatch(/lang="en"/)
  })

  it('mixed Hangul+English → lang="ko"', () => {
    const html = render('Hello 안녕')
    expect(html).toMatch(/lang="ko"/)
  })

  it('default spellCheck attribute is true', () => {
    const html = render('hello')
    // React serializes spellCheck → spellcheck="true"
    expect(html).toMatch(/spellcheck="true"/i)
  })

  it('per-call spellCheck={false} prop overrides default', () => {
    const html = renderToStaticMarkup(
      <InlineTextBlockEditor
        slug={SLUG}
        blockId={BLOCK}
        blockType="paragraph"
        initialText="hello"
        spellCheck={false}
      />,
    )
    expect(html).toMatch(/spellcheck="false"/i)
  })

  it('global pref disable forces spellcheck="false"', () => {
    useSpellcheckPrefsStore.getState().set('enabled', false)
    const html = render('hello')
    expect(html).toMatch(/spellcheck="false"/i)
  })

  it('autoDetectLang=false omits the lang attribute', () => {
    useSpellcheckPrefsStore.getState().set('autoDetectLang', false)
    const html = render('hello world')
    // No lang= attribute on the contenteditable div.
    expect(html).not.toMatch(/<div[^>]*lang="/)
  })

  it('renders empty content with the default lang heuristic', () => {
    // Empty initialText falls through detectLang's "no letters" branch → ko.
    const html = render('')
    expect(html).toMatch(/lang="ko"/)
  })

  it('keeps the contentEditable role+attrs intact alongside spellcheck', () => {
    const html = render('hello')
    expect(html).toContain('contenteditable="true"')
    expect(html).toContain('role="textbox"')
  })
})
