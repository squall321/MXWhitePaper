import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ChartBlockView, getRechartsPalette } from '../ChartBlock'
import type { ChartBlock } from '@/types/document'

const block: ChartBlock = {
  type: 'chart',
  id: '01TESTBLOCK000000000CHARTD',
  chartType: 'line',
  data: {
    labels: ['Jan', 'Feb', 'Mar'],
    series: [{ name: 'sales', values: [10, 20, 15] }],
  },
}

describe('<ChartBlockView /> darkmode classes (recharts engine)', () => {
  it('figure surface declares dark variants for border/bg', () => {
    const html = renderToStaticMarkup(<ChartBlockView block={block} />)
    expect(html).toContain('dark:bg-gray-900')
    expect(html).toContain('dark:border-gray-700')
  })

  it('figure title gets dark-mode text-color variant', () => {
    const withTitle: ChartBlock = { ...block, title: 'Sales' }
    const html = renderToStaticMarkup(<ChartBlockView block={withTitle} />)
    expect(html).toContain('dark:text-gray-100')
    expect(html).toContain('Sales')
  })
})

describe('getRechartsPalette()', () => {
  it('light theme returns the standard 8-colour palette starting with smsg-blue-700', () => {
    const p = getRechartsPalette('light')
    expect(p).toHaveLength(8)
    expect(p[0]).toBe('#1428A0')
    expect(p[1]).toBe('#2E5BFF')
  })

  it('dark theme returns brighter variants — same length, index 0 stays blue family', () => {
    const p = getRechartsPalette('dark')
    expect(p).toHaveLength(8)
    expect(p[0]).toBe('#93A5FF')
    expect(p[1]).toBe('#6E8BFF')
    // Index 0 is blue: B channel > R, G
    const hex = p[0]!
    const r = parseInt(hex.slice(1, 3), 16)
    const g = parseInt(hex.slice(3, 5), 16)
    const b = parseInt(hex.slice(5, 7), 16)
    expect(b).toBeGreaterThan(r)
    expect(b).toBeGreaterThan(g)
  })
})
