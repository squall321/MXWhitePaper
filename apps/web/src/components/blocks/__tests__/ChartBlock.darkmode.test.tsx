import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ChartBlockView } from '../ChartBlock'
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
