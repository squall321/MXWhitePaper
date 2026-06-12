import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { GanttBlockView } from '../GanttBlock'
import type { GanttBlock } from '@/types/document'

const block: GanttBlock = {
  type: 'gantt',
  id: '01TESTBLOCK0000000DRAG001',
  tasks: [
    { name: 'Spec', start: '2026-05-01', end: '2026-05-03', progress: 50 },
    { name: 'Build', start: '2026-05-04', end: '2026-05-08' },
  ],
}

describe('<GanttBlockView /> drag overlay (editor preview only)', () => {
  it('without onTaskPatch (일반 문서 뷰) renders no drag overlay — read-only 그대로', () => {
    const html = renderToStaticMarkup(<GanttBlockView block={block} />)
    expect(html).not.toContain('data-gantt-drag-overlay')
  })

  it('with onTaskPatch renders one transparent overlay rect per task', () => {
    const html = renderToStaticMarkup(
      <GanttBlockView block={block} onTaskPatch={() => {}} />,
    )
    expect(html).toContain('data-gantt-drag-overlay="0"')
    expect(html).toContain('data-gantt-drag-overlay="1"')
    expect(html).toContain('fill="transparent"')
  })
})
