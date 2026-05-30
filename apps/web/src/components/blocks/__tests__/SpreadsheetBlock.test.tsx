import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SpreadsheetBlockView } from '../SpreadsheetBlock'
import type { SpreadsheetBlock } from '@/types/document'

const ID = '01TESTBLOCK00000000000SS01'

function render(block: SpreadsheetBlock): string {
  return renderToStaticMarkup(<SpreadsheetBlockView block={block} />)
}

describe('<SpreadsheetBlockView />', () => {
  it('renders header row A..F (cols=6) and 10 row labels', () => {
    const html = render({
      type: 'spreadsheet',
      id: ID,
      cols: 6,
      rows: 10,
      cells: {},
    })
    // Letters in default header.
    expect(html).toContain('>A<')
    expect(html).toContain('>F<')
    // Row labels 1..10.
    expect(html).toContain('>1<')
    expect(html).toContain('>10<')
  })

  it('uses custom headers when provided', () => {
    const html = render({
      type: 'spreadsheet',
      id: ID,
      cols: 3,
      rows: 2,
      headers: ['항목', '1월', '2월'],
      cells: {},
    })
    expect(html).toContain('항목')
    expect(html).toContain('1월')
    expect(html).toContain('2월')
  })

  it('renders the optional title', () => {
    const html = render({
      type: 'spreadsheet',
      id: ID,
      title: 'Q1 예산',
      cols: 2,
      rows: 2,
      cells: {},
    })
    expect(html).toContain('Q1 예산')
  })

  it('computes formulas — =SUM(A1:A3) shows 6', () => {
    const html = render({
      type: 'spreadsheet',
      id: ID,
      cols: 2,
      rows: 4,
      cells: { A1: '1', A2: '2', A3: '3', B4: '=SUM(A1:A3)' },
    })
    expect(html).toContain('>6<')
  })

  it('shows raw text for non-formula cells', () => {
    const html = render({
      type: 'spreadsheet',
      id: ID,
      cols: 2,
      rows: 2,
      cells: { A1: 'hello', B1: '42' },
    })
    expect(html).toContain('hello')
    expect(html).toContain('>42<')
  })

  it('surfaces #DIV/0! when a formula divides by zero', () => {
    const html = render({
      type: 'spreadsheet',
      id: ID,
      cols: 2,
      rows: 2,
      cells: { A1: '=1/0' },
    })
    expect(html).toContain('#DIV/0!')
  })

  it('surfaces #CYCLE! for a 2-cell cycle', () => {
    const html = render({
      type: 'spreadsheet',
      id: ID,
      cols: 2,
      rows: 2,
      cells: { A1: '=B1', B1: '=A1' },
    })
    expect(html).toContain('#CYCLE!')
  })

  it('clamps cols & rows into schema bounds', () => {
    const html = render({
      type: 'spreadsheet',
      id: ID,
      // Out-of-range values — must be clamped (not crash).
      cols: 100 as unknown as number,
      rows: 0 as unknown as number,
      cells: {},
    })
    // Cap is 26 cols → expect Z header.
    expect(html).toContain('>Z<')
    // At least one row should render.
    expect(html).toContain('>1<')
  })

  it('zebra-stripes odd data rows by default (stripe=true)', () => {
    const html = render({
      type: 'spreadsheet',
      id: ID,
      cols: 2,
      rows: 4,
      cells: {},
    })
    // The smsg-blue-050 token bg is applied to <tr> at odd indices (1, 3).
    const matches = html.match(/bg-\[var\(--smsg-blue-050\)\]/g) ?? []
    expect(matches.length).toBe(2)
  })

  it('options.stripe=false disables zebra entirely', () => {
    const html = render({
      type: 'spreadsheet',
      id: ID,
      cols: 2,
      rows: 4,
      cells: {},
      options: { stripe: false },
    })
    expect(html).not.toContain('bg-[var(--smsg-blue-050)]')
  })

  it('exposes data-cell-ref attributes for downstream tooling', () => {
    const html = render({
      type: 'spreadsheet',
      id: ID,
      cols: 2,
      rows: 2,
      cells: { A1: '5' },
    })
    expect(html).toContain('data-cell-ref="A1"')
    expect(html).toContain('data-cell-ref="B2"')
  })
})
