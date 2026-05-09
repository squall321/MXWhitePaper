import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { TemplateManagerPage } from '../TemplateManager'

vi.mock('@/features/templates/serverApi', () => ({
  listServerTemplates: vi.fn(async () => []),
  getServerTemplate: vi.fn(),
  patchServerTemplate: vi.fn(),
  deleteServerTemplate: vi.fn(),
}))

describe('<TemplateManagerPage />', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the page chrome with header and scope filter', () => {
    const html = renderToStaticMarkup(<TemplateManagerPage />)
    expect(html).toContain('data-testid="template-manager-page"')
    expect(html).toContain('조직 템플릿 관리')
    expect(html).toContain('data-testid="template-manager-list"')
  })

  it('renders all scope filter tabs', () => {
    const html = renderToStaticMarkup(<TemplateManagerPage />)
    expect(html).toContain('data-testid="template-scope-filter-all"')
    expect(html).toContain('data-testid="template-scope-filter-private"')
    expect(html).toContain('data-testid="template-scope-filter-team"')
    expect(html).toContain('data-testid="template-scope-filter-org"')
  })

  it('shows empty state copy when no templates exist', () => {
    const html = renderToStaticMarkup(<TemplateManagerPage />)
    expect(html).toContain('발행된 템플릿이 없습니다')
  })
})
