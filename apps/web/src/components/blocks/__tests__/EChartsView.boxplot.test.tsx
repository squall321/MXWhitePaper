import { describe, it, expect } from 'vitest'
import { buildOption, computeBoxStats } from '../EChartsView'
import type { ChartBlock } from '@/types/document'

// CHART-05 — boxplot 차트. 시리즈마다 1 박스, raw mode = 관측값 배열에서
// 자동 사분위 계산, precomputed mode = [min, Q1, median, Q3, max] 직접 입력.

function makeRaw(): ChartBlock {
  // 1..9 관측값 두 시리즈 — 단순 정수 분포로 사분위가 명확하게 떨어지는 케이스.
  return {
    type: 'chart',
    id: '01TESTBOXPLOT0000000000RAW',
    chartType: 'boxplot',
    data: {
      labels: [],
      series: [
        { name: 'A', values: [1, 2, 3, 4, 5, 6, 7, 8, 9] },
        { name: 'B', values: [2, 4, 6, 8, 10] },
      ],
    },
  } as ChartBlock
}

function makePrecomputed(): ChartBlock {
  return {
    type: 'chart',
    id: '01TESTBOXPLOT00000000PREC0',
    chartType: 'boxplot',
    data: {
      labels: ['lot-1', 'lot-2'],
      series: [
        { name: 'lot-1', values: [1, 3, 5, 7, 9] }, // [min, Q1, median, Q3, max]
        { name: 'lot-2', values: [2, 4, 6, 8, 10] },
      ],
    },
    options: { boxplotMode: 'precomputed' },
  } as ChartBlock
}

describe('EChartsView buildOption — boxplot (CHART-05)', () => {
  it('raw mode: series.type === "boxplot" 이고 시리즈 수만큼 data row', () => {
    const opt = buildOption(makeRaw()) as any
    expect(opt.series).toHaveLength(1)
    expect(opt.series[0].type).toBe('boxplot')
    expect(opt.series[0].data).toHaveLength(2)
    // 첫 번째 박스 — 1..9 의 [min, Q1, median, Q3, max] = [1, 3, 5, 7, 9]
    expect(opt.series[0].data[0].value).toEqual([1, 3, 5, 7, 9])
    // xAxis 카테고리는 시리즈명 (labels 비어있을 때 fallback)
    expect(opt.xAxis.type).toBe('category')
    expect(opt.xAxis.data).toEqual(['A', 'B'])
  })

  it('precomputed mode: values 5-tuple 을 그대로 전달', () => {
    const opt = buildOption(makePrecomputed()) as any
    expect(opt.series[0].type).toBe('boxplot')
    expect(opt.series[0].data[0].value).toEqual([1, 3, 5, 7, 9])
    expect(opt.series[0].data[1].value).toEqual([2, 4, 6, 8, 10])
    // labels 가 명시되어 있으면 그걸 카테고리로 사용.
    expect(opt.xAxis.data).toEqual(['lot-1', 'lot-2'])
  })

  it('precomputed mode: 길이 != 5 시리즈는 skip', () => {
    const block: ChartBlock = {
      type: 'chart',
      id: '01TESTBOXPLOT0000000SKIP0',
      chartType: 'boxplot',
      data: {
        labels: [],
        series: [
          { name: 'ok', values: [0, 1, 2, 3, 4] },
          { name: 'bad', values: [1, 2, 3] }, // 길이 3 → skip
        ],
      },
      options: { boxplotMode: 'precomputed' },
    } as ChartBlock
    const opt = buildOption(block) as any
    expect(opt.series[0].data).toHaveLength(1)
    expect(opt.xAxis.data).toEqual(['ok'])
  })

  it('series.color override 가 box 색상에 적용', () => {
    const block: ChartBlock = {
      type: 'chart',
      id: '01TESTBOXPLOT000000COLOR0',
      chartType: 'boxplot',
      data: {
        labels: [],
        series: [{ name: 'A', values: [1, 2, 3], color: '#FF0000' }],
      },
    } as ChartBlock
    const opt = buildOption(block) as any
    expect(opt.series[0].data[0].itemStyle.color).toBe('#FF0000')
    expect(opt.series[0].data[0].itemStyle.borderColor).toBe('#FF0000')
  })
})

describe('computeBoxStats()', () => {
  it('1..9 → [1, 3, 5, 7, 9]', () => {
    expect(computeBoxStats([1, 2, 3, 4, 5, 6, 7, 8, 9])).toEqual([1, 3, 5, 7, 9])
  })

  it('단일 값 → 다섯 자리 모두 같음', () => {
    expect(computeBoxStats([42])).toEqual([42, 42, 42, 42, 42])
  })

  it('정렬되지 않은 입력도 동일 결과', () => {
    expect(computeBoxStats([9, 1, 5, 3, 7])).toEqual([1, 3, 5, 7, 9])
  })
})
