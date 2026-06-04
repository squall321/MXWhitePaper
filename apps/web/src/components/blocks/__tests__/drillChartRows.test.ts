/**
 * J — drillChartRows unit tests.
 *
 * Helper takes raw rows + the same filter list the aggregator already
 * applied + a clicked labelField/label, and returns the rows that
 * contributed to that bucket. Mirrors PivotTable's `drillRows`.
 */
import { describe, expect, it } from 'vitest'
import { drillChartRows } from '../pivotEngine'

const ROWS = [
  { dept: 'Sales', date: '2026-01-15', amount: 120 },
  { dept: 'R&D', date: '2026-01-22', amount: 80 },
  { dept: 'HR', date: '2026-02-05', amount: 35 },
  { dept: 'Sales', date: '2026-02-18', amount: 150 },
  { dept: 'R&D', date: '2026-03-02', amount: 90 },
  { dept: 'Sales', date: '2026-03-15', amount: 200 },
]

describe('drillChartRows', () => {
  it('labelField 의 정확히 일치하는 row 만 반환', () => {
    const rows = drillChartRows(ROWS, undefined, 'dept', 'Sales')
    expect(rows).toHaveLength(3)
    expect(rows.every((r) => r.dept === 'Sales')).toBe(true)
  })

  it('filters 가 raw rows 에 먼저 적용된 후 label 매칭', () => {
    const rows = drillChartRows(
      ROWS,
      [{ field: 'amount', op: 'gt', value: 100 }] as never,
      'dept',
      'Sales',
    )
    // Sales > 100: 120, 150, 200 (3 rows)
    expect(rows).toHaveLength(3)
    expect(rows.map((r) => r.amount)).toEqual([120, 150, 200])
  })

  it('between filter (timeline 호환) 가 ISO date 로 동작', () => {
    const rows = drillChartRows(
      ROWS,
      [{ field: 'date', op: 'between', value: ['2026-02-01', '2026-02-28'] }] as never,
      'dept',
      'Sales',
    )
    // Sales in Feb: 2026-02-18 → 150
    expect(rows).toHaveLength(1)
    expect(rows[0]?.amount).toBe(150)
  })

  it('labelField 가 비어있으면 빈 배열', () => {
    expect(drillChartRows(ROWS, undefined, '', 'Sales')).toEqual([])
  })

  it('일치하는 label 이 없으면 빈 배열', () => {
    expect(drillChartRows(ROWS, undefined, 'dept', 'Marketing')).toEqual([])
  })

  it('null label cell 은 매칭하지 않음', () => {
    const rows = drillChartRows(
      [
        { dept: 'Sales', amount: 100 },
        { dept: null, amount: 50 } as never,
      ],
      undefined,
      'dept',
      '',
    )
    expect(rows).toEqual([])
  })
})
