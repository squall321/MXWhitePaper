import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ChartBlockView } from '../ChartBlock'
import type { ChartBlock } from '@/types/document'

// H2 (G5) — ChartBlockView 가 useQuery 를 호출하므로 QueryClientProvider
// 래핑이 필요. provider 가 없으면 "No QueryClient set" 에러.
function ssr(node: ReactNode): string {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  })
  return renderToStaticMarkup(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

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
    const html = ssr(<ChartBlockView block={block} />)
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
    const html = ssr(<ChartBlockView block={block} />)
    expect(html).toContain('recharts-responsive-container')
  })

  it('falls back gracefully when there is no data', () => {
    const block: ChartBlock = {
      type: 'chart',
      id: '01TESTBLOCK000000000000CE',
      chartType: 'pie',
      data: { labels: [], series: [] },
    }
    const html = ssr(<ChartBlockView block={block} />)
    expect(html).toContain('recharts-responsive-container')
  })
})
