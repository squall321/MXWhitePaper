/**
 * ImageAnnotationBlockEditor — unit tests for the pure helpers.
 *
 * Per the same pattern as WhiteboardBlockEditor's tests, we don't simulate
 * pointer events; instead we exercise the pure functions:
 *   - clientToNorm        (coordinate normalisation)
 *   - pushUndo / popUndo  (undo/redo stack — capped at UNDO_DEPTH)
 *   - buildArrow / buildRect / buildCallout
 *   - pickElement         (eraser-style hit-test for select tool)
 *
 * Plus a static SSR render to confirm the toolbar surfaces the documented
 * tools, color palette, and undo/redo/clear/replace buttons.
 */
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  ImageAnnotationBlockEditor,
  IA_TOOLS,
  IA_COLORS,
  buildArrow,
  buildCallout,
  buildRect,
  buildTextbox,
  clientToNorm,
  isResizable,
  moveAnnotation,
  moveArrowEndpoint,
  nextAnnotationId,
  pickElement,
  popUndo,
  resizeAnnotation,
  pushUndo,
} from '../ImageAnnotationBlockEditor'
import { useEditorStore } from '@/features/editor/state'
import type { AnnotationElement, ImageAnnotationBlock } from '@/types/document'

function harness(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  })
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>
}

describe('IA_TOOLS / IA_COLORS', () => {
  it('exposes the documented toolset', () => {
    expect(IA_TOOLS).toEqual(['select', 'arrow', 'rect', 'callout', 'textbox'])
  })

  it('buildTextbox produces a normalized textbox element', () => {
    const el = buildTextbox([0.2, 0.3], [0.5, 0.6], '한 줄\n두 줄', '#7c3aed')
    expect(el.kind).toBe('textbox')
    expect(el.x).toBe(0.2)
    expect(el.y).toBe(0.3)
    expect(el.w).toBeCloseTo(0.3, 5)
    expect(el.h).toBeCloseTo(0.3, 5)
    expect(el.text).toBe('한 줄\n두 줄')
    expect(el.color).toBe('#7c3aed')
    expect(el.id).toMatch(/^ann-/)
  })

  it('buildTextbox enforces minimum size for tiny drags', () => {
    // 거의 0 길이 드래그 — 박스가 보이지 않을 정도로 작아지면 사용자가 못 씀.
    // 최소 w=0.05, h=0.04 보장.
    const el = buildTextbox([0.5, 0.5], [0.5, 0.5], '', '#000')
    expect(el.w).toBeGreaterThanOrEqual(0.05)
    expect(el.h).toBeGreaterThanOrEqual(0.04)
  })
  it('exposes 8 preset colors', () => {
    expect(IA_COLORS.length).toBe(8)
  })
})

describe('moveAnnotation', () => {
  it('translates rect by (dx, dy)', () => {
    const r = buildRect([0.1, 0.2], [0.3, 0.4], '#000')
    const moved = moveAnnotation(r, 0.05, -0.02)
    if (moved.kind !== 'rect') throw new Error('expected rect')
    expect(moved.x).toBeCloseTo(0.15, 5)
    expect(moved.y).toBeCloseTo(0.18, 5)
    // w/h 는 보존.
    expect(moved.w).toBeCloseTo(r.w, 5)
    expect(moved.h).toBeCloseTo(r.h, 5)
  })

  it('translates textbox by (dx, dy)', () => {
    const tb = buildTextbox([0.2, 0.3], [0.5, 0.6], '본문', '#000')
    const moved = moveAnnotation(tb, 0.1, 0.1)
    if (moved.kind !== 'textbox') throw new Error('expected textbox')
    expect(moved.x).toBeCloseTo(0.3, 5)
    expect(moved.y).toBeCloseTo(0.4, 5)
    expect(moved.text).toBe('본문')  // 본문 보존
  })

  it('translates arrow from + to together', () => {
    const a = buildArrow([0.1, 0.1], [0.5, 0.5], '#000')
    const moved = moveAnnotation(a, 0.2, 0.0)
    if (moved.kind !== 'arrow') throw new Error('expected arrow')
    expect(moved.from.x).toBeCloseTo(0.3, 5)
    expect(moved.from.y).toBeCloseTo(0.1, 5)
    expect(moved.to.x).toBeCloseTo(0.7, 5)
    expect(moved.to.y).toBeCloseTo(0.5, 5)
  })

  it('translates callout (and anchor when present)', () => {
    const c = buildCallout([0.3, 0.3], 'hi', '#000')
    // build 시 anchor 없음 — 그대로 이동.
    const moved = moveAnnotation(c, 0.1, 0.1)
    if (moved.kind !== 'callout') throw new Error('expected callout')
    expect(moved.x).toBeCloseTo(0.4, 5)
    expect(moved.y).toBeCloseTo(0.4, 5)
    expect(moved.anchor).toBeUndefined()

    // anchor 가 있는 경우 — 같이 이동.
    const c2 = { ...c, anchor: { x: 0.5, y: 0.5 } }
    const m2 = moveAnnotation(c2, 0.05, -0.05)
    if (m2.kind !== 'callout') throw new Error('expected callout')
    expect(m2.anchor?.x).toBeCloseTo(0.55, 5)
    expect(m2.anchor?.y).toBeCloseTo(0.45, 5)
  })
})

describe('isResizable', () => {
  it('rect / textbox 만 true', () => {
    expect(isResizable(buildRect([0, 0], [0.1, 0.1], '#000'))).toBe(true)
    expect(isResizable(buildTextbox([0, 0], [0.1, 0.1], '', '#000'))).toBe(true)
    expect(isResizable(buildArrow([0, 0], [0.1, 0.1], '#000'))).toBe(false)
    expect(isResizable(buildCallout([0.3, 0.3], 'x', '#000'))).toBe(false)
  })
})

describe('moveArrowEndpoint', () => {
  it('updates only `from` when which="from"', () => {
    const a = buildArrow([0.1, 0.1], [0.5, 0.5], '#000')
    const out = moveArrowEndpoint(a, 'from', 0.2, 0.3)
    if (out.kind !== 'arrow') throw new Error('expected arrow')
    expect(out.from).toEqual({ x: 0.2, y: 0.3 })
    expect(out.to).toEqual({ x: 0.5, y: 0.5 })  // 다른 끝점 고정
  })

  it('updates only `to` when which="to"', () => {
    const a = buildArrow([0.1, 0.1], [0.5, 0.5], '#000')
    const out = moveArrowEndpoint(a, 'to', 0.9, 0.9)
    if (out.kind !== 'arrow') throw new Error('expected arrow')
    expect(out.from).toEqual({ x: 0.1, y: 0.1 })  // 다른 끝점 고정
    expect(out.to).toEqual({ x: 0.9, y: 0.9 })
  })
})

describe('resizeAnnotation', () => {
  it('rect — 우하단을 (cx, cy) 로 끌면 w/h 갱신', () => {
    const r = buildRect([0.1, 0.1], [0.3, 0.3], '#000')
    if (!isResizable(r)) throw new Error('expected resizable')
    const out = resizeAnnotation(r, 0.5, 0.4)
    if (out.kind !== 'rect') throw new Error('expected rect')
    expect(out.x).toBeCloseTo(0.1, 5)  // 좌상단 고정
    expect(out.y).toBeCloseTo(0.1, 5)
    expect(out.w).toBeCloseTo(0.4, 5)
    expect(out.h).toBeCloseTo(0.3, 5)
  })

  it('최소 크기 0.02 보장 — 좌상단 안쪽 좌표여도 음수 안 됨', () => {
    const r = buildRect([0.3, 0.3], [0.5, 0.5], '#000')
    if (!isResizable(r)) throw new Error('expected resizable')
    // cx/cy 가 x/y 보다 작은 (= 안쪽) 케이스 — clamp 으로 0.02 유지.
    const out = resizeAnnotation(r, 0.1, 0.1)
    if (out.kind !== 'rect') throw new Error('expected rect')
    expect(out.w).toBeCloseTo(0.02, 5)
    expect(out.h).toBeCloseTo(0.02, 5)
  })
})

describe('nextAnnotationId', () => {
  it('mints unique ids prefixed with `ann-`', () => {
    const a = nextAnnotationId()
    const b = nextAnnotationId()
    expect(a).toMatch(/^ann-/)
    expect(b).toMatch(/^ann-/)
    expect(a).not.toBe(b)
  })
})

describe('clientToNorm', () => {
  const rect = { left: 100, top: 200, width: 400, height: 300 }
  it('normalises client coords to [0..1]', () => {
    expect(clientToNorm(100, 200, rect)).toEqual([0, 0])
    expect(clientToNorm(500, 500, rect)).toEqual([1, 1])
    expect(clientToNorm(300, 350, rect)).toEqual([0.5, 0.5])
  })
  it('clamps values past the rect to [0,1]', () => {
    expect(clientToNorm(0, 0, rect)).toEqual([0, 0])
    expect(clientToNorm(9999, 9999, rect)).toEqual([1, 1])
  })
  it('handles zero-sized rects without dividing by zero', () => {
    expect(clientToNorm(50, 50, { left: 0, top: 0, width: 0, height: 0 })).toEqual([0, 0])
  })
})

describe('pushUndo / popUndo', () => {
  it('pushUndo appends a snapshot', () => {
    const next = pushUndo<number[]>([], [1, 2])
    expect(next).toEqual([[1, 2]])
  })
  it('pushUndo caps the stack at the given depth (drops oldest)', () => {
    const stack: number[][] = [[1], [2], [3]]
    const next = pushUndo(stack, [4], 3)
    expect(next).toEqual([[2], [3], [4]])
  })
  it('popUndo returns the head + the trimmed stack', () => {
    const stack: string[][] = [['a'], ['b'], ['c']]
    const r = popUndo(stack)
    expect(r.value).toEqual(['c'])
    expect(r.next).toEqual([['a'], ['b']])
  })
  it('popUndo on an empty stack returns no value', () => {
    const r = popUndo<number[]>([])
    expect(r.value).toBeUndefined()
    expect(r.next).toEqual([])
  })
  it('pushUndo / popUndo are pure (do not mutate the input stack)', () => {
    const stack: number[][] = [[1], [2]]
    pushUndo(stack, [3])
    popUndo(stack)
    expect(stack).toEqual([[1], [2]])
  })
})

describe('buildArrow / buildRect / buildCallout', () => {
  it('buildArrow stores from/to + color', () => {
    const a = buildArrow([0.1, 0.2], [0.3, 0.4], '#dc2626')
    expect(a.kind).toBe('arrow')
    expect(a.from).toEqual({ x: 0.1, y: 0.2 })
    expect(a.to).toEqual({ x: 0.3, y: 0.4 })
    expect(a.color).toBe('#dc2626')
    expect(a.id).toMatch(/^ann-/)
  })

  it('buildRect normalises start/end into top-left + width/height', () => {
    const r = buildRect([0.5, 0.5], [0.2, 0.3], '#2563eb')
    expect(r.x).toBeCloseTo(0.2)
    expect(r.y).toBeCloseTo(0.3)
    expect(r.w).toBeCloseTo(0.3)
    expect(r.h).toBeCloseTo(0.2)
  })

  it('buildRect handles zero-size drag (single click)', () => {
    const r = buildRect([0.5, 0.5], [0.5, 0.5], '#000')
    expect(r.w).toBe(0)
    expect(r.h).toBe(0)
  })

  it('buildCallout stores position + label + color', () => {
    const c = buildCallout([0.6, 0.7], '여기 확인', '#16a34a')
    expect(c.kind).toBe('callout')
    expect(c.x).toBe(0.6)
    expect(c.y).toBe(0.7)
    expect(c.label).toBe('여기 확인')
    expect(c.color).toBe('#16a34a')
  })
})

describe('pickElement (select-tool hit-test)', () => {
  const arrow: AnnotationElement = {
    kind: 'arrow',
    id: 'ar1',
    from: { x: 0.1, y: 0.1 },
    to: { x: 0.5, y: 0.1 },
    color: '#000',
  }
  const rect: AnnotationElement = {
    kind: 'rect',
    id: 're1',
    x: 0.6,
    y: 0.6,
    w: 0.2,
    h: 0.1,
    color: '#000',
  }
  const callout: AnnotationElement = {
    kind: 'callout',
    id: 'cl1',
    x: 0.2,
    y: 0.7,
    label: 'hi',
    color: '#000',
  }
  const elements = [arrow, rect, callout]

  it('hits the arrow on its segment', () => {
    expect(pickElement(elements, 0.3, 0.1)?.id).toBe('ar1')
  })
  it('hits the rect inside its bbox', () => {
    expect(pickElement(elements, 0.7, 0.65)?.id).toBe('re1')
  })
  it('hits the callout near its anchor', () => {
    expect(pickElement(elements, 0.21, 0.71)?.id).toBe('cl1')
  })
  it('returns null when nothing is under the cursor', () => {
    expect(pickElement(elements, 0.99, 0.01)).toBeNull()
  })
  it('prefers the topmost (last) element when multiple overlap', () => {
    const stacked: AnnotationElement[] = [
      { kind: 'rect', id: 'bottom', x: 0, y: 0, w: 1, h: 1, color: '#000' },
      { kind: 'rect', id: 'top', x: 0, y: 0, w: 1, h: 1, color: '#fff' },
    ]
    expect(pickElement(stacked, 0.5, 0.5)?.id).toBe('top')
  })
})

const sampleBlock: ImageAnnotationBlock = {
  type: 'image-annotation',
  id: '01TESTBLOCK000000000000IA2',
  imageId: '01TESTIMAGE000000000000IA2',
  annotations: [],
}

describe('<ImageAnnotationBlockEditor /> static render', () => {
  it('exposes every tool, color, and command', () => {
    useEditorStore.getState().reset()
    useEditorStore.setState({ slug: 'test', etag: 'etag-1' })
    const html = renderToStaticMarkup(
      harness(<ImageAnnotationBlockEditor slug="test" block={sampleBlock} />),
    )
    // tool buttons (Korean labels)
    for (const label of ['선택', '화살표', '사각형', '콜아웃']) {
      expect(html, `missing tool: ${label}`).toContain(label)
    }
    // commands
    for (const label of ['되돌리기', '다시실행', '지우기', '이미지 교체']) {
      expect(html, `missing command: ${label}`).toContain(label)
    }
    // canvas
    expect(html).toContain('data-image-annotation-canvas')
    expect(html).toContain('data-tool="arrow"')
    // color radio group
    expect(html).toContain('aria-label="색상"')
    // viewbox stays normalised
    expect(html).toContain('viewBox="0 0 1 1"')
  })
})
