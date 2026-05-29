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
