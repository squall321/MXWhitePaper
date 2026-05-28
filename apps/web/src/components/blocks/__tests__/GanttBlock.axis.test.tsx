import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { GanttBlockView } from '../GanttBlock'
import type { GanttBlock } from '@/types/document'

const baseTasks: GanttBlock['tasks'] = [
  { name: 'Phase A', start: '2026-01-01', end: '2026-03-31' },
  { name: 'Phase B', start: '2026-02-01', end: '2026-05-31' },
]

describe('<GanttBlockView /> axisUnit toggle', () => {
  it('default axisUnit (month) renders month-boundary ticks', () => {
    const block: GanttBlock = {
      type: 'gantt',
      id: '01TESTBLOCK0000000AXISD01',
      tasks: baseTasks,
    }
    const html = renderToStaticMarkup(<GanttBlockView block={block} />)
    // 2026-01 / 02월 / 03월 / 04월 / 05월 should appear (month-default).
    expect(html).toContain('data-gantt-tick="02월"')
    expect(html).toContain('data-gantt-tick="03월"')
  })

  it('axisUnit=quarter renders Q-labels', () => {
    const block: GanttBlock = {
      type: 'gantt',
      id: '01TESTBLOCK0000000AXISQ01',
      tasks: baseTasks,
      options: { axisUnit: 'quarter' },
    }
    const html = renderToStaticMarkup(<GanttBlockView block={block} />)
    expect(html).toContain('data-gantt-tick="2026 Q2"')
    // Should NOT contain month-only ticks any more.
    expect(html).not.toContain('data-gantt-tick="03월"')
  })

  it('axisUnit=week renders Monday labels', () => {
    const block: GanttBlock = {
      type: 'gantt',
      id: '01TESTBLOCK0000000AXISW01',
      tasks: [{ name: 'Sprint', start: '2026-01-01', end: '2026-01-31' }],
      options: { axisUnit: 'week' },
    }
    const html = renderToStaticMarkup(<GanttBlockView block={block} />)
    // First Monday on/after 2026-01-01 is 2026-01-05.
    expect(html).toContain('data-gantt-tick="01-05"')
    expect(html).toContain('data-gantt-tick="01-12"')
  })
})
