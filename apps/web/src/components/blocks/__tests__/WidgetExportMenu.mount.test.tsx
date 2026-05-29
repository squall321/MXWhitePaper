import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { KpiCardsBlockView } from '../KpiCardsBlock'
import { GanttBlockView } from '../GanttBlock'
import { ChartBlockView } from '../ChartBlock'
import type {
  ChartBlock,
  GanttBlock,
  KpiCardsBlock,
} from '@/types/document'

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
    const html = renderToStaticMarkup(<KpiCardsBlockView block={block} />)
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
    const html = renderToStaticMarkup(<ChartBlockView block={block} />)
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
