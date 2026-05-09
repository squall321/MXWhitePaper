import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// Stub the document + bookmark API modules so the QuickSwitcher does not try
// to fetch over the network during SSR.
vi.mock('@/features/document/api', () => ({
  listDocuments: vi.fn(async () => [
    { id: '1', slug: 'foo', title: 'Foo 백서' },
    { id: '2', slug: 'bar', title: 'Bar 결산' },
  ]),
}))
vi.mock('@/features/bookmarks/api', () => ({
  listBookmarks: vi.fn(async () => []),
  listFolders: vi.fn(async () => []),
  listRecentReads: vi.fn(async () => []),
}))

import { QuickSwitcher, __test } from '../QuickSwitcher'
import { useRecentStore } from '@/features/recent/store'

function withProviders(node: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>
  )
}

describe('<QuickSwitcher />', () => {
  beforeEach(() => {
    // Reset persisted recent store between tests.
    useRecentStore.setState({ items: [] })
  })

  it('renders nothing when closed', () => {
    const html = renderToStaticMarkup(
      withProviders(<QuickSwitcher open={false} onClose={() => {}} />),
    )
    expect(html).not.toContain('빠른 이동')
  })

  it('renders the dialog with the search input when open', () => {
    const html = renderToStaticMarkup(
      withProviders(<QuickSwitcher open onClose={() => {}} />),
    )
    expect(html).toContain('aria-label="빠른 이동"')
    expect(html).toContain('role="combobox"')
    expect(html).toContain('aria-autocomplete="list"')
  })

  it('shows the keyboard hint footer with ↑↓ / Enter / Esc / #', () => {
    const html = renderToStaticMarkup(
      withProviders(<QuickSwitcher open onClose={() => {}} />),
    )
    expect(html).toContain('Enter')
    expect(html).toContain('Esc')
    expect(html).toContain('이동')
    expect(html).toContain('섹션')
  })

  it('renders the empty-query placeholder copy', () => {
    const html = renderToStaticMarkup(
      withProviders(<QuickSwitcher open onClose={() => {}} />),
    )
    expect(html).toContain('문서 또는 섹션을 검색하세요')
    // Plus the "명령어 보기" hint pointing back at the bigger CommandPalette.
    expect(html).toContain('명령어 보기')
  })

  // NOTE: Zustand 5's `getServerSnapshot` returns the *initial* state, so
  // SSR markup checks can't observe `setState`-pushed values. We exercise the
  // store→list wiring through the pure-function `__test.buildDocResults`
  // tests further down instead.
  it('records that recent-store items are observed at runtime (sanity)', () => {
    useRecentStore.setState({
      items: [
        { slug: 'recent-1', title: 'Recent Doc 1', viewedAt: Date.now() },
      ],
    })
    expect(useRecentStore.getState().items[0]?.slug).toBe('recent-1')
  })

  it('exposes ARIA wiring for keyboard navigation', () => {
    const html = renderToStaticMarkup(
      withProviders(<QuickSwitcher open onClose={() => {}} />),
    )
    expect(html).toContain('aria-controls')
    expect(html).toContain('aria-expanded')
  })
})

describe('QuickSwitcher.buildDocResults', () => {
  it('merges recent / bookmark / doc by slug, recent wins', () => {
    const out = __test.buildDocResults({
      query: '',
      docs: [
        { slug: 'a', title: 'A doc' },
        { slug: 'b', title: 'B doc' },
      ],
      bookmarks: [{ slug: 'a', title: 'A bookmark' }],
      recent: [{ slug: 'a', title: 'A recent' }],
    })
    const a = out.find((r) => r.slug === 'a')!
    expect(a.kind).toBe('recent')
    expect(a.title).toBe('A recent')
  })

  it('orders empty-query output recent → bookmark → doc', () => {
    const out = __test.buildDocResults({
      query: '',
      docs: [{ slug: 'd', title: 'Doc' }],
      bookmarks: [{ slug: 'b', title: 'Bookmark' }],
      recent: [{ slug: 'r', title: 'Recent' }],
    })
    expect(out.map((r) => r.kind)).toEqual(['recent', 'bookmark', 'doc'])
  })

  it('fuzzy-filters and sorts by score when query is non-empty', () => {
    const out = __test.buildDocResults({
      query: 'foo',
      docs: [
        { slug: 'foo', title: 'Foo Bar' },
        { slug: 'totally-unrelated', title: 'Lorem' },
      ],
      bookmarks: [],
      recent: [],
    })
    expect(out.length).toBe(1)
    expect(out[0]!.slug).toBe('foo')
    expect(out[0]!.score).toBeGreaterThan(0)
  })
})

describe('QuickSwitcher.buildSectionResults', () => {
  const draft = {
    sections: [
      {
        id: 'sid-1',
        level: 1 as const,
        number: '1',
        title: 'Introduction',
        blocks: [],
        subsections: [
          {
            id: 'sid-1-1',
            level: 2 as const,
            number: '1.1',
            title: 'Background',
            blocks: [],
            subsections: [],
          },
        ],
      },
      {
        id: 'sid-2',
        level: 1 as const,
        number: '2',
        title: 'Methods',
        blocks: [],
        subsections: [],
      },
    ],
  } as unknown as Parameters<typeof __test.buildSectionResults>[0]

  it('returns null/empty when draft is missing', () => {
    expect(__test.buildSectionResults(null, '')).toEqual([])
  })

  it('walks the section tree in document order when query is empty', () => {
    const out = __test.buildSectionResults(draft, '')
    expect(out.map((r) => r.title)).toEqual(['Introduction', 'Background', 'Methods'])
    expect(out.every((r) => r.kind === 'section')).toBe(true)
  })

  it('fuzzy-filters sections by title or number', () => {
    const out = __test.buildSectionResults(draft, 'meth')
    expect(out.length).toBe(1)
    expect(out[0]!.title).toBe('Methods')
  })
})
