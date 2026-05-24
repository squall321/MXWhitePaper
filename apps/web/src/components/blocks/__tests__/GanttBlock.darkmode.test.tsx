import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { GanttBlockView } from '../GanttBlock'
import type { GanttBlock } from '@/types/document'

const block: GanttBlock = {
  type: 'gantt',
  id: '01TESTBLOCK00000000000DARK',
  tasks: [
    { name: 'Design', start: '2026-01-01', end: '2026-01-05', progress: 100 },
    { name: 'Build', start: '2026-01-03', end: '2026-01-08', progress: 50 },
  ],
}

describe('<GanttBlockView /> darkmode tokens', () => {
  it('emits every SVG colour as a CSS token instead of a raw hex', () => {
    const html = renderToStaticMarkup(<GanttBlockView block={block} />)
    // zebra row fill (gray-050)
    expect(html).toContain('fill="var(--smsg-gray-050)"')
    // axis line stroke (gray-200)
    expect(html).toContain('stroke="var(--smsg-gray-200)"')
    // task name text (gray-900)
    expect(html).toContain('fill="var(--smsg-gray-900)"')
    // task bar (blue-500)
    expect(html).toContain('fill="var(--smsg-blue-500)"')
    // progress overlay (blue-700) — only renders when progress > 0,
    // which the second task has
    expect(html).toContain('fill="var(--smsg-blue-700)"')

    // No legacy hex should remain.
    expect(html).not.toContain('#F9FAFB')
    expect(html).not.toContain('#E5E7EB')
    expect(html).not.toContain('#1A1A1A')
    expect(html).not.toContain('#2E5BFF')
    expect(html).not.toContain('#1428A0')
  })

  it('figure surface declares dark-mode variants', () => {
    const html = renderToStaticMarkup(<GanttBlockView block={block} />)
    expect(html).toContain('dark:bg-gray-900')
    expect(html).toContain('dark:border-gray-700')
  })
})
