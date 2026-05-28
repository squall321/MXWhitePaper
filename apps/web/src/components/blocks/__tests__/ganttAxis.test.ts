import { describe, it, expect } from 'vitest'
import { axisTicks } from '../ganttAxis'

const MS = (iso: string) => Date.parse(iso)

describe('axisTicks — month', () => {
  it('emits one tick per month start inside [min,max]', () => {
    const ticks = axisTicks(MS('2026-01-01'), MS('2026-04-15'), 'month')
    // 1/1, 2/1, 3/1, 4/1 — all inside range.
    expect(ticks.map((t) => t.label)).toEqual(['2026-01', '02월', '03월', '04월'])
  })

  it('skips months whose 1st is outside the range', () => {
    const ticks = axisTicks(MS('2026-01-15'), MS('2026-02-15'), 'month')
    // 2/1 is the only month-start fully inside; 1/1 is before min.
    expect(ticks.map((t) => t.label)).toEqual(['02월'])
  })
})

describe('axisTicks — quarter', () => {
  it('emits one tick per quarter start inside [min,max]', () => {
    const ticks = axisTicks(MS('2026-01-01'), MS('2026-12-31'), 'quarter')
    expect(ticks.map((t) => t.label)).toEqual([
      '2026 Q1',
      '2026 Q2',
      '2026 Q3',
      '2026 Q4',
    ])
  })
})

describe('axisTicks — week', () => {
  it('emits Mondays inside the range', () => {
    // 2026-01-05 is the first Monday on/after 2026-01-01.
    const ticks = axisTicks(MS('2026-01-01'), MS('2026-01-20'), 'week')
    // Mondays: 01-05, 01-12, 01-19
    expect(ticks.map((t) => t.label)).toEqual(['01-05', '01-12', '01-19'])
  })
})

describe('axisTicks — fallback', () => {
  it('falls back from day → larger unit when ticks exceed cap', () => {
    // 2 years of daily ticks would be ~730 — cap at 40 should fallback to week or larger.
    const ticks = axisTicks(MS('2024-01-01'), MS('2025-12-31'), 'day')
    expect(ticks.length).toBeLessThanOrEqual(40)
  })

  it('returns [] when range is degenerate', () => {
    expect(axisTicks(NaN, MS('2026-01-01'), 'month')).toEqual([])
    expect(axisTicks(MS('2026-02-01'), MS('2026-01-01'), 'month')).toEqual([])
  })
})
