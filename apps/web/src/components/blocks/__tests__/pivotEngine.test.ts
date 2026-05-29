/**
 * Sprint 1 — pivotEngine cross-tab + 8 aggregator 단위 검증.
 */
import { describe, expect, it } from 'vitest'
import { buildPivot, parseExpr, evalExprForRow, drillRows } from '../pivotEngine'
import type { PivotTableBlock } from '@/types/document'

function mk(
  overrides: Partial<PivotTableBlock> & {
    rows?: string[]
    cols?: string[]
    values?: PivotTableBlock['values']
    sourceRows?: PivotTableBlock['source']['rows']
  },
): PivotTableBlock {
  const block: PivotTableBlock = {
    type: 'pivot-table',
    id: '01TEST0PIVOT000000000000P0',
    source: { kind: 'inline', rows: overrides.sourceRows ?? [] },
    rows: overrides.rows ?? [],
    cols: overrides.cols ?? [],
    values: overrides.values ?? [{ field: 'v', agg: 'sum' }],
  }
  if (overrides.totals) block.totals = overrides.totals
  if (overrides.sort) block.sort = overrides.sort
  if (overrides.filters) block.filters = overrides.filters
  if (overrides.options) block.options = overrides.options
  return block
}

describe('pivotEngine — buildPivot', () => {
  it('1차원 row + 1차원 col, sum 정확 cross-tab', () => {
    const r = buildPivot(
      mk({
        sourceRows: [
          { dept: 'Sales', year: '2024', v: 100 },
          { dept: 'Sales', year: '2025', v: 150 },
          { dept: 'R&D', year: '2024', v: 80 },
          { dept: 'Sales', year: '2024', v: 20 }, // 120 합쳐짐
        ],
        rows: ['dept'],
        cols: ['year'],
        values: [{ field: 'v', agg: 'sum' }],
      }),
    )
    expect(r.rowHeaders).toEqual([['Sales'], ['R&D']])
    expect(r.colHeaders).toEqual([['2024'], ['2025']])
    expect(r.values).toEqual([
      [[120], [150]], // Sales × (2024, 2025)
      [[80], [null]], // R&D × (2024, 2025) — 2025 빈 셀
    ])
  })

  it('다중 row dim, count aggregator (COUNTA 동등)', () => {
    const r = buildPivot(
      mk({
        sourceRows: [
          { dept: 'Sales', team: 'A', q: 'Q1', v: 1 },
          { dept: 'Sales', team: 'A', q: 'Q2', v: 'maybe' }, // text 도 count
          { dept: 'Sales', team: 'B', q: 'Q1', v: null }, // null 은 미카운트
        ],
        rows: ['dept', 'team'],
        cols: ['q'],
        values: [{ field: 'v', agg: 'count' }],
      }),
    )
    expect(r.rowHeaders).toEqual([
      ['Sales', 'A'],
      ['Sales', 'B'],
    ])
    expect(r.colHeaders).toEqual([['Q1'], ['Q2']])
    expect(r.values).toEqual([
      [[1], [1]], // Sales/A: Q1 v=1, Q2 v='maybe' (text 도 카운트)
      [[0], [null]], // Sales/B: Q1 v=null (count 0), Q2 빈 셀 (null)
    ])
  })

  it('cols=[] 빈 col, row-only group', () => {
    const r = buildPivot(
      mk({
        sourceRows: [
          { dept: 'A', v: 10 },
          { dept: 'B', v: 20 },
          { dept: 'A', v: 30 },
        ],
        rows: ['dept'],
        cols: [],
        values: [{ field: 'v', agg: 'sum' }],
      }),
    )
    expect(r.colHeaders).toEqual([[]]) // 단일 가상 col, 빈 tuple
    expect(r.values).toEqual([[[40]], [[20]]])
  })

  it('avg / min / max', () => {
    const r = buildPivot(
      mk({
        sourceRows: [
          { d: 'X', v: 2 },
          { d: 'X', v: 4 },
          { d: 'X', v: 9 },
        ],
        rows: ['d'],
        cols: [],
        values: [
          { field: 'v', agg: 'avg' },
          { field: 'v', agg: 'min' },
          { field: 'v', agg: 'max' },
        ],
      }),
    )
    expect(r.values[0]?.[0]).toEqual([5, 2, 9]) // avg=5, min=2, max=9
  })

  it('median — 홀짝 분기', () => {
    const oddDept = mk({
      sourceRows: [
        { d: 'X', v: 1 },
        { d: 'X', v: 3 },
        { d: 'X', v: 100 },
      ],
      rows: ['d'],
      values: [{ field: 'v', agg: 'median' }],
    })
    expect(buildPivot(oddDept).values[0]?.[0]?.[0]).toBe(3)
    const evenDept = mk({
      sourceRows: [
        { d: 'X', v: 1 },
        { d: 'X', v: 3 },
        { d: 'X', v: 5 },
        { d: 'X', v: 7 },
      ],
      rows: ['d'],
      values: [{ field: 'v', agg: 'median' }],
    })
    expect(buildPivot(evenDept).values[0]?.[0]?.[0]).toBe(4) // (3+5)/2
  })

  it('stdev / var — sample (n-1), n<2 면 null', () => {
    const r = buildPivot(
      mk({
        sourceRows: [
          { d: 'X', v: 2 },
          { d: 'X', v: 4 },
          { d: 'X', v: 4 },
          { d: 'X', v: 4 },
          { d: 'X', v: 5 },
          { d: 'X', v: 5 },
          { d: 'X', v: 7 },
          { d: 'X', v: 9 },
        ],
        rows: ['d'],
        values: [
          { field: 'v', agg: 'var' },
          { field: 'v', agg: 'stdev' },
        ],
      }),
    )
    // 표본 분산 (n=8, mean=5): sum((x-5)^2)/7 = 32/7 ≈ 4.571
    const [vvar, vstd] = r.values[0]?.[0] ?? []
    expect(vvar).toBeCloseTo(32 / 7, 5)
    expect(vstd).toBeCloseTo(Math.sqrt(32 / 7), 5)

    // n<2
    const single = buildPivot(
      mk({
        sourceRows: [{ d: 'X', v: 42 }],
        rows: ['d'],
        values: [
          { field: 'v', agg: 'stdev' },
          { field: 'v', agg: 'var' },
        ],
      }),
    )
    expect(single.values[0]?.[0]).toEqual([null, null])
  })

  it('빈 source.rows → 빈 result (rowHeaders/colHeaders 모두 [])', () => {
    const r = buildPivot(mk({ rows: ['a'], cols: ['b'] }))
    expect(r.rowHeaders).toEqual([])
    expect(r.colHeaders).toEqual([])
    expect(r.values).toEqual([])
  })

  it('row field missing → 빈 string tuple', () => {
    const r = buildPivot(
      mk({
        sourceRows: [{ v: 5 }, { dept: 'A', v: 10 }],
        rows: ['dept'],
        values: [{ field: 'v', agg: 'sum' }],
      }),
    )
    expect(r.rowHeaders).toEqual([[''], ['A']])
    expect(r.values).toEqual([[[5]], [[10]]])
  })

  it('다중 measure', () => {
    const r = buildPivot(
      mk({
        sourceRows: [
          { d: 'X', v: 10, w: 1 },
          { d: 'X', v: 20, w: 2 },
        ],
        rows: ['d'],
        values: [
          { field: 'v', agg: 'sum' },
          { field: 'w', agg: 'avg' },
        ],
      }),
    )
    expect(r.values[0]?.[0]).toEqual([30, 1.5])
  })

  it('sort stability — 같은 입력 → 같은 row/col 순서 (first-seen)', () => {
    const sourceRows = [
      { d: 'B', v: 1 },
      { d: 'A', v: 2 },
      { d: 'B', v: 3 },
      { d: 'A', v: 4 },
    ]
    const r1 = buildPivot(mk({ sourceRows, rows: ['d'] }))
    const r2 = buildPivot(mk({ sourceRows: [...sourceRows], rows: ['d'] }))
    expect(r1.rowHeaders).toEqual([['B'], ['A']]) // first-seen: B 가 먼저
    expect(r1.rowHeaders).toEqual(r2.rowHeaders)
  })

  it('measures + rowDims + colDims echo (renderer 가 쓰는 메타)', () => {
    const block = mk({ rows: ['a', 'b'], cols: ['c'], values: [{ field: 'v', agg: 'sum' }] })
    const r = buildPivot(block)
    expect(r.rowDims).toEqual(['a', 'b'])
    expect(r.colDims).toEqual(['c'])
    expect(r.measures).toBe(block.values)
  })

  it('numeric aggregator 빈 numeric → null (count 와 분기)', () => {
    const r = buildPivot(
      mk({
        sourceRows: [
          { d: 'X', v: 'text' },
          { d: 'X', v: null },
        ],
        rows: ['d'],
        values: [
          { field: 'v', agg: 'sum' },
          { field: 'v', agg: 'count' },
        ],
      }),
    )
    // sum 은 numeric 없으니 null, count 는 'text' 1건
    expect(r.values[0]?.[0]).toEqual([null, 1])
  })
})

// ─────────────────────────────────────────────────────────────────────────
// Sprint 2 — filter / sort / totals
// ─────────────────────────────────────────────────────────────────────────

describe('pivotEngine — Sprint 2 filter', () => {
  it('filter: in — Set 멤버십', () => {
    const r = buildPivot(
      mk({
        sourceRows: [
          { dept: 'Sales', v: 10 },
          { dept: 'R&D', v: 20 },
          { dept: 'HR', v: 30 },
        ],
        rows: ['dept'],
        values: [{ field: 'v', agg: 'sum' }],
        filters: [{ field: 'dept', op: 'in', value: ['Sales', 'R&D'] }],
      }),
    )
    expect(r.rowHeaders).toEqual([['Sales'], ['R&D']])
    expect(r.values).toEqual([[[10]], [[20]]])
  })

  it('filter: not_in — null 은 유지', () => {
    const r = buildPivot(
      mk({
        sourceRows: [
          { dept: 'Sales', v: 10 },
          { dept: 'R&D', v: 20 },
          { dept: null, v: 30 }, // null 은 not_in 통과
        ],
        rows: ['dept'],
        values: [{ field: 'v', agg: 'sum' }],
        filters: [{ field: 'dept', op: 'not_in', value: ['Sales'] }],
      }),
    )
    // R&D + '' (null → empty tuple)
    expect(r.rowHeaders).toEqual([['R&D'], ['']])
    expect(r.values).toEqual([[[20]], [[30]]])
  })

  it('filter: gt — numeric coercion', () => {
    const r = buildPivot(
      mk({
        sourceRows: [
          { d: 'A', v: 5 },
          { d: 'B', v: 15 },
          { d: 'C', v: '20' }, // string-numeric 도 coerce
          { d: 'D', v: 'nope' }, // 비숫자 → drop
        ],
        rows: ['d'],
        values: [{ field: 'v', agg: 'sum' }],
        filters: [{ field: 'v', op: 'gt', value: 10 }],
      }),
    )
    expect(r.rowHeaders).toEqual([['B'], ['C']])
    expect(r.values).toEqual([[[15]], [[20]]])
  })

  it('filter: top_n — 상위 N (sort + slice)', () => {
    const r = buildPivot(
      mk({
        sourceRows: [
          { d: 'A', v: 1 },
          { d: 'B', v: 100 },
          { d: 'C', v: 50 },
          { d: 'D', v: 200 },
        ],
        rows: ['d'],
        values: [{ field: 'v', agg: 'sum' }],
        filters: [{ field: 'v', op: 'top_n', value: 2 }],
      }),
    )
    // top 2 by v: D(200), B(100) — first-seen 로 header 정렬은 row 등장 순.
    // top_n 은 row 자체를 골라낸 후 buildPivot first-seen.
    // 골라낸 순서 = D, B (desc) → first-seen 동일.
    expect(r.rowHeaders).toEqual([['D'], ['B']])
    expect(r.values).toEqual([[[200]], [[100]]])
  })
})

describe('pivotEngine — Sprint 2 sort', () => {
  it('sort row by dimension asc', () => {
    const r = buildPivot(
      mk({
        sourceRows: [
          { d: 'C', v: 10 },
          { d: 'A', v: 20 },
          { d: 'B', v: 30 },
        ],
        rows: ['d'],
        values: [{ field: 'v', agg: 'sum' }],
        sort: { axis: 'row', by: 'd', order: 'asc' },
      }),
    )
    expect(r.rowHeaders).toEqual([['A'], ['B'], ['C']])
    expect(r.values).toEqual([[[20]], [[30]], [[10]]])
  })

  it('sort row by dimension desc', () => {
    const r = buildPivot(
      mk({
        sourceRows: [
          { d: 'C', v: 10 },
          { d: 'A', v: 20 },
          { d: 'B', v: 30 },
        ],
        rows: ['d'],
        values: [{ field: 'v', agg: 'sum' }],
        sort: { axis: 'row', by: 'd', order: 'desc' },
      }),
    )
    expect(r.rowHeaders).toEqual([['C'], ['B'], ['A']])
  })

  it('sort row by measure desc — 모든 col 합산 기준', () => {
    const r = buildPivot(
      mk({
        sourceRows: [
          { d: 'A', q: 'Q1', v: 10 },
          { d: 'A', q: 'Q2', v: 20 },
          { d: 'B', q: 'Q1', v: 100 },
          { d: 'C', q: 'Q1', v: 50 },
        ],
        rows: ['d'],
        cols: ['q'],
        values: [{ field: 'v', agg: 'sum' }],
        // default label = 'sum(v)'
        sort: { axis: 'row', by: 'sum(v)', order: 'desc' },
      }),
    )
    // row sums: A=30, B=100, C=50 → desc: B, C, A
    expect(r.rowHeaders).toEqual([['B'], ['C'], ['A']])
  })

  it('sort col by measure desc', () => {
    const r = buildPivot(
      mk({
        sourceRows: [
          { d: 'X', q: 'Q1', v: 5 },
          { d: 'X', q: 'Q2', v: 50 },
          { d: 'X', q: 'Q3', v: 20 },
        ],
        rows: ['d'],
        cols: ['q'],
        values: [{ field: 'v', agg: 'sum' }],
        sort: { axis: 'col', by: 'sum(v)', order: 'desc' },
      }),
    )
    // col sums: Q1=5, Q2=50, Q3=20 → desc: Q2, Q3, Q1
    expect(r.colHeaders).toEqual([['Q2'], ['Q3'], ['Q1']])
    expect(r.values[0]).toEqual([[50], [20], [5]])
  })
})

describe('pivotEngine — Sprint 2 totals', () => {
  it('totals.row — 각 row 의 모든 col 합 (raw 재집계)', () => {
    const r = buildPivot(
      mk({
        sourceRows: [
          { d: 'A', q: 'Q1', v: 10 },
          { d: 'A', q: 'Q2', v: 20 },
          { d: 'B', q: 'Q1', v: 100 },
        ],
        rows: ['d'],
        cols: ['q'],
        values: [{ field: 'v', agg: 'sum' }],
        totals: { row: true },
      }),
    )
    // rowTotals[i][k] — row A = 30, row B = 100
    expect(r.rowTotals).toEqual([[30], [100]])
    expect(r.colTotals).toBeUndefined()
    expect(r.grandTotals).toBeUndefined()
  })

  it('totals.col — 각 col 의 모든 row 합', () => {
    const r = buildPivot(
      mk({
        sourceRows: [
          { d: 'A', q: 'Q1', v: 10 },
          { d: 'A', q: 'Q2', v: 20 },
          { d: 'B', q: 'Q1', v: 100 },
        ],
        rows: ['d'],
        cols: ['q'],
        values: [{ field: 'v', agg: 'sum' }],
        totals: { col: true },
      }),
    )
    // colTotals[j][k] — Q1 = 110, Q2 = 20
    expect(r.colTotals).toEqual([[110], [20]])
  })

  it('totals.grand — row+col 교차 grand total', () => {
    const r = buildPivot(
      mk({
        sourceRows: [
          { d: 'A', q: 'Q1', v: 10 },
          { d: 'A', q: 'Q2', v: 20 },
          { d: 'B', q: 'Q1', v: 100 },
        ],
        rows: ['d'],
        cols: ['q'],
        values: [{ field: 'v', agg: 'sum' }],
        totals: { grand: true, row: true, col: true },
      }),
    )
    expect(r.grandTotals).toEqual([130])
    // row/col 합과도 모순 없는지
    expect(r.rowTotals).toEqual([[30], [100]])
    expect(r.colTotals).toEqual([[110], [20]])
  })

  it('totals.grand with avg — raw 재집계 (avg(avg) 가 아님)', () => {
    const r = buildPivot(
      mk({
        sourceRows: [
          // row A 의 col Q1 avg = (10+20)/2 = 15, col Q2 avg = 100
          { d: 'A', q: 'Q1', v: 10 },
          { d: 'A', q: 'Q1', v: 20 },
          { d: 'A', q: 'Q2', v: 100 },
          // row B Q1 avg = 200
          { d: 'B', q: 'Q1', v: 200 },
        ],
        rows: ['d'],
        cols: ['q'],
        values: [{ field: 'v', agg: 'avg' }],
        totals: { grand: true, row: true },
      }),
    )
    // 셀 avg
    expect(r.values).toEqual([[[15], [100]], [[200], [null]]])
    // rowTotals — row A 전체 raw {10,20,100} avg = 130/3 ≈ 43.333 (NOT (15+100)/2 = 57.5)
    expect(r.rowTotals?.[0]?.[0]).toBeCloseTo(130 / 3, 5)
    expect(r.rowTotals?.[1]?.[0]).toBe(200)
    // grand — 전체 raw {10,20,100,200} avg = 330/4 = 82.5 (NOT avg(avg) = (15+100+200)/3 = 105)
    expect(r.grandTotals?.[0]).toBeCloseTo(82.5, 5)
  })

  // ── Sprint 3 — showAs: pct_row / pct_col / pct_total / running ─────────

  it('Sprint 3 — showAs=pct_row: 각 셀 / row sum (sum agg)', () => {
    const r = buildPivot(
      mk({
        sourceRows: [
          { d: 'A', q: 'Q1', v: 10 },
          { d: 'A', q: 'Q2', v: 30 }, // A 합 40
          { d: 'B', q: 'Q1', v: 25 },
          { d: 'B', q: 'Q2', v: 75 }, // B 합 100
        ],
        rows: ['d'],
        cols: ['q'],
        values: [{ field: 'v', agg: 'sum', showAs: 'pct_row' }],
      }),
    )
    // A: 10/40=0.25, 30/40=0.75   B: 25/100=0.25, 75/100=0.75
    expect(r.values[0]?.[0]?.[0]).toBeCloseTo(0.25, 6)
    expect(r.values[0]?.[1]?.[0]).toBeCloseTo(0.75, 6)
    expect(r.values[1]?.[0]?.[0]).toBeCloseTo(0.25, 6)
    expect(r.values[1]?.[1]?.[0]).toBeCloseTo(0.75, 6)
  })

  it('Sprint 3 — showAs=pct_col: 각 셀 / col sum (sum agg)', () => {
    const r = buildPivot(
      mk({
        sourceRows: [
          { d: 'A', q: 'Q1', v: 10 },
          { d: 'B', q: 'Q1', v: 30 }, // Q1 합 40
          { d: 'A', q: 'Q2', v: 20 },
          { d: 'B', q: 'Q2', v: 80 }, // Q2 합 100
        ],
        rows: ['d'],
        cols: ['q'],
        values: [{ field: 'v', agg: 'sum', showAs: 'pct_col' }],
      }),
    )
    expect(r.values[0]?.[0]?.[0]).toBeCloseTo(10 / 40, 6)
    expect(r.values[1]?.[0]?.[0]).toBeCloseTo(30 / 40, 6)
    expect(r.values[0]?.[1]?.[0]).toBeCloseTo(20 / 100, 6)
    expect(r.values[1]?.[1]?.[0]).toBeCloseTo(80 / 100, 6)
  })

  it('Sprint 3 — showAs=pct_total: 각 셀 / grand total (sum agg)', () => {
    const r = buildPivot(
      mk({
        sourceRows: [
          { d: 'A', q: 'Q1', v: 10 },
          { d: 'A', q: 'Q2', v: 20 },
          { d: 'B', q: 'Q1', v: 30 },
          { d: 'B', q: 'Q2', v: 40 }, // grand 100
        ],
        rows: ['d'],
        cols: ['q'],
        values: [{ field: 'v', agg: 'sum', showAs: 'pct_total' }],
      }),
    )
    expect(r.values[0]?.[0]?.[0]).toBeCloseTo(0.1, 6)
    expect(r.values[0]?.[1]?.[0]).toBeCloseTo(0.2, 6)
    expect(r.values[1]?.[0]?.[0]).toBeCloseTo(0.3, 6)
    expect(r.values[1]?.[1]?.[0]).toBeCloseTo(0.4, 6)
  })

  it('Sprint 3 — showAs=running: row 안 col 순서 누적 합', () => {
    const r = buildPivot(
      mk({
        sourceRows: [
          { d: 'A', q: 'Q1', v: 10 },
          { d: 'A', q: 'Q2', v: 20 },
          { d: 'A', q: 'Q3', v: 30 },
          { d: 'B', q: 'Q1', v: 100 },
          { d: 'B', q: 'Q3', v: 50 }, // B 의 Q2 는 null
        ],
        rows: ['d'],
        cols: ['q'],
        values: [{ field: 'v', agg: 'sum', showAs: 'running' }],
      }),
    )
    // col 순서: Q1, Q2, Q3 (first-seen)
    // A: 10, 10+20=30, 30+30=60
    expect(r.values[0]?.[0]?.[0]).toBe(10)
    expect(r.values[0]?.[1]?.[0]).toBe(30)
    expect(r.values[0]?.[2]?.[0]).toBe(60)
    // B: 100, null (slot null, 누적은 유지), 100+50=150
    expect(r.values[1]?.[0]?.[0]).toBe(100)
    expect(r.values[1]?.[1]?.[0]).toBeNull()
    expect(r.values[1]?.[2]?.[0]).toBe(150)
  })

  it('Sprint 3 — pct_row + totals.row → row total = 1.0 (정확히 100%)', () => {
    const r = buildPivot(
      mk({
        sourceRows: [
          { d: 'A', q: 'Q1', v: 10 },
          { d: 'A', q: 'Q2', v: 30 },
          { d: 'B', q: 'Q1', v: 25 },
          { d: 'B', q: 'Q2', v: 75 },
        ],
        rows: ['d'],
        cols: ['q'],
        values: [{ field: 'v', agg: 'sum', showAs: 'pct_row' }],
        totals: { row: true },
      }),
    )
    // transformed row sum = 1.0 (= 0.25 + 0.75)
    expect(r.rowTotals?.[0]?.[0]).toBeCloseTo(1, 6)
    expect(r.rowTotals?.[1]?.[0]).toBeCloseTo(1, 6)
  })

  it('Sprint 3 — pct_col + totals.col → col total = 1.0', () => {
    const r = buildPivot(
      mk({
        sourceRows: [
          { d: 'A', q: 'Q1', v: 10 },
          { d: 'B', q: 'Q1', v: 30 },
          { d: 'A', q: 'Q2', v: 20 },
          { d: 'B', q: 'Q2', v: 80 },
        ],
        rows: ['d'],
        cols: ['q'],
        values: [{ field: 'v', agg: 'sum', showAs: 'pct_col' }],
        totals: { col: true },
      }),
    )
    expect(r.colTotals?.[0]?.[0]).toBeCloseTo(1, 6)
    expect(r.colTotals?.[1]?.[0]).toBeCloseTo(1, 6)
  })

  it('Sprint 3 — pct_total + totals.grand → grand = 1.0', () => {
    const r = buildPivot(
      mk({
        sourceRows: [
          { d: 'A', q: 'Q1', v: 10 },
          { d: 'A', q: 'Q2', v: 20 },
          { d: 'B', q: 'Q1', v: 30 },
          { d: 'B', q: 'Q2', v: 40 },
        ],
        rows: ['d'],
        cols: ['q'],
        values: [{ field: 'v', agg: 'sum', showAs: 'pct_total' }],
        totals: { grand: true },
      }),
    )
    expect(r.grandTotals?.[0]).toBeCloseTo(1, 6)
  })

  it('Sprint 3 — showAs=value (default) 동작 변함 없음', () => {
    const r = buildPivot(
      mk({
        sourceRows: [
          { d: 'A', q: 'Q1', v: 10 },
          { d: 'A', q: 'Q2', v: 30 },
        ],
        rows: ['d'],
        cols: ['q'],
        values: [{ field: 'v', agg: 'sum' }],
      }),
    )
    expect(r.values).toEqual([[[10], [30]]])
  })

  it('Sprint 3 — pct_row 에서 row sum=0 (전부 0) → 셀 null (division-by-zero)', () => {
    const r = buildPivot(
      mk({
        sourceRows: [
          { d: 'A', q: 'Q1', v: 0 },
          { d: 'A', q: 'Q2', v: 0 },
          { d: 'B', q: 'Q1', v: 10 },
          { d: 'B', q: 'Q2', v: 30 },
        ],
        rows: ['d'],
        cols: ['q'],
        values: [{ field: 'v', agg: 'sum', showAs: 'pct_row' }],
      }),
    )
    // A row: 0/0 = null, 0/0 = null
    expect(r.values[0]?.[0]?.[0]).toBeNull()
    expect(r.values[0]?.[1]?.[0]).toBeNull()
    // B row: 10/40 = 0.25, 30/40 = 0.75
    expect(r.values[1]?.[0]?.[0]).toBeCloseTo(0.25, 6)
    expect(r.values[1]?.[1]?.[0]).toBeCloseTo(0.75, 6)
  })

  it('Sprint 3 — 다중 measure: 하나만 pct_row, 나머지는 raw', () => {
    const r = buildPivot(
      mk({
        sourceRows: [
          { d: 'A', q: 'Q1', v: 10, w: 1 },
          { d: 'A', q: 'Q2', v: 30, w: 3 },
        ],
        rows: ['d'],
        cols: ['q'],
        values: [
          { field: 'v', agg: 'sum', showAs: 'pct_row' },
          { field: 'w', agg: 'sum' }, // value
        ],
      }),
    )
    // v: 10/40=0.25, 30/40=0.75  /  w: raw 1, 3
    expect(r.values[0]?.[0]?.[0]).toBeCloseTo(0.25, 6)
    expect(r.values[0]?.[1]?.[0]).toBeCloseTo(0.75, 6)
    expect(r.values[0]?.[0]?.[1]).toBe(1)
    expect(r.values[0]?.[1]?.[1]).toBe(3)
  })
})

// ─────────────────────────────────────────────────────────────────────────
// Sprint 4 — calculated field (measure.expr)
// ─────────────────────────────────────────────────────────────────────────

describe('pivotEngine — Sprint 4 calculated field', () => {
  it('expr "revenue - cost" + agg sum — per-row 평가 후 합산', () => {
    const r = buildPivot(
      mk({
        sourceRows: [
          { dept: 'A', revenue: 100, cost: 30 }, // profit 70
          { dept: 'A', revenue: 200, cost: 80 }, // profit 120
          { dept: 'B', revenue: 50, cost: 10 }, // profit 40
        ],
        rows: ['dept'],
        values: [{ expr: 'revenue - cost', agg: 'sum' }] as PivotTableBlock['values'],
      }),
    )
    // A: 70+120=190, B: 40
    expect(r.values[0]?.[0]?.[0]).toBe(190)
    expect(r.values[1]?.[0]?.[0]).toBe(40)
  })

  it('expr "profit / revenue" + agg avg — per-row 비율 평균', () => {
    const r = buildPivot(
      mk({
        sourceRows: [
          { d: 'X', profit: 20, revenue: 100 }, // 0.2
          { d: 'X', profit: 40, revenue: 100 }, // 0.4
          { d: 'X', profit: 30, revenue: 100 }, // 0.3
        ],
        rows: ['d'],
        values: [{ expr: 'profit / revenue', agg: 'avg' }] as PivotTableBlock['values'],
      }),
    )
    // mean(0.2, 0.4, 0.3) = 0.3
    expect(r.values[0]?.[0]?.[0]).toBeCloseTo(0.3, 6)
  })

  it('잘못된 expr (syntax error) → 모든 row null → cell null (graceful)', () => {
    const r = buildPivot(
      mk({
        sourceRows: [
          { d: 'X', revenue: 10, cost: 2 },
          { d: 'X', revenue: 20, cost: 5 },
        ],
        rows: ['d'],
        // missing right operand — `parseExpr` throws → aggregate returns null/0
        values: [{ expr: 'revenue -', agg: 'sum' }] as PivotTableBlock['values'],
      }),
    )
    expect(r.values[0]?.[0]?.[0]).toBeNull()
  })

  it('row 에 ref field 없으면 그 row 만 skip — 나머지는 정상 합산', () => {
    const r = buildPivot(
      mk({
        sourceRows: [
          { d: 'X', a: 10, b: 1 }, // a-b = 9
          { d: 'X', a: 20 }, // b 없음 → skip
          { d: 'X', a: 5, b: 1 }, // a-b = 4
        ],
        rows: ['d'],
        values: [{ expr: 'a - b', agg: 'sum' }] as PivotTableBlock['values'],
      }),
    )
    // 9 + 4 = 13 (가운데 row drop)
    expect(r.values[0]?.[0]?.[0]).toBe(13)
  })

  it('divide-by-zero 인 row 는 skip — Infinity 가 표 안에 새지 않음', () => {
    const r = buildPivot(
      mk({
        sourceRows: [
          { d: 'X', a: 10, b: 0 }, // 10/0 → skip
          { d: 'X', a: 6, b: 2 }, // 3
          { d: 'X', a: 8, b: 2 }, // 4
        ],
        rows: ['d'],
        values: [{ expr: 'a / b', agg: 'sum' }] as PivotTableBlock['values'],
      }),
    )
    // 3 + 4 = 7
    expect(r.values[0]?.[0]?.[0]).toBe(7)
  })

  it('expr 가 있으면 field 는 무시 (둘 다 있어도 expr 우선)', () => {
    const r = buildPivot(
      mk({
        sourceRows: [
          { d: 'X', a: 10, b: 1, garbage: 9999 },
          { d: 'X', a: 5, b: 1, garbage: 9999 },
        ],
        rows: ['d'],
        // field='garbage' 라도 expr 이 우선 → 결과는 (10+1)+(5+1)=17
        values: [{ field: 'garbage', expr: 'a + b', agg: 'sum' }] as PivotTableBlock['values'],
      }),
    )
    expect(r.values[0]?.[0]?.[0]).toBe(17)
  })

  it('count(expr) — finite 결과 row 수만 카운트 (skip 된 row 제외)', () => {
    const r = buildPivot(
      mk({
        sourceRows: [
          { d: 'X', a: 1, b: 1 }, // OK
          { d: 'X', a: 2, b: 0 }, // div-zero → skip
          { d: 'X', a: 3 }, // missing b → skip
          { d: 'X', a: 4, b: 2 }, // OK
        ],
        rows: ['d'],
        values: [{ expr: 'a / b', agg: 'count' }] as PivotTableBlock['values'],
      }),
    )
    // 2 finite rows
    expect(r.values[0]?.[0]?.[0]).toBe(2)
  })

  it('expr + cross-tab + totals: row total 도 raw 재집계 (expr per-row 평가)', () => {
    const r = buildPivot(
      mk({
        sourceRows: [
          { d: 'A', q: 'Q1', rev: 100, cost: 30 }, // 70
          { d: 'A', q: 'Q2', rev: 200, cost: 50 }, // 150
          { d: 'B', q: 'Q1', rev: 80, cost: 20 }, // 60
        ],
        rows: ['d'],
        cols: ['q'],
        values: [{ expr: 'rev - cost', agg: 'sum' }] as PivotTableBlock['values'],
        totals: { row: true, grand: true },
      }),
    )
    // 셀: A/Q1=70, A/Q2=150, B/Q1=60
    expect(r.values).toEqual([
      [[70], [150]],
      [[60], [null]],
    ])
    // rowTotals: A=220, B=60
    expect(r.rowTotals).toEqual([[220], [60]])
    // grand = 280
    expect(r.grandTotals).toEqual([280])
  })

  it('expr 와 field 측정값 혼합 — 둘 다 정상 동작', () => {
    const r = buildPivot(
      mk({
        sourceRows: [
          { d: 'X', rev: 100, cost: 30 },
          { d: 'X', rev: 200, cost: 80 },
        ],
        rows: ['d'],
        values: [
          { field: 'rev', agg: 'sum' },
          { expr: 'rev - cost', agg: 'sum' },
        ] as PivotTableBlock['values'],
      }),
    )
    // measure 0: sum(rev) = 300, measure 1: sum(rev-cost) = 70+120=190
    expect(r.values[0]?.[0]).toEqual([300, 190])
  })

  it('expr label fallback — measure label 미설정 시 `agg(expr)` 형식 (sort/header 매칭)', () => {
    const r = buildPivot(
      mk({
        sourceRows: [
          { d: 'A', a: 5, b: 1 },
          { d: 'B', a: 10, b: 2 },
        ],
        rows: ['d'],
        cols: [],
        values: [{ expr: 'a + b', agg: 'sum' }] as PivotTableBlock['values'],
        sort: { axis: 'row', by: 'sum(a + b)', order: 'desc' },
      }),
    )
    // sort by label 'sum(a + b)' desc: B(12) > A(6)
    expect(r.rowHeaders).toEqual([['B'], ['A']])
  })
})

// ─────────────────────────────────────────────────────────────────────────
// Sprint 4 — parseExpr / evalExprForRow 단위 테스트 (parser 정확성)
// ─────────────────────────────────────────────────────────────────────────

describe('parseExpr / evalExprForRow', () => {
  it('연산자 precedence — * / 가 + - 보다 우선', () => {
    const ast = parseExpr('a + b * c')
    expect(evalExprForRow(ast, { a: 1, b: 2, c: 3 })).toBe(7) // 1 + (2*3) = 7
  })

  it('괄호 우선', () => {
    const ast = parseExpr('(a + b) * c')
    expect(evalExprForRow(ast, { a: 1, b: 2, c: 3 })).toBe(9)
  })

  it('unary minus + 소수 literal', () => {
    const ast = parseExpr('-a + 0.5')
    expect(evalExprForRow(ast, { a: 2 })).toBe(-1.5)
  })

  it('field 누락 → null (throw 안 함)', () => {
    const ast = parseExpr('a + b')
    expect(evalExprForRow(ast, { a: 1 })).toBeNull()
  })

  it('field 가 non-numeric string → null', () => {
    const ast = parseExpr('a * 2')
    expect(evalExprForRow(ast, { a: 'oops' })).toBeNull()
  })

  it('잘못된 expr → parseExpr throw', () => {
    expect(() => parseExpr('a +')).toThrow()
    expect(() => parseExpr('(a + b')).toThrow()
    expect(() => parseExpr('a @ b')).toThrow()
  })
})

describe('drillRows (cell → raw rows)', () => {
  it('row + col 일치하는 raw rows 만 반환 (1 dim row × 1 dim col)', () => {
    const block = mk({
      sourceRows: [
        { dept: 'Sales', year: '2024', v: 100 },
        { dept: 'Sales', year: '2025', v: 150 },
        { dept: 'R&D', year: '2024', v: 80 },
        { dept: 'Sales', year: '2024', v: 20 },
      ],
      rows: ['dept'],
      cols: ['year'],
    })
    expect(drillRows(block, ['Sales'], ['2024'])).toEqual([
      { dept: 'Sales', year: '2024', v: 100 },
      { dept: 'Sales', year: '2024', v: 20 },
    ])
    expect(drillRows(block, ['R&D'], ['2024'])).toEqual([
      { dept: 'R&D', year: '2024', v: 80 },
    ])
    // 빈 셀 (R&D × 2025) → no rows
    expect(drillRows(block, ['R&D'], ['2025'])).toEqual([])
  })

  it('multi-dim row + multi-dim col 도 정확 일치', () => {
    const block = mk({
      sourceRows: [
        { dept: 'Sales', team: 'A', y: '24', q: 'Q1', v: 1 },
        { dept: 'Sales', team: 'A', y: '24', q: 'Q2', v: 2 },
        { dept: 'Sales', team: 'B', y: '24', q: 'Q1', v: 3 },
        { dept: 'Sales', team: 'A', y: '25', q: 'Q1', v: 4 },
      ],
      rows: ['dept', 'team'],
      cols: ['y', 'q'],
    })
    expect(drillRows(block, ['Sales', 'A'], ['24', 'Q1'])).toEqual([
      { dept: 'Sales', team: 'A', y: '24', q: 'Q1', v: 1 },
    ])
    expect(drillRows(block, ['Sales', 'A'], ['25', 'Q1'])).toEqual([
      { dept: 'Sales', team: 'A', y: '25', q: 'Q1', v: 4 },
    ])
  })

  it('cols=[] (flat aggregation) — colKey=[] 면 row 조건만 매칭', () => {
    const block = mk({
      sourceRows: [
        { dept: 'Sales', v: 10 },
        { dept: 'R&D', v: 20 },
        { dept: 'Sales', v: 30 },
      ],
      rows: ['dept'],
      cols: [],
    })
    expect(drillRows(block, ['Sales'], [])).toEqual([
      { dept: 'Sales', v: 10 },
      { dept: 'Sales', v: 30 },
    ])
  })

  it('숫자 vs 문자열 dim value 도 dimValue (String 변환) 로 일치', () => {
    const block = mk({
      sourceRows: [
        // 숫자 year — header 는 '2024'
        { dept: 'Sales', year: 2024, v: 100 },
        { dept: 'Sales', year: 2024, v: 50 },
      ],
      rows: ['dept'],
      cols: ['year'],
    })
    // viewer header 는 '2024' 문자열로 표시되므로 drillRows 도 '2024' 로 들어옴
    expect(drillRows(block, ['Sales'], ['2024'])).toEqual([
      { dept: 'Sales', year: 2024, v: 100 },
      { dept: 'Sales', year: 2024, v: 50 },
    ])
  })

  it('filters 가 buildPivot 과 동일하게 적용된 뒤 dim 매칭', () => {
    const block = mk({
      sourceRows: [
        { dept: 'Sales', v: 10 },
        { dept: 'Sales', v: 50 }, // gt:20 으로 살아남음
        { dept: 'R&D', v: 30 },
      ],
      rows: ['dept'],
      cols: [],
      filters: [{ field: 'v', op: 'gt', value: 20 }],
    })
    expect(drillRows(block, ['Sales'], [])).toEqual([
      { dept: 'Sales', v: 50 },
    ])
    expect(drillRows(block, ['R&D'], [])).toEqual([
      { dept: 'R&D', v: 30 },
    ])
  })

  it('일치하는 row 가 없으면 빈 배열', () => {
    const block = mk({
      sourceRows: [{ dept: 'Sales', y: '24', v: 1 }],
      rows: ['dept'],
      cols: ['y'],
    })
    expect(drillRows(block, ['Marketing'], ['24'])).toEqual([])
    expect(drillRows(block, ['Sales'], ['99'])).toEqual([])
  })
})

