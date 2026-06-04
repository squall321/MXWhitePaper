/**
 * J — ChartDrillModal SSR tests.
 *
 * Modal is exported for testability. We verify shape (header / row /
 * field union) without exercising recharts click.
 */
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ChartDrillModal } from '../ChartBlock'

describe('<ChartDrillModal />', () => {
  it('renders title + label + per-field columns + row data', () => {
    const html = renderToStaticMarkup(
      <ChartDrillModal
        title="매출 차트"
        labelField="dept"
        label="Sales"
        rows={[
          { dept: 'Sales', date: '2026-01-15', amount: 120 },
          { dept: 'Sales', date: '2026-02-18', amount: 150 },
        ]}
        onClose={() => {}}
      />,
    )
    expect(html).toContain('data-testid="chart-drill-modal"')
    expect(html).toContain('매출 차트 — dept: Sales')
    expect(html).toContain('2 rows')
    // Field union: labelField first, then date/amount in row-key order.
    expect(html).toContain('>dept<')
    expect(html).toContain('>date<')
    expect(html).toContain('>amount<')
    // Body cells
    expect(html).toContain('>120<')
    expect(html).toContain('>150<')
    expect(html).toContain('>2026-01-15<')
  })

  it('renders empty-state copy when there are zero rows', () => {
    const html = renderToStaticMarkup(
      <ChartDrillModal
        title={undefined}
        labelField="dept"
        label="Sales"
        rows={[]}
        onClose={() => {}}
      />,
    )
    expect(html).toContain('해당 라벨에 속한 raw row 가 없습니다.')
    // No table when empty
    expect(html).not.toContain('<table')
  })

  it('header omits the chart title when title is undefined', () => {
    const html = renderToStaticMarkup(
      <ChartDrillModal
        title={undefined}
        labelField="dept"
        label="Sales"
        rows={[{ dept: 'Sales', amount: 100 }]}
        onClose={() => {}}
      />,
    )
    // Header should be just `dept: Sales` (no leading title)
    expect(html).toMatch(/dept: Sales/)
    expect(html).not.toContain('—')
  })

  it('null cell renders as empty string (not "null")', () => {
    const html = renderToStaticMarkup(
      <ChartDrillModal
        title="t"
        labelField="dept"
        label="Sales"
        rows={[{ dept: 'Sales', amount: null }]}
        onClose={() => {}}
      />,
    )
    // The amount cell should be empty, not "null"
    expect(html).not.toContain('>null<')
  })
})
