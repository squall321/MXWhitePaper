import { describe, it, expect } from 'vitest'
import {
  mergeThemeColors,
  THEME_COLORS_LIGHT,
  THEME_COLORS_DARK,
} from '../EChartsView'

describe('mergeThemeColors()', () => {
  it('light theme injects dark text and pale axis tokens', () => {
    const opt = mergeThemeColors(
      {
        xAxis: { type: 'category' as const, data: ['a', 'b'] },
        yAxis: { type: 'value' as const },
        tooltip: { trigger: 'axis' as const },
      },
      THEME_COLORS_LIGHT,
    ) as Record<string, unknown>
    const text = (opt.textStyle as { color: string }).color
    const xAxis = opt.xAxis as { axisLabel: { color: string }; splitLine: { lineStyle: { color: string } } }
    expect(text).toBe('#1A1A1A')
    expect(xAxis.axisLabel.color).toBe('#1A1A1A')
    expect(xAxis.splitLine.lineStyle.color).toBe('#F3F4F6')
  })

  it('dark theme injects pale text and dark-gray axis tokens', () => {
    const opt = mergeThemeColors(
      {
        xAxis: { type: 'category' as const, data: ['a', 'b'] },
        yAxis: { type: 'value' as const },
      },
      THEME_COLORS_DARK,
    ) as Record<string, unknown>
    const text = (opt.textStyle as { color: string }).color
    const xAxis = opt.xAxis as { axisLine: { lineStyle: { color: string } }; axisLabel: { color: string } }
    expect(text).toBe('#E5E7EB')
    expect(xAxis.axisLine.lineStyle.color).toBe('#374151')
    expect(xAxis.axisLabel.color).toBe('#E5E7EB')
  })

  it('is idempotent — running twice yields the same result', () => {
    const base = { xAxis: { type: 'value' as const }, yAxis: { type: 'value' as const } }
    const once = mergeThemeColors(base, THEME_COLORS_DARK)
    const twice = mergeThemeColors(once, THEME_COLORS_DARK)
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once))
  })

  it('preserves arrays for dual-y (xAxis as array)', () => {
    const opt = mergeThemeColors(
      {
        xAxis: { type: 'value' as const },
        yAxis: [
          { type: 'value' as const, name: 'left' },
          { type: 'value' as const, name: 'right' },
        ],
      },
      THEME_COLORS_DARK,
    ) as Record<string, unknown>
    expect(Array.isArray(opt.yAxis)).toBe(true)
    const ys = opt.yAxis as Array<{ axisLabel: { color: string } } | undefined>
    expect(ys).toHaveLength(2)
    expect(ys[0]?.axisLabel.color).toBe('#E5E7EB')
    expect(ys[1]?.axisLabel.color).toBe('#E5E7EB')
  })
})
