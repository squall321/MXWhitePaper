/**
 * K-1 — TableDrillModal SSR tests.
 *
 * Verifies the "row 상세" modal renders `block.headers` columns first,
 * then any *hidden* columns (present in source row but not in headers)
 * with a visible "hidden" badge.
 */
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { TableDrillModal } from '../TableBlock'

describe('<TableDrillModal />', () => {
  it('renders header columns first, then hidden columns', () => {
    const html = renderToStaticMarkup(
      <TableDrillModal
        caption="매출 표"
        headers={['dept', 'amount']}
        row={{ dept: 'Sales', amount: 100, date: '2026-01-15', notes: 'q1' }}
        onClose={() => {}}
      />,
    )
    expect(html).toContain('data-testid="table-drill-modal"')
    expect(html).toContain('매출 표 — 행 상세')
    // header columns
    expect(html).toContain('>dept<')
    expect(html).toContain('>amount<')
    // hidden columns get a badge (>hidden< exact mark — overflow-hidden 도
    // 클래스명에 'hidden' 포함이라 정확한 텍스트 노드로 검사)
    expect(html).toContain('>hidden<')
    expect(html).toContain('2026-01-15')
    expect(html).toContain('q1')
    // hidden count
    expect(html).toContain('2 개의 숨겨진 컬럼')
  })

  it('no hidden badge when all source columns map to headers', () => {
    const html = renderToStaticMarkup(
      <TableDrillModal
        caption={undefined}
        headers={['dept', 'amount']}
        row={{ dept: 'Sales', amount: 100 }}
        onClose={() => {}}
      />,
    )
    // No hidden-badge ("hidden" 단어는 modal wrapper 의 overflow-hidden 에도
    // 등장하므로 badge 의 정확한 마크업으로 검사) — count 라인도 없어야.
    expect(html).not.toContain('>hidden<')
    expect(html).not.toContain('숨겨진 컬럼')
  })

  it('null cells render as empty string', () => {
    const html = renderToStaticMarkup(
      <TableDrillModal
        caption="t"
        headers={['dept', 'amount']}
        row={{ dept: 'Sales', amount: null }}
        onClose={() => {}}
      />,
    )
    expect(html).not.toContain('>null<')
  })

  it('header omits caption when caption is undefined', () => {
    const html = renderToStaticMarkup(
      <TableDrillModal
        caption={undefined}
        headers={['dept']}
        row={{ dept: 'Sales' }}
        onClose={() => {}}
      />,
    )
    expect(html).toContain('행 상세')
    expect(html).not.toContain('—')
  })
})
