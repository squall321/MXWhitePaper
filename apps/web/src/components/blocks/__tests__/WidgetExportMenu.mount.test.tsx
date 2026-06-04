import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { KpiCardsBlockView } from '../KpiCardsBlock'
import { GanttBlockView } from '../GanttBlock'
import { ChartBlockView } from '../ChartBlock'
import type {
  ChartBlock,
  GanttBlock,
  KpiCardsBlock,
} from '@/types/document'

// H2 — ChartBlockView 가 useQuery 호출하므로 provider 래핑.
// I (cycle b) — KpiCardsBlockView 도 같은 이유로 동일 래퍼 사용 (helper
// 명칭은 history 보존 차원에서 ssrChart 그대로; 다른 widget 도 같이 쓰는
// 의미를 강조하려면 ssrWithQuery 로 rename 가능).
function ssrChart(node: ReactNode): string {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  })
  return renderToStaticMarkup(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

// Stubs — the same pattern used by other block tests.
vi.mock('@/features/glossary/useGlossary', () => ({
  useGlossary: () => ({ terms: [], lookup: () => undefined, findEntry: () => undefined }),
}))
vi.mock('@/features/theme/useResolvedTheme', () => ({
  useResolvedTheme: () => 'light',
}))

describe('WidgetExportMenu mounts on each widget block', () => {
  it('KpiCardsBlockView wraps content with data-export-root="kpi-cards"', () => {
    const block: KpiCardsBlock = {
      type: 'kpi-cards',
      id: '01KPI0000000000000000000A',
      items: [{ label: 'Revenue', value: '1.2B', delta: '+3%', trend: 'up' }],
    }
    const html = ssrChart(<KpiCardsBlockView block={block} />)
    expect(html).toContain('data-export-root="kpi-cards"')
    expect(html).toContain('data-widget-export-toggle')
  })

  it('GanttBlockView wraps content with data-export-root="gantt"', () => {
    const block: GanttBlock = {
      type: 'gantt',
      id: '01GANTT00000000000000000A',
      tasks: [
        { name: 'Phase 1', start: '2026-01-01', end: '2026-01-15', progress: 100 },
        { name: 'Phase 2', start: '2026-01-16', end: '2026-02-28' },
      ],
    }
    const html = renderToStaticMarkup(<GanttBlockView block={block} today="2026-01-20" />)
    expect(html).toContain('data-export-root="gantt"')
    expect(html).toContain('data-widget-export-toggle')
    // SVG remains present after the wrapper change.
    expect(html).toContain('<svg')
  })

  it('ChartBlockView wraps recharts mode with data-export-root="chart"', () => {
    const block: ChartBlock = {
      type: 'chart',
      id: '01CHART00000000000000000A',
      chartType: 'bar',
      title: 'Sales',
      data: {
        labels: ['Q1', 'Q2'],
        series: [{ name: 'Rev', values: [100, 200] }],
        xAxisLabel: 'Quarter',
      },
    }
    const html = ssrChart(<ChartBlockView block={block} />)
    expect(html).toContain('data-export-root="chart"')
    expect(html).toContain('data-widget-export-toggle')
  })

  it('GanttBlockView with one task still mounts the menu (no early return)', () => {
    const block: GanttBlock = {
      type: 'gantt',
      id: '01GANTTSOLO00000000000000',
      tasks: [{ name: 'Only', start: '2026-03-01', end: '2026-03-05' }],
    }
    const html = renderToStaticMarkup(<GanttBlockView block={block} />)
    expect(html).toContain('data-widget-export-toggle')
  })
})
