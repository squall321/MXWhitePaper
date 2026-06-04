/**
 * H2 (G5) — `aggregateChartData` unit tests.
 *
 * Helper pivots raw rows by `labelField` and reduces each per-series
 * `field` with the chosen aggregator. Chart engine consumes the result
 * as-is — no further transform.
 */
import { describe, expect, it } from 'vitest'
import { aggregateChartData } from '../pivotEngine'

describe('aggregateChartData', () => {
  const ROWS = [
    { dept: 'Sales', date: '2026-01-15', amount: 120 },
    { dept: 'R&D', date: '2026-01-22', amount: 80 },
    { dept: 'HR', date: '2026-02-05', amount: 35 },
    { dept: 'Sales', date: '2026-02-18', amount: 150 },
    { dept: 'R&D', date: '2026-03-02', amount: 90 },
    { dept: 'Sales', date: '2026-03-15', amount: 200 },
  ]

  it('labels = labelField distinct, first-seen order', () => {
    const { labels } = aggregateChartData(
      ROWS,
      'dept',
      [{ field: 'amount', agg: 'sum' }],
      undefined,
    )
    expect(labels).toEqual(['Sales', 'R&D', 'HR'])
  })

  it('series sum per bucket', () => {
    const { series } = aggregateChartData(
      ROWS,
      'dept',
      [{ field: 'amount', agg: 'sum', name: '매출' }],
      undefined,
    )
    expect(series).toHaveLength(1)
    expect(series[0]?.name).toBe('매출')
    expect(series[0]?.values).toEqual([470, 170, 35])
  })

  it('multiple series — one per aggregation entry', () => {
    const { series } = aggregateChartData(
      ROWS,
      'dept',
      [
        { field: 'amount', agg: 'sum', name: '합계' },
        { field: 'amount', agg: 'avg', name: '평균' },
        { field: 'amount', agg: 'count', name: '건수' },
      ],
      undefined,
    )
    expect(series.map((s) => s.name)).toEqual(['합계', '평균', '건수'])
    expect(series[0]?.values).toEqual([470, 170, 35])
    expect(series[1]?.values).toEqual([470 / 3, 170 / 2, 35])
    expect(series[2]?.values).toEqual([3, 2, 1])
  })

  it('filters 가 raw rows 에 적용된 후 집계', () => {
    const { labels, series } = aggregateChartData(
      ROWS,
      'dept',
      [{ field: 'amount', agg: 'sum' }],
      [{ field: 'dept', op: 'in', value: ['Sales'] }] as never,
    )
    expect(labels).toEqual(['Sales'])
    expect(series[0]?.values).toEqual([470])
  })

  it('between filter (timeline-호환) 가 ISO date 로 동작', () => {
    const { labels, series } = aggregateChartData(
      ROWS,
      'dept',
      [{ field: 'amount', agg: 'sum' }],
      [
        { field: 'date', op: 'between', value: ['2026-02-01', '2026-02-28'] },
      ] as never,
    )
    expect(labels).toEqual(['HR', 'Sales'])
    expect(series[0]?.values).toEqual([35, 150])
  })

  it('빈 labelField → labels [] + 각 시리즈 values []', () => {
    const { labels, series } = aggregateChartData(
      ROWS,
      'nonexistent',
      [{ field: 'amount', agg: 'sum' }],
      undefined,
    )
    expect(labels).toEqual([])
    expect(series).toHaveLength(1)
    expect(series[0]?.values).toEqual([])
  })

  it('aggregations 비어있으면 빈 결과 (방어적)', () => {
    expect(aggregateChartData(ROWS, 'dept', [], undefined)).toEqual({ labels: [], series: [] })
  })

  it('null cell → 0 으로 coerce (chart axis 가 number 요구)', () => {
    const { series } = aggregateChartData(
      [
        { dept: 'Sales', amount: 100 },
        { dept: 'R&D', amount: null },
      ] as never,
      'dept',
      [{ field: 'amount', agg: 'sum' }],
      undefined,
    )
    expect(series[0]?.values).toEqual([100, 0])
  })

  it('color / yAxisIndex 가 시리즈에 전달', () => {
    const { series } = aggregateChartData(
      ROWS,
      'dept',
      [
        { field: 'amount', agg: 'sum', name: '매출', color: '#1428A0', yAxisIndex: 1 },
      ],
      undefined,
    )
    expect(series[0]?.color).toBe('#1428A0')
    expect(series[0]?.yAxisIndex).toBe(1)
  })
})
