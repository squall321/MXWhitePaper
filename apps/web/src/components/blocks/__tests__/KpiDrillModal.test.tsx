/**
 * K-2 — KpiDrillModal SSR tests.
 *
 * Shows the rows that contributed to a single compute card. Mirrors
 * ChartDrillModal: header + row count + table + null→''.
 */
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { KpiDrillModal } from '../KpiCardsBlock'

describe('<KpiDrillModal />', () => {
  it('renders label + row count + field union + cell data', () => {
    const html = renderToStaticMarkup(
      <KpiDrillModal
        label="총 매출"
        rows={[
          { dept: 'Sales', amount: 100 },
          { dept: 'R&D', amount: 80 },
        ]}
        onClose={() => {}}
      />,
    )
    expect(html).toContain('data-testid="kpi-drill-modal"')
    expect(html).toContain('총 매출 — 기여한 행')
    expect(html).toContain('2 rows')
    expect(html).toContain('>dept<')
    expect(html).toContain('>amount<')
    expect(html).toContain('>100<')
    expect(html).toContain('>80<')
  })

  it('renders empty-state copy when there are zero rows', () => {
    const html = renderToStaticMarkup(
      <KpiDrillModal label="HR" rows={[]} onClose={() => {}} />,
    )
    expect(html).toContain('이 카드에 기여한 row 가 없습니다.')
    expect(html).not.toContain('<table')
  })

  it('field union — first-seen order across rows', () => {
    const html = renderToStaticMarkup(
      <KpiDrillModal
        label="a"
        rows={[
          { x: 1, y: 2 },
          { y: 3, z: 4 },
        ]}
        onClose={() => {}}
      />,
    )
    // x, y from first row; z appended from second
    const xPos = html.indexOf('>x<')
    const yPos = html.indexOf('>y<')
    const zPos = html.indexOf('>z<')
    expect(xPos).toBeGreaterThan(-1)
    expect(yPos).toBeGreaterThan(xPos)
    expect(zPos).toBeGreaterThan(yPos)
  })

  it('null cells render as empty string', () => {
    const html = renderToStaticMarkup(
      <KpiDrillModal
        label="x"
        rows={[{ a: 'present', b: null }]}
        onClose={() => {}}
      />,
    )
    expect(html).not.toContain('>null<')
  })
})
