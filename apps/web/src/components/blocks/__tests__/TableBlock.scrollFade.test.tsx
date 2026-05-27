import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TableBlockView } from '../TableBlock'
import { SpreadsheetBlockView } from '../SpreadsheetBlock'
import type { TableBlock, SpreadsheetBlock } from '@/types/document'

/**
 * M6 — horizontal-scroll affordance guard.
 *
 * TableBlock / SpreadsheetBlock both wrap their tables in `overflow-x-auto`.
 * On narrow viewports (375px) the scrollbar is invisible until the user
 * actually drags, so users can't tell more columns exist off-screen. The
 * fix is a CSS-only fade overlay (`.scroll-fade-x`) on the scroll wrapper
 * that auto-hides when the user scrolls to either edge.
 *
 * If this class is stripped in a future refactor, the affordance disappears
 * silently — these guards catch that regression.
 */

function harness(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  })
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>
  )
}

const ID = '01TESTBLOCK00000000000FF01'

describe('TableBlock — M6 horizontal-scroll fade affordance', () => {
  it('wraps the scroll container in `.scroll-fade-x`', () => {
    const block: TableBlock = {
      type: 'table',
      id: ID,
      headers: ['열 1', '열 2'],
      rows: [['A', '1']],
    }
    const html = renderToStaticMarkup(harness(<TableBlockView block={block} />))
    expect(html).toContain('scroll-fade-x')
    // Sanity: the fade lives on the overflow-x wrapper, not on the table.
    expect(html).toMatch(/class="[^"]*scroll-fade-x[^"]*overflow-x-auto/)
  })
})

describe('SpreadsheetBlock — M6 horizontal-scroll fade affordance', () => {
  it('wraps the scroll container in `.scroll-fade-x`', () => {
    const block: SpreadsheetBlock = {
      type: 'spreadsheet',
      id: ID,
      cols: 6,
      rows: 3,
      cells: {},
    }
    const html = renderToStaticMarkup(<SpreadsheetBlockView block={block} />)
    expect(html).toContain('scroll-fade-x')
    expect(html).toMatch(/class="[^"]*scroll-fade-x[^"]*overflow-x-auto/)
  })
})
