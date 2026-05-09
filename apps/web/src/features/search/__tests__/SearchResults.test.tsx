import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { SearchResults } from '../components/SearchResults'
import type { DocSearchHit } from '../api'

function withRouter(node: React.ReactNode) {
  return <MemoryRouter>{node}</MemoryRouter>
}

const hit: DocSearchHit = {
  slug: 'month-end-closing',
  title: '월말 결산 절차',
  summary: '결산 항목 정리',
  snippet: '본문 안에 <mark>결산</mark> 항목이 등장한다.',
  highlights: {
    title: '월말 <mark>결산</mark> 절차',
    body: '본문 안에 <mark>결산</mark> 항목이 등장한다.',
    summary: '<mark>결산</mark> 항목 정리',
  },
  part: 'accounting',
  tags: ['finance'],
  updated_at: '2026-04-01T00:00:00',
}

describe('<SearchResults />', () => {
  it('renders the empty state when items=[]', () => {
    const html = renderToStaticMarkup(
      withRouter(<SearchResults query="x" items={[]} />),
    )
    expect(html).toContain('결과 없음')
  })

  it('renders the loading state when loading and no items yet', () => {
    const html = renderToStaticMarkup(
      withRouter(<SearchResults query="x" items={[]} loading />),
    )
    expect(html).toContain('검색 중')
  })

  it('renders highlighted title and snippet with <mark>', () => {
    const html = renderToStaticMarkup(
      withRouter(<SearchResults query="결산" items={[hit]} />),
    )
    expect(html).toMatch(/<mark[^>]*>결산<\/mark>/)
    expect(html).toContain('월말')
    expect(html).toContain('/month-end-closing')
  })

  it('renders the total count meta', () => {
    const html = renderToStaticMarkup(
      withRouter(
        <SearchResults query="결산" items={[hit]} total={42} queryTimeMs={5} />,
      ),
    )
    expect(html).toContain('42')
    expect(html).toContain('5ms')
  })

  it('groups by part when more than one part has hits', () => {
    const hit2: DocSearchHit = { ...hit, slug: 'other', title: '다른 문서', part: 'hr' }
    const html = renderToStaticMarkup(
      withRouter(<SearchResults query="결산" items={[hit, hit2]} />),
    )
    expect(html).toContain('accounting')
    expect(html).toContain('hr')
  })

  it('renders flat list when only one part is involved', () => {
    const html = renderToStaticMarkup(
      withRouter(<SearchResults query="결산" items={[hit, { ...hit, slug: 'b' }]} />),
    )
    // No collapsible sub-header testid in flat mode.
    expect(html).not.toContain('group-toggle-')
  })

  it('falls back to plain title/terms when no highlights given', () => {
    const noHi: DocSearchHit = {
      slug: 'no-hi',
      title: 'release notes for kpi',
      summary: 'whatever',
    }
    const html = renderToStaticMarkup(
      withRouter(<SearchResults query="kpi" items={[noHi]} />),
    )
    expect(html).toMatch(/<mark[^>]*>kpi<\/mark>/i)
  })
})
