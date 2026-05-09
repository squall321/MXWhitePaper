import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { SeriesDetailPage } from '../SeriesDetail'

vi.mock('@/features/series/api', () => ({
  getSeries: vi.fn(async () => ({
    id: '1',
    slug: 'manual',
    title: 'Manual Series',
    description: 'A multi-part manual',
    cover_image_id: null,
    owner_user_id: 'u',
    created_at: null,
    updated_at: null,
    items: [],
  })),
  addSeriesItem: vi.fn(),
  removeSeriesItem: vi.fn(),
  reorderSeriesItem: vi.fn(),
}))

vi.mock('@/features/document/api', () => ({
  getDocument: vi.fn(),
}))

function renderPage(): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={['/series/manual']}>
      <Routes>
        <Route path="/series/:slug" element={<SeriesDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('<SeriesDetailPage />', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the page chrome on the SSR pass (before getSeries resolves)', () => {
    // The detail body waits for `getSeries`'s useEffect to resolve before
    // rendering. Under `renderToStaticMarkup` the effect doesn't run, so we
    // only assert what the initial render guarantees: the page wrapper +
    // back-link to the manager are always present.
    const html = renderPage()
    expect(html).toContain('data-testid="series-detail-page"')
    expect(html).toContain('href="/series"')
    expect(html).toContain('시리즈 목록')
  })

  it('does not render any series items before data loads', () => {
    const html = renderPage()
    expect(html).not.toContain('data-testid="series-detail-items"')
  })

  it('does not crash when slug param is present', () => {
    expect(() => renderPage()).not.toThrow()
  })
})
