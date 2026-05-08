import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ChartBlockView } from '../ChartBlock'
import type { ChartBlock } from '@/types/document'

const baseData: ChartBlock['data'] = {
  labels: ['Q1', 'Q2', 'Q3', 'Q4'],
  series: [
    { name: 'Revenue', values: [10, 20, 15, 30] },
    { name: 'Cost', values: [5, 12, 8, 18] },
  ],
}

describe('<ChartBlockView />', () => {
  it('renders an SVG line-chart container for chartType="line"', () => {
    const block: ChartBlock = {
      type: 'chart',
      id: '01TESTBLOCK000000000000CL',
      chartType: 'line',
      title: 'KPI 추이',
      data: baseData,
    }
    const html = renderToStaticMarkup(<ChartBlockView block={block} />)
    // The Recharts ResponsiveContainer ships the chart container even at SSR.
    expect(html).toContain('recharts-responsive-container')
    expect(html).toContain('KPI 추이')
  })

  it('renders for bar charts as well', () => {
    const block: ChartBlock = {
      type: 'chart',
      id: '01TESTBLOCK000000000000CB',
      chartType: 'bar',
      data: baseData,
    }
    const html = renderToStaticMarkup(<ChartBlockView block={block} />)
    expect(html).toContain('recharts-responsive-container')
  })

  it('falls back gracefully when there is no data', () => {
    const block: ChartBlock = {
      type: 'chart',
      id: '01TESTBLOCK000000000000CE',
      chartType: 'pie',
      data: { labels: [], series: [] },
    }
    const html = renderToStaticMarkup(<ChartBlockView block={block} />)
    expect(html).toContain('recharts-responsive-container')
  })
})
