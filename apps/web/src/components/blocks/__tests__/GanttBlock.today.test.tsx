import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { GanttBlockView } from '../GanttBlock'
import type { GanttBlock } from '@/types/document'

const block: GanttBlock = {
  type: 'gantt',
  id: '01TESTBLOCK00000000TODAY01',
  tasks: [
    { name: 'Design', start: '2026-01-01', end: '2026-01-10' },
    { name: 'Build', start: '2026-01-05', end: '2026-01-20' },
  ],
}

describe('<GanttBlockView /> today marker', () => {
  it('today 가 범위 안이면 빨간 점선 <line> 렌더', () => {
    const html = renderToStaticMarkup(
      <GanttBlockView block={block} today="2026-01-10" />,
    )
    expect(html).toContain('data-gantt-today')
    expect(html).toContain('stroke="#dc2626"')
    expect(html).toContain('stroke-dasharray="4 3"')
    expect(html).toContain('aria-label="오늘"')
  })

  it('today 가 범위 밖 (모든 task 가 과거) 이면 marker 미렌더', () => {
    const html = renderToStaticMarkup(
      <GanttBlockView block={block} today="2026-12-31" />,
    )
    expect(html).not.toContain('data-gantt-today')
    expect(html).not.toContain('stroke="#dc2626"')
  })

  it('today 가 범위 밖 (모든 task 가 미래) 이면 marker 미렌더', () => {
    const html = renderToStaticMarkup(
      <GanttBlockView block={block} today="2025-12-01" />,
    )
    expect(html).not.toContain('data-gantt-today')
  })

  it('today 가 정확히 minStart 일 때도 렌더 (경계 포함)', () => {
    const html = renderToStaticMarkup(
      <GanttBlockView block={block} today="2026-01-01" />,
    )
    expect(html).toContain('data-gantt-today')
    expect(html).toContain('stroke-dasharray="4 3"')
  })
})
