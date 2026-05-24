import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { GanttBlockView } from '../GanttBlock'
import type { GanttBlock } from '@/types/document'

const mkBlock = (n: number, options?: GanttBlock['options']): GanttBlock => ({
  type: 'gantt',
  id: '01TESTBLOCK00000000000GANT',
  tasks: Array.from({ length: n }, (_, i) => ({
    name: `Task ${String.fromCharCode(65 + i)}`,
    start: `2026-01-0${(i % 9) + 1}`,
    end: `2026-01-0${((i + 4) % 9) + 1}`,
  })),
  ...(options ? { options } : {}),
})

describe('<GanttBlockView /> zebra-striping', () => {
  it('default ON — odd rows get a <rect data-gantt-zebra-row>', () => {
    const html = renderToStaticMarkup(<GanttBlockView block={mkBlock(4)} />)
    const matches = html.match(/data-gantt-zebra-row/g) ?? []
    // tasks: idx 0,1,2,3 → zebra on idx 1 and 3 → 2 rects
    expect(matches.length).toBe(2)
    expect(html).toContain('fill="#F9FAFB"')
  })

  it('odd-count tasks → floor(n/2) zebra rects', () => {
    const html = renderToStaticMarkup(<GanttBlockView block={mkBlock(5)} />)
    const matches = html.match(/data-gantt-zebra-row/g) ?? []
    expect(matches.length).toBe(2) // idx 1 and 3 (4 stays clean)
  })

  it('options.stripe=false suppresses every zebra rect', () => {
    const html = renderToStaticMarkup(
      <GanttBlockView block={mkBlock(4, { stripe: false })} />,
    )
    expect(html).not.toContain('data-gantt-zebra-row')
    expect(html).not.toContain('fill="#F9FAFB"')
  })
})
