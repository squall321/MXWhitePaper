// 소속 → 팀 관리자 화면 시험 — 첫 그리기(SSR)에 폼 · 빈 표 자리가 나오고 줄은 질의 전에는 없다
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AdminAffTeamMapPage } from '../AdminAffTeamMap'

vi.mock('@/features/aff-team-map/api', () => ({
  listAffTeamMap: vi.fn(async () => []),
  listTeams: vi.fn(async () => []),
  putAffTeamMap: vi.fn(),
  deleteAffTeamMap: vi.fn(),
}))

function renderPage(): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/admin/aff-team-map']}>
        <AdminAffTeamMapPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('<AdminAffTeamMapPage />', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the page chrome and the form on the SSR pass', () => {
    const html = renderPage()
    expect(html).toContain('data-testid="aff-team-map-page"')
    expect(html).toContain('소속 → 팀')
    expect(html).toContain('data-testid="aff-team-map-form"')
    expect(html).toContain('data-testid="aff-submit"')
  })

  it('keeps the submit disabled until both fields are filled', () => {
    const html = renderPage()
    expect(html).toMatch(/data-testid="aff-submit"[^>]*disabled|disabled[^>]*data-testid="aff-submit"/)
  })

  it('does not pre-render mapping rows before the query resolves', () => {
    expect(renderPage()).not.toContain('data-testid="aff-row-')
  })
})
