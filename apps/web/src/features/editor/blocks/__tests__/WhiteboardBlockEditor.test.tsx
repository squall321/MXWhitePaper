/**
 * WhiteboardBlockEditor — unit tests for the pure helpers.
 *
 * Per the design doc we don't simulate pointer events; instead we exercise
 * the pure functions that decide what each pointer step *would* do:
 *   - buildPenStart / appendStrokePoint   (pen mode)
 *   - buildShapeStart / resizeShape       (shape mode)
 *   - buildTextElement                    (text commit)
 *   - distancePointToSegment / strokeIntersects / shapeIntersects /
 *     textIntersects / elementIntersects / applyEraser  (eraser)
 *
 * Plus a static SSR render to confirm the toolbar surfaces the documented
 * tools, color palette, width picker, and undo/redo/clear buttons.
 */
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  WhiteboardBlockEditor,
  WB_TOOLS,
  WB_COLORS,
  WB_WIDTHS,
  appendStrokePoint,
  applyEraser,
  buildPenStart,
  buildShapeStart,
  buildTextElement,
  distancePointToSegment,
  elementIntersects,
  resizeShape,
  shapeIntersects,
  strokeIntersects,
  textIntersects,
} from '../WhiteboardBlockEditor'
import { useEditorStore } from '@/features/editor/state'
import type { WhiteboardBlock, WhiteboardElement } from '@/types/document'

describe('WB_TOOLS / WB_COLORS / WB_WIDTHS', () => {
  it('exposes the documented toolset', () => {
    expect(WB_TOOLS).toEqual([
      'pen',
      'eraser',
      'rect',
      'ellipse',
      'line',
      'arrow',
      'text',
    ])
  })
  it('exposes 6 preset colors + 4 widths', () => {
    expect(WB_COLORS.length).toBe(6)
    expect(WB_WIDTHS).toEqual([1, 2, 4, 8])
  })
})

describe('buildPenStart', () => {
  it('creates a stroke element with the given color/width and one initial point', () => {
    const el = buildPenStart([12, 34], '#dc2626', 4)
    expect(el.kind).toBe('stroke')
    expect(el.points).toEqual([[12, 34]])
    expect(el.stroke).toBe('#dc2626')
    expect(el.strokeWidth).toBe(4)
    expect(el.id).toMatch(/^wbe-/)
  })
})

describe('appendStrokePoint', () => {
  it('returns the same array (reference) when the next point is too close', () => {
    const points: [number, number][] = [[0, 0]]
    const next = appendStrokePoint(points, [1, 0], 2)
    expect(next).toBe(points) // throttle: identity-equal
  })
  it('appends when the distance crosses the threshold', () => {
    const points: [number, number][] = [[0, 0]]
    const next = appendStrokePoint(points, [10, 0], 2)
    expect(next).toEqual([
      [0, 0],
      [10, 0],
    ])
  })
  it('seeds the array if it starts empty', () => {
    const next = appendStrokePoint([], [3, 4])
    expect(next).toEqual([[3, 4]])
  })
})

describe('buildShapeStart / resizeShape', () => {
  it('starts with zero-size at the anchor', () => {
    const sh = buildShapeStart('rect', [50, 60], '#000', 2)
    expect(sh).toMatchObject({ kind: 'shape', shape: 'rect', x: 50, y: 60, w: 0, h: 0 })
  })
  it('resizeShape updates w/h relative to the anchor', () => {
    const sh = buildShapeStart('ellipse', [10, 10], '#000', 2)
    const next = resizeShape(sh, [40, 30])
    expect(next.w).toBe(30)
    expect(next.h).toBe(20)
    // does not mutate the original
    expect(sh.w).toBe(0)
  })
})

describe('buildTextElement', () => {
  it('packs the position, text, fontSize and color into a text element', () => {
    const t = buildTextElement([100, 200], 'hi', 18, '#16a34a')
    expect(t).toMatchObject({
      kind: 'text',
      x: 100,
      y: 200,
      text: 'hi',
      fontSize: 18,
      color: '#16a34a',
    })
    expect(t.id).toMatch(/^wbe-/)
  })
})

describe('distancePointToSegment', () => {
  it('returns 0 when the point is on the segment', () => {
    expect(distancePointToSegment(5, 0, 0, 0, 10, 0)).toBe(0)
  })
  it('returns the perpendicular distance when point is off the segment', () => {
    expect(distancePointToSegment(5, 4, 0, 0, 10, 0)).toBe(4)
  })
  it('clamps to endpoints when the projection falls outside [0,1]', () => {
    // point well past the (10,0) endpoint
    expect(distancePointToSegment(20, 0, 0, 0, 10, 0)).toBe(10)
  })
  it('handles degenerate (zero-length) segments', () => {
    expect(distancePointToSegment(3, 4, 0, 0, 0, 0)).toBe(5)
  })
})

describe('strokeIntersects', () => {
  const points: [number, number][] = [
    [0, 0],
    [50, 0],
    [50, 50],
  ]
  it('hits when the cursor is within radius of any segment', () => {
    expect(strokeIntersects(points, 25, 5, 8)).toBe(true) // near horizontal seg
    expect(strokeIntersects(points, 53, 25, 8)).toBe(true) // near vertical seg
  })
  it('misses when the cursor is far from every segment', () => {
    expect(strokeIntersects(points, 200, 200, 8)).toBe(false)
  })
  it('treats single-point strokes like a circle hit-test', () => {
    expect(strokeIntersects([[10, 10]], 12, 12, 8)).toBe(true)
    expect(strokeIntersects([[10, 10]], 100, 100, 8)).toBe(false)
  })
})

describe('shapeIntersects', () => {
  const rect = {
    kind: 'shape' as const,
    id: 's',
    shape: 'rect' as const,
    x: 0,
    y: 0,
    w: 100,
    h: 50,
    stroke: '#000',
    strokeWidth: 2,
  }
  it('hits the rect bbox', () => {
    expect(shapeIntersects(rect, 50, 25, 8)).toBe(true)
  })
  it('hits within the radius margin', () => {
    expect(shapeIntersects(rect, -5, 25, 8)).toBe(true)
    expect(shapeIntersects(rect, -20, 25, 8)).toBe(false)
  })
  it('uses segment hit-test for line/arrow', () => {
    const line = { ...rect, shape: 'line' as const, x: 0, y: 0, w: 100, h: 0 }
    expect(shapeIntersects(line, 50, 4, 8)).toBe(true)
    expect(shapeIntersects(line, 50, 100, 8)).toBe(false)
  })
})

describe('textIntersects', () => {
  const txt = {
    kind: 'text' as const,
    id: 't',
    x: 100,
    y: 100,
    text: 'hello',
    fontSize: 16,
    color: '#000',
  }
  it('hits inside the approximated bbox', () => {
    expect(textIntersects(txt, 110, 105, 8)).toBe(true)
  })
  it('misses far away', () => {
    expect(textIntersects(txt, 500, 500, 8)).toBe(false)
  })
})

describe('elementIntersects + applyEraser', () => {
  const elements: WhiteboardElement[] = [
    {
      kind: 'stroke',
      id: 's1',
      points: [
        [0, 0],
        [100, 0],
      ],
      stroke: '#000',
      strokeWidth: 2,
    },
    {
      kind: 'shape',
      id: 'r1',
      shape: 'rect',
      x: 200,
      y: 200,
      w: 50,
      h: 50,
      stroke: '#000',
      strokeWidth: 2,
    },
    {
      kind: 'text',
      id: 't1',
      x: 400,
      y: 400,
      text: 'hi',
      fontSize: 16,
      color: '#000',
    },
  ]

  it('elementIntersects routes by kind', () => {
    expect(elementIntersects(elements[0]!, 50, 0, 8)).toBe(true)
    expect(elementIntersects(elements[1]!, 220, 220, 8)).toBe(true)
    expect(elementIntersects(elements[2]!, 405, 405, 8)).toBe(true)
  })

  it('applyEraser removes only intersected elements (pure)', () => {
    const next = applyEraser(elements, 50, 0, 8)
    expect(next.length).toBe(2)
    expect(next.find((e) => e.id === 's1')).toBeUndefined()
    // input was not mutated
    expect(elements.length).toBe(3)
  })

  it('applyEraser is a no-op when nothing intersects', () => {
    const next = applyEraser(elements, 9999, 9999, 8)
    expect(next.length).toBe(elements.length)
  })
})

const sampleBlock: WhiteboardBlock = {
  type: 'whiteboard',
  id: '01TESTBLOCK000000000000WB1',
  viewbox: { w: 800, h: 480 },
  elements: [],
}

describe('<WhiteboardBlockEditor /> static render', () => {
  it('exposes every tool, color, width, and undo/redo/clear', () => {
    useEditorStore.getState().reset()
    useEditorStore.setState({ slug: 'test', etag: 'etag-1' })
    const html = renderToStaticMarkup(
      <WhiteboardBlockEditor slug="test" block={sampleBlock} />,
    )
    // tool buttons (Korean labels)
    for (const label of ['펜', '지우개', '사각형', '원', '선', '화살표', '텍스트']) {
      expect(html, `missing tool: ${label}`).toContain(label)
    }
    // commands
    for (const label of ['되돌리기', '다시실행', '지우기']) {
      expect(html, `missing command: ${label}`).toContain(label)
    }
    // canvas + tool data attribute
    expect(html).toContain('data-whiteboard-canvas')
    expect(html).toContain('data-wb-tool="pen"')
    // viewbox honors block.viewbox
    expect(html).toContain('viewBox="0 0 800 480"')
    // color radio group
    expect(html).toContain('aria-label="색상"')
    // width radio group
    expect(html).toContain('aria-label="굵기"')
  })
})
