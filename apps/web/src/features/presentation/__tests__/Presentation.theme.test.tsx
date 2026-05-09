import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

import type { DocumentJSONV10 } from '@/types/document'
import type { SlideTheme, SlideTransition } from '@/features/settings/store'

/**
 * Verifies the Presentation root applies the right `data-pres-theme` attribute
 * for each theme, that the slide animation wrapper carries the requested
 * `data-pres-transition`, and that the toolbar renders the cycle-buttons.
 *
 * SSR rendering keeps the test fast — the visual prefs surface as static
 * attributes, no useEffect timing involved.
 */

type DocResult = {
  data:
    | undefined
    | { document: DocumentJSONV10; row?: unknown; meta?: unknown }
  isPending: boolean
  isError: boolean
}
const docHolder: { current: DocResult | null } = { current: null }
vi.mock('@/features/document/hooks/useDocument', () => ({
  useDocument: () =>
    docHolder.current ?? { data: undefined, isPending: true, isError: false },
}))

/**
 * Stub the settings store. The real implementation uses
 * `useSyncExternalStore`'s SSR shim which returns the *initial* snapshot — so
 * mutating the store after import has no effect under react-dom/server. A
 * plain selector function dodges that.
 */
const prefHolder: {
  slide_theme: SlideTheme
  slide_transition: SlideTransition
  slide_stagger: boolean
} = {
  slide_theme: 'light',
  slide_transition: 'fade',
  slide_stagger: true,
}
vi.mock('@/features/settings/store', async () => {
  const actual = await vi.importActual<typeof import('@/features/settings/store')>(
    '@/features/settings/store',
  )
  type Selector<T> = (s: typeof prefHolder & { set: (k: string, v: unknown) => void }) => T
  function fakeStore<T>(selector: Selector<T>): T {
    return selector({
      ...prefHolder,
      set: (k: string, v: unknown) => {
        ;(prefHolder as Record<string, unknown>)[k] = v
      },
    })
  }
  return { ...actual, useSettingsStore: fakeStore }
})

class FakeBroadcastChannel {
  static instances: FakeBroadcastChannel[] = []
  name: string
  posted: unknown[] = []
  listeners: Array<(ev: { data: unknown }) => void> = []
  constructor(name: string) {
    this.name = name
    FakeBroadcastChannel.instances.push(this)
  }
  postMessage(msg: unknown) {
    this.posted.push(msg)
  }
  addEventListener(_e: string, cb: (ev: { data: unknown }) => void) {
    this.listeners.push(cb)
  }
  removeEventListener(_e: string, cb: (ev: { data: unknown }) => void) {
    this.listeners = this.listeners.filter((l) => l !== cb)
  }
  close() {
    /* noop */
  }
}

const realBroadcast = (globalThis as unknown as { BroadcastChannel?: unknown })
  .BroadcastChannel
beforeEach(() => {
  FakeBroadcastChannel.instances = []
  ;(globalThis as unknown as { BroadcastChannel: unknown }).BroadcastChannel =
    FakeBroadcastChannel
})
afterEach(() => {
  ;(globalThis as unknown as { BroadcastChannel: unknown }).BroadcastChannel =
    realBroadcast
})

import { PresentationPage } from '@/pages/Presentation'

function makeDoc(): DocumentJSONV10 {
  return {
    schema_version: '1.0',
    id: '01TESTDOC0000000000000000Z',
    slug: 'fixture',
    title: '테마 테스트',
    summary: '요약',
    metadata: {
      division: 'MX',
      owners: ['x@example.com'],
      tags: [],
      confidentiality: 'internal',
    },
    sections: [
      {
        id: '01SEC00000000000000000000A',
        number: '1',
        level: 1,
        title: '섹션 1',
        blocks: [
          { type: 'paragraph', id: '01P000000000000000000000A1', text: '본문 1' },
        ],
        subsections: [],
      },
    ],
  } as unknown as DocumentJSONV10
}

function render(node: ReactNode, initial = '/present/fixture'): string {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, enabled: false } },
  })
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route path="/present/:slug" element={node} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function setPrefs(opts: {
  theme?: SlideTheme
  transition?: SlideTransition
  stagger?: boolean
}) {
  if (opts.theme) prefHolder.slide_theme = opts.theme
  if (opts.transition) prefHolder.slide_transition = opts.transition
  if (typeof opts.stagger === 'boolean') prefHolder.slide_stagger = opts.stagger
}

/**
 * Strip the `<style>` block(s) from a rendered HTML string so assertions
 * don't accidentally match class names that appear only inside CSS rules.
 */
function stripStyles(html: string): string {
  return html.replace(/<style>[\s\S]*?<\/style>/g, '')
}

describe('<PresentationPage /> theme + transition rendering', () => {
  beforeEach(() => {
    docHolder.current = {
      data: { document: makeDoc() },
      isPending: false,
      isError: false,
    }
  })

  it('applies data-pres-theme="light"', () => {
    setPrefs({ theme: 'light' })
    const dom = stripStyles(render(<PresentationPage />))
    expect(dom).toContain('data-pres-theme="light"')
    expect(dom).toContain('class="presentation-root"')
  })

  it('applies data-pres-theme="dark"', () => {
    setPrefs({ theme: 'dark' })
    const dom = stripStyles(render(<PresentationPage />))
    expect(dom).toContain('data-pres-theme="dark"')
  })

  it('applies data-pres-theme="bright"', () => {
    setPrefs({ theme: 'bright' })
    const dom = stripStyles(render(<PresentationPage />))
    expect(dom).toContain('data-pres-theme="bright"')
  })

  it('forwards the transition kind onto the slide-anim wrapper', () => {
    setPrefs({ transition: 'slide-left' })
    const dom = stripStyles(render(<PresentationPage />))
    expect(dom).toContain('class="slide-anim"')
    expect(dom).toContain('data-pres-transition="slide-left"')
  })

  it('renders the toolbar cycle buttons reflecting current prefs', () => {
    setPrefs({ theme: 'dark', transition: 'fade', stagger: true })
    const dom = stripStyles(render(<PresentationPage />))
    expect(dom).toContain('테마: dark')
    expect(dom).toContain('전환: fade')
    expect(dom).toContain('등장: on')
  })

  it('shows stagger off when toggled off', () => {
    setPrefs({ stagger: false })
    const dom = stripStyles(render(<PresentationPage />))
    expect(dom).toContain('등장: off')
    // Outside the <style> tag, the stagger modifier class shouldn't appear.
    expect(dom).not.toContain('slide-block-wrap--stagger')
  })
})
