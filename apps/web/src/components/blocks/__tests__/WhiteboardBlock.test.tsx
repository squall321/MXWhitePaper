/**
 * WhiteboardBlock — read-mode rendering test.
 *
 * Builds a sample block exercising every element kind (stroke, every shape,
 * text) and asserts the SVG output contains the expected children. We use
 * renderToStaticMarkup (no jsdom) — same harness as the rest of this repo.
 */
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { WhiteboardBlockView, strokeToPathD } from '../WhiteboardBlock'
import type { WhiteboardBlock } from '@/types/document'

const block: WhiteboardBlock = {
  type: 'whiteboard',
  id: '01TESTBLOCK000000000000WB1',
  title: '아이디어 보드',
  viewbox: { w: 800, h: 600 },
  elements: [
    {
      kind: 'stroke',
      id: 'wbe-stroke-1',
      points: [
        [10, 10],
        [20, 30],
        [40, 50],
      ],
      stroke: '#111827',
      strokeWidth: 2,
    },
    {
      kind: 'shape',
      id: 'wbe-rect-1',
      shape: 'rect',
      x: 100,
      y: 100,
      w: 80,
      h: 60,
      stroke: '#dc2626',
      strokeWidth: 4,
    },
    {
      kind: 'shape',
      id: 'wbe-ellipse-1',
      shape: 'ellipse',
      x: 200,
      y: 200,
      w: 60,
      h: 30,
      stroke: '#2563eb',
      strokeWidth: 2,
    },
    {
      kind: 'shape',
      id: 'wbe-line-1',
      shape: 'line',
      x: 300,
      y: 300,
      w: 50,
      h: 20,
      stroke: '#16a34a',
      strokeWidth: 2,
    },
    {
      kind: 'shape',
      id: 'wbe-arrow-1',
      shape: 'arrow',
      x: 400,
      y: 400,
      w: 80,
      h: 0,
      stroke: '#ca8a04',
      strokeWidth: 3,
    },
    {
      kind: 'text',
      id: 'wbe-text-1',
      x: 500,
      y: 500,
      text: '안녕',
      fontSize: 18,
      color: '#111827',
    },
  ],
}

describe('strokeToPathD', () => {
  it('builds a Move + Line sequence from points', () => {
    expect(strokeToPathD([[0, 0]])).toBe('M 0 0')
    expect(
      strokeToPathD([
        [0, 0],
        [10, 5],
        [15, 8],
      ]),
    ).toBe('M 0 0 L 10 5 L 15 8')
  })
  it('returns empty string when points are empty', () => {
    expect(strokeToPathD([])).toBe('')
  })
})

describe('<WhiteboardBlockView /> read-mode render', () => {
  it('renders the title caption', () => {
    const html = renderToStaticMarkup(<WhiteboardBlockView block={block} />)
    expect(html).toContain('아이디어 보드')
  })

  it('emits an SVG with viewBox matching block.viewbox', () => {
    const html = renderToStaticMarkup(<WhiteboardBlockView block={block} />)
    expect(html).toContain('viewBox="0 0 800 600"')
  })

  it('renders each element as the expected SVG primitive', () => {
    const html = renderToStaticMarkup(<WhiteboardBlockView block={block} />)
    expect(html).toContain('<path')
    expect(html).toContain('data-el-id="wbe-stroke-1"')
    expect(html).toContain('<rect')
    expect(html).toContain('data-el-id="wbe-rect-1"')
    expect(html).toContain('<ellipse')
    expect(html).toContain('data-el-id="wbe-ellipse-1"')
    // line + arrow both use <line>; arrow gets the marker-end ref.
    expect(html).toContain('data-el-id="wbe-line-1"')
    expect(html).toContain('data-el-id="wbe-arrow-1"')
    expect(html).toContain('marker-end="url(#wb-arrow)"')
    expect(html).toContain('<text')
    expect(html).toContain('data-el-id="wbe-text-1"')
    expect(html).toContain('안녕')
  })

  it('emits the arrow-marker <defs> exactly once', () => {
    const html = renderToStaticMarkup(<WhiteboardBlockView block={block} />)
    const occurrences = html.match(/id="wb-arrow"/g) ?? []
    expect(occurrences.length).toBe(1)
  })

  it('walks elements in array order (preserves z-order)', () => {
    const html = renderToStaticMarkup(<WhiteboardBlockView block={block} />)
    const idxStroke = html.indexOf('wbe-stroke-1')
    const idxText = html.indexOf('wbe-text-1')
    expect(idxStroke).toBeGreaterThan(0)
    expect(idxText).toBeGreaterThan(idxStroke)
  })

  it('renders even when elements is empty (only the marker defs)', () => {
    const empty: WhiteboardBlock = { ...block, title: undefined, elements: [] }
    const html = renderToStaticMarkup(<WhiteboardBlockView block={empty} />)
    expect(html).toContain('<svg')
    // No element nodes should appear — every <path>/<rect>/<text> we emit
    // tags itself with `data-el-id`, so its absence proves the canvas is
    // genuinely empty (the arrow-marker `<path>` inside `<defs>` doesn't).
    expect(html).not.toContain('data-el-id')
  })
})
