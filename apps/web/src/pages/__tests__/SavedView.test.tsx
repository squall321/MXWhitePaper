import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Routes, Route, Outlet } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type {
  SavedView,
  SavedViewResultsResponse,
} from '@/features/saved-views/api'

vi.mock('@/features/saved-views/api', () => ({
  listSavedViews: vi.fn(async () => []),
  createSavedView: vi.fn(),
  patchSavedView: vi.fn(),
  deleteSavedView: vi.fn(),
  getSavedViewResults: vi.fn(async () => ({
    items: [],
    total: 0,
    count: 0,
    limit: 50,
    offset: 0,
    name: '',
    filters: {},
  })),
  hasAnyFilter: vi.fn(() => true),
}))

import { SavedViewPage } from '../SavedView'
import {
  savedViewResultsKey,
  savedViewsListKey,
} from '@/features/saved-views/hooks'

function StubOutlet() {
  // Provide a fake outlet context so useOutletContext doesn't blow up.
  const context = {
    setRightRail: () => undefined,
    setLeftRail: () => undefined,
    openPalette: () => undefined,
  }
  return <Outlet context={context} />
}

function render(viewId: string, seedView: SavedView | null, results: SavedViewResultsResponse): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  qc.setQueryData(savedViewsListKey(), seedView ? [seedView] : [])
  qc.setQueryData(savedViewResultsKey(viewId, 50, 0), results)
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/views/${viewId}`]}>
        <Routes>
          <Route element={<StubOutlet />}>
            <Route path="/views/:id" element={<SavedViewPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const sampleView: SavedView = {
  id: 'sv-1',
  user_id: 'u-1',
  name: '내가 작성 + 결산',
  icon: '📊',
  filters: { tag: '결산', from: '2026-04-01' },
  ordering: 0,
  created_at: null,
  updated_at: null,
}

describe('<SavedViewPage />', () => {
  it('renders the page header with name and filter summary', () => {
    const html = render('sv-1', sampleView, {
      items: [],
      total: 0,
      count: 0,
      limit: 50,
      offset: 0,
      name: '내가 작성 + 결산',
      filters: { tag: '결산', from: '2026-04-01' },
    })
    expect(html).toContain('data-testid="saved-view-page"')
    expect(html).toContain('내가 작성 + 결산')
    expect(html).toContain('태그=결산')
    expect(html).toContain('from=2026-04-01')
    expect(html).toContain('data-testid="saved-view-edit-button"')
    expect(html).toContain('data-testid="saved-view-delete-button"')
  })

  it('shows the empty state when there are no results', () => {
    const html = render('sv-1', sampleView, {
      items: [],
      total: 0,
      count: 0,
      limit: 50,
      offset: 0,
      name: sampleView.name,
      filters: sampleView.filters,
    })
    expect(html).toContain('결과가 없습니다')
  })

  it('renders the result list when the BE returns matches', () => {
    const html = render('sv-1', sampleView, {
      items: [
        {
          id: 'doc-1',
          slug: 'month-end-closing',
          title: '월말 결산',
          summary: '월말 결산 절차',
          status: 'published',
          updated_at: '2026-05-01T00:00:00Z',
          owner_id: 'u-1',
          part_id: 'p-1',
        },
      ],
      total: 1,
      count: 1,
      limit: 50,
      offset: 0,
      name: sampleView.name,
      filters: sampleView.filters,
    })
    expect(html).toContain('data-testid="saved-view-results"')
    expect(html).toContain('월말 결산')
    expect(html).toContain('month-end-closing')
  })

  it('renders the not-found state when the view is missing', () => {
    const html = render('sv-missing', null, {
      items: [],
      total: 0,
      count: 0,
      limit: 50,
      offset: 0,
      name: '',
      filters: {},
    })
    expect(html).toContain('저장된 뷰를 찾을 수 없습니다')
  })
})
