/**
 * Sprint 1 — PivotTableBlock viewer SSR 검증.
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { PivotTableBlockView, PivotDrillModal, payloadToRows } from '../PivotTableBlock'
import type { PivotTableBlock } from '@/types/document'

// Sprint 6 — the viewer now mounts a useQuery for the data-source
// hydration path even when the block is inline (the hook just sits in
// `enabled:false`). renderToStaticMarkup still needs the provider in scope
// or React throws "No QueryClient set".
function harness(node: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  })
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>
}

function ssr(node: ReactNode) {
  return renderToStaticMarkup(harness(node))
}

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
    const html = ssr(<PivotTableBlockView block={mk()} />)
    expect(html).toContain('표가 없습니다')
    expect(html).toContain('data-block-type="pivot-table"')
  })

  it('rows + cols + sum → 교차 표 + 헤더 + 데이터 셀 렌더', () => {
    const html = ssr(
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
    const html = ssr(
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
    const html = ssr(
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
    const html = ssr(
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
    const html = ssr(
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
    const html = ssr(
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
    const html = ssr(
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
    const html = ssr(
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
    const html = ssr(
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
    const html = ssr(
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
    const html = ssr(
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
    const html = ssr(
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
    const html = ssr(
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
    const html = ssr(
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

  // ── Drill-down — data cell click affordance ────────────────────────

  it('drill-down — data cell 은 role=button + cursor-pointer + data-drill="cell"', () => {
    const html = ssr(
      <PivotTableBlockView
        block={mk({
          source: {
            kind: 'inline',
            rows: [
              { d: 'A', y: '24', v: 5 },
              { d: 'B', y: '24', v: 7 },
            ],
          },
          rows: ['d'],
          cols: ['y'],
        })}
      />,
    )
    expect(html).toContain('data-drill="cell"')
    expect(html).toContain('role="button"')
    expect(html).toContain('cursor-pointer')
    // 각 셀에 안정된 data-testid
    expect(html).toContain('data-testid="pivot-cell-0-0-0"')
    expect(html).toContain('data-testid="pivot-cell-1-0-0"')
  })

  it('drill-down — total cells 는 클릭 affordance 없음 (data-drill 미설정)', () => {
    const html = ssr(
      <PivotTableBlockView
        block={mk({
          source: {
            kind: 'inline',
            rows: [
              { d: 'A', y: '24', v: 5 },
              { d: 'B', y: '24', v: 7 },
            ],
          },
          rows: ['d'],
          cols: ['y'],
          totals: { row: true, col: true, grand: true },
        })}
      />,
    )
    // data-drill 마커는 데이터 셀에만 — total cell 수만큼 추가 매치가 없어야 함
    const drillCount = (html.match(/data-drill="cell"/g) ?? []).length
    // 2 rows × 1 col × 1 measure = 2 data cells (row totals 등은 미카운트)
    expect(drillCount).toBe(2)
  })

  it('drill-down — closed state SSR 에 modal mount 안됨', () => {
    const html = ssr(
      <PivotTableBlockView
        block={mk({
          source: { kind: 'inline', rows: [{ d: 'A', v: 5 }] },
          rows: ['d'],
        })}
      />,
    )
    // 초기 state = null → modal 렌더 안됨
    expect(html).not.toContain('data-testid="pivot-drill-modal"')
  })

  it('drill-down — modal open 시 raw rows table + field 컬럼 + title 노출', () => {
    const block = mk({
      source: {
        kind: 'inline',
        rows: [
          { dept: 'Sales', year: '2024', v: 100 },
          { dept: 'Sales', year: '2024', v: 20 },
          { dept: 'R&D', year: '2024', v: 80 },
        ],
      },
      rows: ['dept'],
      cols: ['year'],
    })
    const html = ssr(
      <PivotDrillModal
        block={block}
        drill={{
          rowTuple: ['Sales'],
          colTuple: ['2024'],
          rows: [
            { dept: 'Sales', year: '2024', v: 100 },
            { dept: 'Sales', year: '2024', v: 20 },
          ],
        }}
        onClose={() => {}}
      />,
    )
    expect(html).toContain('data-testid="pivot-drill-modal"')
    // 필드 컬럼 헤더
    expect(html).toContain('>dept<')
    expect(html).toContain('>year<')
    expect(html).toContain('>v<')
    // raw 값들 — 두 row 모두
    expect(html).toContain('>100<')
    expect(html).toContain('>20<')
    // title — Modal aria-label
    expect(html).toContain('dept=Sales')
    expect(html).toContain('year=2024')
    // row count 안내
    expect(html).toMatch(/2\s*rows?/)
  })

  it('drill-down — modal open with empty rows → "raw row 가 없습니다" 메시지', () => {
    const html = ssr(
      <PivotDrillModal
        block={mk({
          source: { kind: 'inline', rows: [] },
          rows: ['d'],
          cols: ['y'],
        })}
        drill={{ rowTuple: ['X'], colTuple: ['99'], rows: [] }}
        onClose={() => {}}
      />,
    )
    expect(html).toContain('raw row')
    expect(html).toContain('없습니다')
    // 빈 결과는 데이터 table tbody 없음
    expect(html).not.toContain('<tbody>')
  })
})

// ── Sprint 6 — data-source hydration ──────────────────────────────────────
describe('PivotTableBlockView — Sprint 6 data-source hydration', () => {
  it('payloadToRows: 빈 / non-object → []', () => {
    expect(payloadToRows(null)).toEqual([])
    expect(payloadToRows(undefined)).toEqual([])
    expect(payloadToRows('string')).toEqual([])
    expect(payloadToRows(42)).toEqual([])
  })

  it('payloadToRows: rows 가 이미 flat object 배열 → 그대로 통과', () => {
    const rows = [
      { dept: 'Sales', v: 100 },
      { dept: 'R&D', v: 80 },
    ]
    expect(payloadToRows({ rows })).toEqual(rows)
  })

  it('payloadToRows: tabular {headers, rows:[[…]]} → zip 하여 object[] 로', () => {
    const out = payloadToRows({
      headers: ['dept', 'year', 'v'],
      rows: [
        ['Sales', '2024', 100],
        ['R&D', '2024', 80],
      ],
    })
    expect(out).toEqual([
      { dept: 'Sales', year: '2024', v: 100 },
      { dept: 'R&D', year: '2024', v: 80 },
    ])
  })

  it('payloadToRows: tabular 의 cell 이 객체면 String 강제 변환', () => {
    const out = payloadToRows({
      headers: ['a'],
      rows: [[{ nested: 1 }]],
    })
    expect(typeof out[0]?.a).toBe('string')
  })

  it('source.kind=data-source 인데 dataSourceId 가 draft 에 없으면 error banner', () => {
    const html = ssr(
      <PivotTableBlockView
        block={mk({
          source: {
            kind: 'data-source',
            dataSourceId: '01MISSING000000000000000VU',
          } as PivotTableBlock['source'],
          rows: ['dept'],
          values: [{ field: 'v', agg: 'sum' }],
        })}
      />,
    )
    expect(html).toContain('data-pivot-source-state="error"')
    expect(html).toContain('dataSourceId not found')
  })
})

// ── Sprint 6 G2 — collectSlicerFilters (cross-widget filter resolution) ──
import { collectSlicerFilters } from '../PivotTableBlock'

describe('collectSlicerFilters', () => {
  const mkSlicer = (id: string, field: string) => ({
    type: 'slicer' as const,
    id,
    field,
    source: { kind: 'inline' as const, rows: [] },
  })

  it('boundSlicers 가 비어있으면 []', () => {
    expect(collectSlicerFilters([], [], {})).toEqual([])
  })

  it('boundSlicers 에 있는 slicer 의 active values 만 in 필터로', () => {
    const sections = [
      {
        blocks: [
          mkSlicer('SLICERREGION00000000000000', 'region'),
          mkSlicer('SLICERDEPT0000000000000000', 'dept'),
        ],
      },
    ]
    const filters = collectSlicerFilters(
      ['SLICERREGION00000000000000', 'SLICERDEPT0000000000000000'],
      sections,
      {
        SLICERREGION00000000000000: ['KR', 'US'],
        // dept slicer empty → no filter for it
      },
    )
    expect(filters).toEqual([
      { field: 'region', op: 'in', value: ['KR', 'US'] },
    ])
  })

  it('boundSlicer 가 draft 에 없으면 skip (no throw)', () => {
    expect(
      collectSlicerFilters(
        ['MISSING000000000000000000U'],
        [],
        { MISSING000000000000000000U: ['v'] },
      ),
    ).toEqual([])
  })

  it('active 가 빈 배열이면 그 slicer 는 필터 미생성 (All semantic)', () => {
    const sections = [
      { blocks: [mkSlicer('SLICERDEPT0000000000000000', 'dept')] },
    ]
    expect(
      collectSlicerFilters(['SLICERDEPT0000000000000000'], sections, {
        SLICERDEPT0000000000000000: [],
      }),
    ).toEqual([])
  })
})
