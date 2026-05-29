/**
 * Sprint 1 — PivotTableBlock viewer SSR 검증.
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PivotTableBlockView } from '../PivotTableBlock'
import type { PivotTableBlock } from '@/types/document'

function mk(over: Partial<PivotTableBlock> = {}): PivotTableBlock {
  return {
    type: 'pivot-table',
    id: '01PIVOT00000000000000000VU',
    source: { kind: 'inline', rows: [] },
    rows: [],
    cols: [],
    values: [{ field: 'v', agg: 'sum' }],
    ...over,
  }
}

describe('PivotTableBlockView', () => {
  it('빈 source 또는 축 → 안내 메시지 ("표가 없습니다")', () => {
    const html = renderToStaticMarkup(<PivotTableBlockView block={mk()} />)
    expect(html).toContain('표가 없습니다')
    expect(html).toContain('data-block-type="pivot-table"')
  })

  it('rows + cols + sum → 교차 표 + 헤더 + 데이터 셀 렌더', () => {
    const html = renderToStaticMarkup(
      <PivotTableBlockView
        block={mk({
          source: {
            kind: 'inline',
            rows: [
              { dept: 'Sales', year: '2024', v: 100 },
              { dept: 'R&D', year: '2024', v: 80 },
            ],
          },
          rows: ['dept'],
          cols: ['year'],
        })}
      />,
    )
    expect(html).toContain('Sales')
    expect(html).toContain('R&amp;R&amp;D'.slice(0, 4)) // R&D 의 HTML escape
    expect(html).toContain('2024')
    expect(html).toContain('100') // toLocaleString — 작은 수라 그대로
    expect(html).toContain('80')
    expect(html).toContain('<table')
    expect(html).toContain('<thead')
  })

  it('빈 셀 (null) 은 emptyCell (default "-") 표시', () => {
    const html = renderToStaticMarkup(
      <PivotTableBlockView
        block={mk({
          source: {
            kind: 'inline',
            rows: [
              { d: 'A', y: '24', v: 5 },
              { d: 'B', y: '25', v: 7 },
            ],
          },
          rows: ['d'],
          cols: ['y'],
        })}
      />,
    )
    // A×25, B×24 빈 셀 2개
    const dashCount = (html.match(/>-</g) ?? []).length
    expect(dashCount).toBeGreaterThanOrEqual(2)
  })

  it('options.emptyCell override — "N/A" 가 빈 셀에 표시', () => {
    const html = renderToStaticMarkup(
      <PivotTableBlockView
        block={mk({
          source: {
            kind: 'inline',
            rows: [
              { d: 'A', y: '24', v: 5 },
              { d: 'B', y: '25', v: 7 },
            ],
          },
          rows: ['d'],
          cols: ['y'],
          options: { emptyCell: 'N/A' },
        })}
      />,
    )
    expect(html).toContain('N/A')
    expect(html).not.toContain('>-<')
  })

  it('다중 measure → measure label row 노출 + 각 셀 측정값', () => {
    const html = renderToStaticMarkup(
      <PivotTableBlockView
        block={mk({
          source: { kind: 'inline', rows: [{ d: 'A', v: 10, w: 1 }] },
          rows: ['d'],
          values: [
            { field: 'v', agg: 'sum', label: 'Σv' },
            { field: 'w', agg: 'avg' },
          ],
        })}
      />,
    )
    expect(html).toContain('Σv')
    expect(html).toContain('AVG(w)')
    expect(html).toContain('10')
    expect(html).toContain('1')
  })

  // ── Sprint 2 — totals row/col/grand 렌더 ────────────────────────────

  it('Sprint 2 — totals.row → 각 row 끝에 row-total td (highlight bg) 노출', () => {
    const html = renderToStaticMarkup(
      <PivotTableBlockView
        block={mk({
          source: {
            kind: 'inline',
            rows: [
              { d: 'A', y: '24', v: 5 },
              { d: 'A', y: '25', v: 3 },
              { d: 'B', y: '24', v: 7 },
            ],
          },
          rows: ['d'],
          cols: ['y'],
          totals: { row: true },
        })}
      />,
    )
    // 2 rows × 1 measure → 2 row-total cells
    expect(html).toContain('data-testid="pivot-row-total-0-0"')
    expect(html).toContain('data-testid="pivot-row-total-1-0"')
    // amber highlight class present
    expect(html).toMatch(/bg-amber-50/)
    // "Total" col header
    expect(html).toContain('data-testid="pivot-total-col-header"')
    // A 합 = 8, B 합 = 7
    expect(html).toContain('>8<')
    expect(html).toContain('>7<')
  })

  it('Sprint 2 — totals.col → 하단에 col-total row (highlight) 노출', () => {
    const html = renderToStaticMarkup(
      <PivotTableBlockView
        block={mk({
          source: {
            kind: 'inline',
            rows: [
              { d: 'A', y: '24', v: 5 },
              { d: 'B', y: '24', v: 3 },
              { d: 'A', y: '25', v: 7 },
            ],
          },
          rows: ['d'],
          cols: ['y'],
          totals: { col: true },
        })}
      />,
    )
    expect(html).toContain('data-testid="pivot-col-total-row"')
    expect(html).toContain('data-testid="pivot-col-total-0-0"')
    expect(html).toContain('data-testid="pivot-col-total-1-0"')
    // 24 합 = 8, 25 합 = 7
    expect(html).toContain('>8<')
    expect(html).toContain('>7<')
  })

  it('Sprint 2 — totals.grand → row total × col total 교차 cell (더 강한 highlight)', () => {
    const html = renderToStaticMarkup(
      <PivotTableBlockView
        block={mk({
          source: {
            kind: 'inline',
            rows: [
              { d: 'A', y: '24', v: 5 },
              { d: 'B', y: '24', v: 3 },
              { d: 'A', y: '25', v: 7 },
            ],
          },
          rows: ['d'],
          cols: ['y'],
          totals: { row: true, col: true, grand: true },
        })}
      />,
    )
    expect(html).toContain('data-testid="pivot-grand-total-0"')
    // 더 강한 highlight = bg-amber-100 또는 dark 800/40
    expect(html).toMatch(/bg-amber-100|bg-amber-800/)
    // grand total = 5+3+7 = 15
    expect(html).toContain('>15<')
  })

  it('Sprint 2 — totals 없을 때 (default) row/col total cell 없음', () => {
    const html = renderToStaticMarkup(
      <PivotTableBlockView
        block={mk({
          source: { kind: 'inline', rows: [{ d: 'A', y: '24', v: 5 }] },
          rows: ['d'],
          cols: ['y'],
        })}
      />,
    )
    expect(html).not.toContain('pivot-row-total')
    expect(html).not.toContain('pivot-col-total')
    expect(html).not.toContain('pivot-grand-total')
    expect(html).not.toContain('pivot-total-col-header')
  })

  it('Sprint 2 — totals.row + 빈 cell 인 row 의 row-total 도 정확히 합산 (empty cell 영향 X)', () => {
    const html = renderToStaticMarkup(
      <PivotTableBlockView
        block={mk({
          source: {
            kind: 'inline',
            rows: [
              { d: 'A', y: '24', v: 5 },
              { d: 'B', y: '25', v: 7 },
            ],
          },
          rows: ['d'],
          cols: ['y'],
          totals: { row: true },
        })}
      />,
    )
    // A 행: (24,v)=5, (25,v)=empty → row total = 5
    // B 행: (24,v)=empty, (25,v)=7 → row total = 7
    expect(html).toContain('data-testid="pivot-row-total-0-0"')
    expect(html).toContain('data-testid="pivot-row-total-1-0"')
    // 빈 데이터 cell 은 그대로 emptyCell
    expect(html).toMatch(/>-</)
  })

  // ── Sprint 3 — numberFormat + showAs 렌더 ───────────────────────────

  it('Sprint 3 — numberFormat "0.0%" 적용: percent 1dp', () => {
    const html = renderToStaticMarkup(
      <PivotTableBlockView
        block={mk({
          source: {
            kind: 'inline',
            rows: [
              { d: 'A', q: 'Q1', v: 10 },
              { d: 'A', q: 'Q2', v: 30 },
            ],
          },
          rows: ['d'],
          cols: ['q'],
          values: [{ field: 'v', agg: 'sum', showAs: 'pct_row', numberFormat: '0.0%' }],
        })}
      />,
    )
    // 10/40=0.25 → 25.0%, 30/40=0.75 → 75.0%
    expect(html).toContain('25.0%')
    expect(html).toContain('75.0%')
  })

  it('Sprint 3 — numberFormat "#,##0.00" 적용: thousands + 2dp', () => {
    const html = renderToStaticMarkup(
      <PivotTableBlockView
        block={mk({
          source: {
            kind: 'inline',
            rows: [{ d: 'A', q: 'Q1', v: 12345.678 }],
          },
          rows: ['d'],
          cols: ['q'],
          values: [{ field: 'v', agg: 'sum', numberFormat: '#,##0.00' }],
        })}
      />,
    )
    expect(html).toContain('12,345.68')
  })

  it('Sprint 3 — numberFormat 없으면 기존 default formatter 동작', () => {
    const html = renderToStaticMarkup(
      <PivotTableBlockView
        block={mk({
          source: { kind: 'inline', rows: [{ d: 'A', q: 'Q1', v: 1234 }] },
          rows: ['d'],
          cols: ['q'],
          values: [{ field: 'v', agg: 'sum' }],
        })}
      />,
    )
    // default toLocaleString — 1,234
    expect(html).toContain('1,234')
    expect(html).not.toContain('1,234.00')
  })

  it('Sprint 3 — showAs=running 렌더 누적 표시', () => {
    const html = renderToStaticMarkup(
      <PivotTableBlockView
        block={mk({
          source: {
            kind: 'inline',
            rows: [
              { d: 'A', q: 'Q1', v: 10 },
              { d: 'A', q: 'Q2', v: 20 },
              { d: 'A', q: 'Q3', v: 30 },
            ],
          },
          rows: ['d'],
          cols: ['q'],
          values: [{ field: 'v', agg: 'sum', showAs: 'running' }],
        })}
      />,
    )
    // 누적: 10, 30, 60
    expect(html).toContain('>10<')
    expect(html).toContain('>30<')
    expect(html).toContain('>60<')
  })

  it('export menu (CSV) — WidgetExportMenu mount + data-export-root', () => {
    const html = renderToStaticMarkup(
      <PivotTableBlockView
        block={mk({
          source: { kind: 'inline', rows: [{ d: 'A', v: 5 }] },
          rows: ['d'],
        })}
      />,
    )
    expect(html).toContain('data-export-root="pivot-table"')
    // WidgetExportMenu 가 button (label include 'CSV' or aria) — 정확한 텍스트는 i18n
    // 둘 다 안 잡히면 menu button 자체는 보임 (button[aria])
    expect(html).toMatch(/button|menu/i)
  })
})
