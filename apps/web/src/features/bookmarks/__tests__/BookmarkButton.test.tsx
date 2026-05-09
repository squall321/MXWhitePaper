import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const state = {
  bookmarks: [] as Array<{ id: string; slug: string; folder: string | null; notes: string | null }>,
}

vi.mock('@/features/bookmarks/api', () => ({
  listBookmarks: vi.fn(async () => state.bookmarks.map((b) => ({
    id: b.id,
    document_id: 'doc-uuid',
    slug: b.slug,
    title: 'Test',
    folder: b.folder,
    notes: b.notes,
    created_at: '2026-05-08T00:00:00Z',
  }))),
  listFolders: vi.fn(async () => [{ folder: 'Default', count: 1 }]),
  createBookmark: vi.fn(async (input: { document_id: string }) => {
    const id = 'bm-' + (state.bookmarks.length + 1)
    state.bookmarks.push({ id, slug: input.document_id, folder: null, notes: null })
    return { bookmark_id: id }
  }),
  deleteBookmark: vi.fn(async (id: string) => {
    state.bookmarks = state.bookmarks.filter((b) => b.id !== id)
  }),
  patchBookmark: vi.fn(async () => ({
    id: 'bm-1', document_id: 'doc-uuid', slug: 'alpha', title: 'Test',
    folder: 'Default', notes: null, created_at: null,
  })),
}))

import { BookmarkButton } from '../components/BookmarkButton'

function render(node: React.ReactNode): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  // Pre-seed bookmarks query so the SSR pass sees the bookmarked state.
  qc.setQueryData(['bookmarks', null], state.bookmarks.map((b) => ({
    id: b.id,
    document_id: 'doc-uuid',
    slug: b.slug,
    title: 'Test',
    folder: b.folder,
    notes: b.notes,
    created_at: '2026-05-08T00:00:00Z',
  })))
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>{node}</QueryClientProvider>,
  )
}

describe('<BookmarkButton />', () => {
  beforeEach(() => {
    state.bookmarks = []
  })

  it('renders the not-bookmarked outline by default', () => {
    const html = render(<BookmarkButton slug="alpha" title="Alpha" />)
    expect(html).toContain('book')
    expect(html).toContain('aria-pressed="false"')
    expect(html).toContain('책갈피 추가')
  })

  it('renders the bookmarked filled state when row exists', () => {
    state.bookmarks.push({ id: 'bm-1', slug: 'alpha', folder: null, notes: null })
    const html = render(<BookmarkButton slug="alpha" title="Alpha" />)
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain('책갈피 해제')
  })

  it('exposes data-testid + slug for click integration', () => {
    const html = render(<BookmarkButton slug="my-doc" title="X" />)
    expect(html).toContain('data-testid="bookmark-button"')
    expect(html).toContain('data-slug="my-doc"')
  })
})
