import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SnippetManagerPage } from '../SnippetManager'

vi.mock('@/features/block-library/api', () => ({
  listSnippets: vi.fn(async () => []),
  getSnippet: vi.fn(),
  createSnippet: vi.fn(),
  patchSnippet: vi.fn(),
  deleteSnippet: vi.fn(),
  useSnippet: vi.fn(),
}))

describe('<SnippetManagerPage />', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the page chrome', () => {
    const html = renderToStaticMarkup(<SnippetManagerPage />)
    expect(html).toContain('data-testid="snippet-manager-page"')
    expect(html).toContain('스니펫 관리')
    expect(html).toContain('data-testid="snippet-manager-scope-filter"')
    expect(html).toContain('data-testid="snippet-manager-sort"')
  })

  it('renders both sort options', () => {
    const html = renderToStaticMarkup(<SnippetManagerPage />)
    expect(html).toContain('최근 수정순')
    expect(html).toContain('사용 많은 순')
  })

  it('renders scope filter options', () => {
    const html = renderToStaticMarkup(<SnippetManagerPage />)
    expect(html).toContain('전체')
    expect(html).toContain('나만')
    expect(html).toContain('팀')
    expect(html).toContain('조직')
  })
})
