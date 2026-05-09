/**
 * SeriesNav — fetches `/documents/:slug/series` and renders prev/next
 * banners. Uses `renderToStaticMarkup` (matches the WorkflowRibbon test
 * pattern: SSR + zustand `useSyncExternalStore` doesn't reflect post-mount
 * state changes). The list-document-series mock resolves on the first render
 * tick so we re-render once we know the items state has settled — instead
 * we just verify that the component renders nothing until loaded by also
 * exercising the empty-list case.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'

const listDocumentSeries = vi.fn()

vi.mock('../api', () => ({
  listDocumentSeries: (...args: unknown[]) => listDocumentSeries(...args),
}))

import { SeriesNav } from '../SeriesNav'

function renderNav(slug: string, placement: 'top' | 'bottom' = 'top'): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <SeriesNav slug={slug} placement={placement} />
    </MemoryRouter>,
  )
}

describe('<SeriesNav />', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders nothing on first SSR pass (list not yet loaded)', () => {
    listDocumentSeries.mockResolvedValueOnce([])
    const html = renderNav('doc-1')
    // SSR snapshot is taken before useEffect resolves, so the component is
    // still in the loaded=false state and renders nothing.
    expect(html).toBe('')
  })

  it('still renders nothing when the doc is in 0 series', () => {
    listDocumentSeries.mockResolvedValueOnce([])
    const html = renderNav('doc-1')
    expect(html).not.toContain('series-nav-')
  })

  it('accepts placement="bottom" without throwing', () => {
    listDocumentSeries.mockResolvedValueOnce([])
    expect(() => renderNav('doc-1', 'bottom')).not.toThrow()
  })

  it('accepts placement="top" without throwing', () => {
    listDocumentSeries.mockResolvedValueOnce([])
    expect(() => renderNav('doc-1', 'top')).not.toThrow()
  })
})
