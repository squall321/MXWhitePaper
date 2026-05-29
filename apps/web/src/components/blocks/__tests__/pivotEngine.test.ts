/**
 * Sprint 1 — pivotEngine cross-tab + 8 aggregator 단위 검증.
 */
import { describe, expect, it } from 'vitest'
import { buildPivot } from '../pivotEngine'
import type { PivotTableBlock } from '@/types/document'

function mk(
  overrides: Partial<PivotTableBlock> & {
    rows?: string[]
    cols?: string[]
    values?: PivotTableBlock['values']
    sourceRows?: PivotTableBlock['source']['rows']
  },
): PivotTableBlock {
  return {
    type: 'pivot-table',
    id: '01TEST0PIVOT000000000000P0',
    source: { kind: 'inline', rows: overrides.sourceRows ?? [] },
    rows: overrides.rows ?? [],
    cols: overrides.cols ?? [],
    values: overrides.values ?? [{ field: 'v', agg: 'sum' }],
  }
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
