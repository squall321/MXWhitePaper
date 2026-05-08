import { describe, it, expect } from 'vitest'
import { buildChartFromTable, tableToChartData } from '../tableToChart'
import type { TableBlock } from '@/types/document'

const sampleTable: TableBlock = {
  type: 'table',
  id: '01TESTTABLE0000000000000XX',
  headers: ['월', 'A 지표', 'B 지표'],
  rows: [
    ['1월', '10', '20'],
    ['2월', '14', '22'],
    ['3월', '17', '25'],
  ],
}

describe('tableToChartData', () => {
  it('takes the first column as labels', () => {
    const data = tableToChartData(sampleTable)
    expect(data.labels).toEqual(['1월', '2월', '3월'])
  })
  it('promotes remaining columns to numeric series', () => {
    const data = tableToChartData(sampleTable)
    expect(data.series).toHaveLength(2)
    expect(data.series[0]?.name).toBe('A 지표')
    expect(data.series[0]?.values).toEqual([10, 14, 17])
    expect(data.series[1]?.values).toEqual([20, 22, 25])
  })
  it('coerces non-numeric cells to 0', () => {
    const data = tableToChartData({
      type: 'table',
      id: 'x',
      headers: ['k', 'v'],
      rows: [
        ['a', 'NaN'],
        ['b', '5'],
      ],
    })
    expect(data.series[0]?.values).toEqual([0, 5])
  })
  it('handles single-column tables (no series)', () => {
    const data = tableToChartData({
      type: 'table',
      id: 'x',
      headers: ['only'],
      rows: [['a'], ['b']],
    })
    expect(data.series).toHaveLength(0)
    expect(data.labels).toEqual(['a', 'b'])
  })
})

describe('buildChartFromTable', () => {
  it('builds a ChartBlock with chartType=bar by default', () => {
    const chart = buildChartFromTable(sampleTable)
    expect(chart.type).toBe('chart')
    expect(chart.chartType).toBe('bar')
    expect(chart.id.length).toBeGreaterThan(0)
    expect(chart.data.labels).toHaveLength(3)
  })
  it('respects an override chartType', () => {
    const chart = buildChartFromTable(sampleTable, 'pie')
    expect(chart.chartType).toBe('pie')
  })
})
