import { describe, it, expect } from 'vitest'
import { buildOption } from '../EChartsView'
import type { ChartBlock } from '@/types/document'

// xy-line 분기에서 시리즈 점 수가 100k 이상이면 LTTB + large 자동 적용,
// display.sampling 으로 사용자가 강제 ON/OFF 가능 — P4 §2.11.
function makeXyBlock(npoints: number, sampling?: 'none' | 'lttb'): ChartBlock {
  const points = Array.from({ length: npoints }, (_, i) => ({ x: i, y: i }))
  return {
    type: 'chart',
    id: '01TESTBLOCK000000000000CL',
    chartType: 'xy-line',
    data: { series: [{ name: 's1', points }] },
    display: sampling ? { sampling } : undefined,
  } as ChartBlock
}

describe('EChartsView buildOption — LTTB sampling (P4 §2.11)', () => {
  it('점이 적으면 sampling/large 미설정', () => {
    const opt = buildOption(makeXyBlock(100)) as any
    const dataSeries = (opt.series as any[]).filter((s) => s.type === 'line')
    expect(dataSeries[0].sampling).toBeUndefined()
    expect(dataSeries[0].large).toBeUndefined()
  })

  it('점이 100k 이상이면 sampling=lttb + large=true 자동', () => {
    const opt = buildOption(makeXyBlock(100_000)) as any
    const dataSeries = (opt.series as any[]).filter((s) => s.type === 'line')
    expect(dataSeries[0].sampling).toBe('lttb')
    expect(dataSeries[0].large).toBe(true)
  })

  it("display.sampling='none' 이면 100k 넘어도 미적용", () => {
    const opt = buildOption(makeXyBlock(100_000, 'none')) as any
    const dataSeries = (opt.series as any[]).filter((s) => s.type === 'line')
    expect(dataSeries[0].sampling).toBeUndefined()
    expect(dataSeries[0].large).toBeUndefined()
  })

  it("display.sampling='lttb' 이면 적은 점이라도 강제 적용", () => {
    const opt = buildOption(makeXyBlock(50, 'lttb')) as any
    const dataSeries = (opt.series as any[]).filter((s) => s.type === 'line')
    expect(dataSeries[0].sampling).toBe('lttb')
    expect(dataSeries[0].large).toBe(true)
  })
})
