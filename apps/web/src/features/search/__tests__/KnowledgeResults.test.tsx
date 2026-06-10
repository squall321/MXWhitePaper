import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { KnowledgeResults } from '../components/KnowledgeResults'
import type { KnowledgeSearchHit } from '../api'

const hit: KnowledgeSearchHit = {
  id: 'lat:documents:etag',
  kind: 'lat',
  area: 'documents',
  doc_path: 'docs/lat/documents.md',
  heading: 'ETag 검증',
  snippet: '문서 PUT 은 ETag 를 검사한다.',
  highlights: {
    heading: '<mark>ETag</mark> 검증',
    body: '문서 PUT 은 <mark>ETag</mark> 를 검사한다.',
  },
}

const noop = () => {}
const optionId = (i: number) => `opt-${i}`

function render(items: KnowledgeSearchHit[], opts: { q?: string; loading?: boolean } = {}) {
  return renderToStaticMarkup(
    <KnowledgeResults
      q={opts.q ?? 'etag'}
      items={items}
      loading={opts.loading ?? false}
      activeIdx={0}
      onActivate={noop}
      listboxId="kn"
      optionId={optionId}
    />,
  )
}

describe('<KnowledgeResults />', () => {
  it('renders prompt / loading / empty states', () => {
    expect(render([], { q: ' ' })).toContain('검색어를 입력하세요.')
    expect(render([], { loading: true })).toContain('검색 중')
    expect(render([])).toContain('결과 없음')
  })

  it('renders kind badge, highlighted heading/snippet, and doc_path', () => {
    const html = render([hit])
    expect(html).toContain('lat')
    expect(html).toMatch(/<mark[^>]*>ETag<\/mark>/)
    expect(html).toContain('검사한다')
    expect(html).toContain('docs/lat/documents.md')
  })

  it('falls back to plain heading/snippet when no highlights given', () => {
    const noHi: KnowledgeSearchHit = { ...hit, id: 'x', highlights: undefined }
    const html = render([noHi])
    expect(html).toContain('ETag 검증')
    expect(html).not.toContain('<mark')
  })
})
