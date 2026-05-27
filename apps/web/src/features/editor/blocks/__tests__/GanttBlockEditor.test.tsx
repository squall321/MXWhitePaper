import { describe, it, expect, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { GanttBlockEditor, ganttKeyToPatch, shiftDate } from '../GanttBlockEditor'
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

  it('surfaces the ZebraToggle for the gantt blockType', () => {
    const html = renderToStaticMarkup(
      <GanttBlockEditor slug="test" block={filled} />,
    )
    expect(html).toContain('data-zebra-toggle="gantt"')
    // checked by default (options undefined)
    const idx = html.indexOf('data-zebra-toggle="gantt"')
    const snippet = html.slice(idx, idx + 300)
    expect(snippet).toContain('checked=""')
  })

  it('makes each task row keyboard-focusable with an aria-label and focus ring', () => {
    const html = renderToStaticMarkup(
      <GanttBlockEditor slug="test" block={filled} />,
    )
    // First row: tabIndex + role + aria-label mentioning task name and dates.
    expect(html).toContain('data-gantt-bar-row="0"')
    expect(html).toContain('tabindex="0"')
    expect(html).toContain('role="button"')
    expect(html).toContain('Spec')
    expect(html).toContain('2026-05-01')
    expect(html).toContain('2026-05-03')
    // Focus indicator (design-system token, matches other interactive elements).
    expect(html).toContain('focus:ring-2')
    expect(html).toContain('focus:ring-smsg-300')
  })
})

describe('ganttKeyToPatch', () => {
  const base = { start: '2026-05-01', end: '2026-05-05' }

  it('ArrowRight shifts end +1 day', () => {
    expect(ganttKeyToPatch(base, { key: 'ArrowRight', shiftKey: false })).toEqual({
      end: '2026-05-06',
    })
  })

  it('ArrowLeft shifts end -1 day', () => {
    expect(ganttKeyToPatch(base, { key: 'ArrowLeft', shiftKey: false })).toEqual({
      end: '2026-05-04',
    })
  })

  it('Shift+ArrowRight shifts start AND end +1 day (whole bar)', () => {
    expect(ganttKeyToPatch(base, { key: 'ArrowRight', shiftKey: true })).toEqual({
      start: '2026-05-02',
      end: '2026-05-06',
    })
  })

  it('Shift+ArrowLeft shifts start AND end -1 day (whole bar)', () => {
    expect(ganttKeyToPatch(base, { key: 'ArrowLeft', shiftKey: true })).toEqual({
      start: '2026-04-30',
      end: '2026-05-04',
    })
  })

  it('ignores keys other than ArrowLeft/ArrowRight (Enter, Tab, ArrowUp)', () => {
    expect(ganttKeyToPatch(base, { key: 'Enter', shiftKey: false })).toBeNull()
    expect(ganttKeyToPatch(base, { key: 'Tab', shiftKey: false })).toBeNull()
    expect(ganttKeyToPatch(base, { key: 'ArrowUp', shiftKey: false })).toBeNull()
    expect(ganttKeyToPatch(base, { key: 'ArrowDown', shiftKey: true })).toBeNull()
  })
})
