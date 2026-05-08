import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

// Stub `useDocument` so the breadcrumb test stays pure-FE without spinning up
// React Query. The hook surface only needs `data`/`isPending` for this test.
const docHolder: { current: ReturnType<typeof makeDoc> | null } = { current: null }
function makeDoc(metadata: {
  division?: string
  team?: string
  group?: string
  part?: string
}, title = 'Sample Title') {
  return {
    data: {
      document: {
        slug: 'sample',
        title,
        metadata,
      },
    },
    isPending: false,
    isError: false,
    error: null,
  }
}
vi.mock('@/features/document/hooks/useDocument', () => ({
  useDocument: () =>
    docHolder.current ?? { data: undefined, isPending: true, isError: false, error: null },
}))

import { Breadcrumb } from '../Breadcrumb'

function render(initial: string): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route path="*" element={<Breadcrumb />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('<Breadcrumb />', () => {
  it('renders "홈" on the root path', () => {
    docHolder.current = null
    const html = render('/')
    expect(html).toContain('홈')
    expect(html).toContain('aria-current="page"')
  })

  it('renders 홈 / 최근 본 문서 on /recent', () => {
    docHolder.current = null
    const html = render('/recent')
    expect(html).toContain('홈')
    expect(html).toContain('최근 본 문서')
  })

  it('renders 홈 / 조직 on /orgs', () => {
    docHolder.current = null
    const html = render('/orgs')
    expect(html).toContain('홈')
    expect(html).toContain('조직')
  })

  it('renders the admin trail on /admin/orgs', () => {
    docHolder.current = null
    const html = render('/admin/orgs')
    expect(html).toContain('관리')
    expect(html).toContain('조직 관리')
  })

  it('renders 사업부/팀/그룹/파트/문서 on a doc page', () => {
    docHolder.current = makeDoc(
      {
        division: 'MX 사업부',
        team: 'AI 팀',
        group: '플랫폼',
        part: '엔진 파트',
      },
      'Wonderful Doc',
    )
    const html = render('/docs/sample')
    expect(html).toContain('MX 사업부')
    expect(html).toContain('AI 팀')
    expect(html).toContain('플랫폼')
    expect(html).toContain('엔진 파트')
    expect(html).toContain('Wonderful Doc')
  })

  it('renders the back-button stub on mobile (sm:hidden block)', () => {
    docHolder.current = null
    const html = render('/recent')
    // The mobile collapsed view contains the "뒤로" label.
    expect(html).toContain('뒤로')
  })

  it('returns null on unknown paths (e.g. /login is rendered outside the shell)', () => {
    docHolder.current = null
    const html = render('/something-else')
    expect(html).toBe('')
  })
})
