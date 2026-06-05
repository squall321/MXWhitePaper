/**
 * M-2 — Drill modal CSV export button SSR tests.
 *
 * Verifies that all 4 drill modals (Chart/Kpi/Table/Pivot) render the
 * 📥 CSV button when there's data, and skip it when empty.
 */
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ChartDrillModal } from '../ChartBlock'
import { KpiDrillModal } from '../KpiCardsBlock'
import { TableDrillModal } from '../TableBlock'

describe('drill modal — 📥 CSV button', () => {
  it('ChartDrillModal — present when rows > 0', () => {
    const html = renderToStaticMarkup(
      <ChartDrillModal
        title="t"
        labelField="dept"
        label="Sales"
        rows={[{ dept: 'Sales', amount: 100 }]}
        onClose={() => {}}
      />,
    )
    expect(html).toContain('data-testid="chart-drill-csv"')
    // N ultra-review (Fix C): emoji 는 <span aria-hidden>, label 분리됨
    expect(html).toContain('📥')
    expect(html).toContain('CSV')
  })

  it('ChartDrillModal — absent when rows empty', () => {
    const html = renderToStaticMarkup(
      <ChartDrillModal
        title="t"
        labelField="dept"
        label="Sales"
        rows={[]}
        onClose={() => {}}
      />,
    )
    expect(html).not.toContain('data-testid="chart-drill-csv"')
  })

  it('KpiDrillModal — present when rows > 0', () => {
    const html = renderToStaticMarkup(
      <KpiDrillModal
        label="총 매출"
        rows={[{ dept: 'Sales', amount: 100 }]}
        onClose={() => {}}
      />,
    )
    expect(html).toContain('data-testid="kpi-drill-csv"')
  })

  it('KpiDrillModal — absent when rows empty', () => {
    const html = renderToStaticMarkup(
      <KpiDrillModal label="HR" rows={[]} onClose={() => {}} />,
    )
    expect(html).not.toContain('data-testid="kpi-drill-csv"')
  })

  it('TableDrillModal — always present (single-row, always exportable)', () => {
    const html = renderToStaticMarkup(
      <TableDrillModal
        caption="t"
        headers={['dept']}
        row={{ dept: 'Sales' }}
        onClose={() => {}}
      />,
    )
    expect(html).toContain('data-testid="table-drill-csv"')
  })
})
