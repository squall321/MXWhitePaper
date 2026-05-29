import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SpreadsheetBlockView } from '../SpreadsheetBlock'
import type { SpreadsheetBlock } from '@/types/document'

/**
 * Excel-style "Freeze panes" — top header row + first row-number column stay
 * pinned while the user scrolls. CSS-only via Tailwind `sticky` utilities on
 * the existing `overflow-x-auto` wrapper. Schema is unchanged: behavior is
 * always-on, mirroring Excel's default View → Freeze Top Row + First Column.
 *
 * Verifies the class contract at SSR; layout/scroll interaction is the
 * browser's responsibility (CSS `position: sticky`).
 */

const ID = '01TESTBLOCK00000000000FZ01'

function render(block: SpreadsheetBlock): string {
  return renderToStaticMarkup(<SpreadsheetBlockView block={block} />)
}

describe('<SpreadsheetBlockView /> freeze panes', () => {
  it('top-left corner cell is sticky on both axes with z-20', () => {
    const html = render({
      type: 'spreadsheet',
      id: ID,
      cols: 3,
      rows: 3,
      cells: {},
    })
    // The corner <th> must carry sticky + top-0 + left-0 + z-20 together.
    // Match against a single class attribute to ensure they co-exist on the
    // same element (not just somewhere in the document).
    expect(html).toMatch(
      /class="[^"]*\bsticky\b[^"]*\btop-0\b[^"]*\bleft-0\b[^"]*\bz-20\b[^"]*"/,
    )
  })

  it('column headers in the top row are sticky-top with z-10', () => {
    const html = render({
      type: 'spreadsheet',
      id: ID,
      cols: 3,
      rows: 3,
      headers: ['항목', '값1', '값2'],
      cells: {},
    })
    // At least one sticky top-0 z-10 element exists (the per-column header).
    // The corner uses z-20, so this must specifically be z-10 to differentiate.
    expect(html).toMatch(
      /class="[^"]*\bsticky\b[^"]*\btop-0\b[^"]*\bz-10\b[^"]*"/,
    )
  })

  it('row-number column cells are sticky-left with z-10', () => {
    const html = render({
      type: 'spreadsheet',
      id: ID,
      cols: 2,
      rows: 5,
      cells: {},
    })
    // tbody <th scope="row"> must be sticky left-0 z-10 with a solid bg so
    // scrolled data cells don't bleed through.
    expect(html).toMatch(
      /class="[^"]*\bsticky\b[^"]*\bleft-0\b[^"]*\bz-10\b[^"]*\bbg-gray-50\b[^"]*"/,
    )
  })

  it('data cells carry an opaque background so sticky headers can cover them when scrolling', () => {
    const html = render({
      type: 'spreadsheet',
      id: ID,
      cols: 2,
      rows: 2,
      cells: { A1: '7' },
    })
    // <td> needs bg-white (+ dark:bg-gray-900) — otherwise sticky elements
    // would show underlying scrolled rows through transparent cells.
    expect(html).toMatch(
      /<td[^>]*class="[^"]*\bbg-white\b[^"]*\bdark:bg-gray-900\b[^"]*"/,
    )
  })

  it('wrapper keeps overflow-x-auto + scroll-fade-x intact (sticky lives inside)', () => {
    const html = render({
      type: 'spreadsheet',
      id: ID,
      cols: 4,
      rows: 4,
      cells: {},
    })
    // Sticky must scroll relative to this wrapper; verify it still exists.
    expect(html).toContain('overflow-x-auto')
    expect(html).toContain('scroll-fade-x')
  })
})
