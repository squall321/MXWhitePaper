import { describe, it, expect, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { GanttBlockEditor, shiftDate } from '../GanttBlockEditor'
import { useEditorStore } from '@/features/editor/state'
import type { GanttBlock } from '@/types/document'

const empty: GanttBlock = {
  type: 'gantt',
  id: '01TESTBLOCK00000000000GAN1',
  tasks: [],
}

const filled: GanttBlock = {
  type: 'gantt',
  id: '01TESTBLOCK00000000000GAN2',
  tasks: [
    { name: 'Spec', start: '2026-05-01', end: '2026-05-03', progress: 50 },
    { name: 'Build', start: '2026-05-04', end: '2026-05-08', progress: 0 },
  ],
}

describe('shiftDate', () => {
  it('adds N days to a YYYY-MM-DD date', () => {
    expect(shiftDate('2026-05-01', 3)).toBe('2026-05-04')
    expect(shiftDate('2026-05-30', 5)).toBe('2026-06-04')
  })
  it('returns the original on invalid input', () => {
    expect(shiftDate('not-a-date', 1)).toBe('not-a-date')
  })
})

describe('<GanttBlockEditor />', () => {
  beforeEach(() => {
    useEditorStore.getState().reset()
    useEditorStore.setState({ slug: 'test', etag: 'etag-1' })
  })

  it('shows the empty-state hint when no tasks', () => {
    const html = renderToStaticMarkup(
      <GanttBlockEditor slug="test" block={empty} />,
    )
    expect(html).toContain('+ 작업 추가')
    expect(html).toContain('작업이 없습니다')
  })

  it('renders one row per task with editable name/start/end/progress', () => {
    const html = renderToStaticMarkup(
      <GanttBlockEditor slug="test" block={filled} />,
    )
    expect(html).toContain('aria-label="task 0 name"')
    expect(html).toContain('aria-label="task 0 start"')
    expect(html).toContain('aria-label="task 0 end"')
    expect(html).toContain('aria-label="task 0 progress"')
    expect(html).toContain('aria-label="task 1 name"')
    expect(html).toContain('aria-label="remove task 0"')
  })
})
