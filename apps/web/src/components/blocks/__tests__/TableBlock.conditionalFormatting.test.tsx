import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TableBlockView } from '../TableBlock'
import type { TableBlock } from '@/types/document'

vi.mock('@/features/glossary/useGlossary', () => ({
  useGlossary: () => ({
    terms: [],
    lookup: () => undefined,
    findEntry: () => undefined,
  }),
}))

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

const ID = '01TESTBLOCK00000000000F02'

describe('TableBlock — conditional formatting (flat mode)', () => {
  it('applies background to cells matching a gt rule', () => {
    const block: TableBlock = {
      type: 'table',
      id: ID,
      headers: ['이름', '점수'],
      rows: [
        ['A', '90'],
        ['B', '50'],
        ['C', '70'],
      ],
      options: {
        conditionalFormatting: [
          { column: 1, operator: 'gt', value: 60, style: { bg: '#ffe' } },
        ],
      },
    }
    const html = renderToStaticMarkup(harness(<TableBlockView block={block} />))
    // 90 and 70 should be highlighted; 50 should not.
    const yellowCount = (html.match(/background-color:#ffe/g) ?? []).length
    expect(yellowCount).toBe(2)
  })

  it('top_n highlights the top 2 values by column', () => {
    const block: TableBlock = {
      type: 'table',
      id: ID,
      headers: ['도시', '매출'],
      rows: [
        ['서울', '100'],
        ['부산', '50'],
        ['대구', '80'],
        ['광주', '20'],
      ],
      options: {
        conditionalFormatting: [
          {
            column: '매출',
            operator: 'top_n',
            value: 2,
            style: { bg: '#cfc', bold: true },
          },
        ],
      },
    }
    const html = renderToStaticMarkup(harness(<TableBlockView block={block} />))
    expect((html.match(/background-color:#cfc/g) ?? []).length).toBe(2)
    expect((html.match(/font-weight:600/g) ?? []).length).toBe(2)
  })

  it('contains operator matches case-insensitive substring', () => {
    const block: TableBlock = {
      type: 'table',
      id: ID,
      headers: ['상태'],
      rows: [['Pass'], ['Failed'], ['PASS'], ['Open']],
      options: {
        conditionalFormatting: [
          { operator: 'contains', value: 'pass', style: { fg: '#0a0' } },
        ],
      },
    }
    const html = renderToStaticMarkup(harness(<TableBlockView block={block} />))
    expect((html.match(/color:#0a0/g) ?? []).length).toBe(2)
  })

  it('no rules → no inline style on data cells', () => {
    const block: TableBlock = {
      type: 'table',
      id: ID,
      headers: ['값'],
      rows: [['1'], ['2']],
    }
    const html = renderToStaticMarkup(harness(<TableBlockView block={block} />))
    expect(html).not.toContain('background-color:')
  })
})

describe('TableBlock — conditional formatting (sparse mode)', () => {
  it('cell.bg override wins over conditional rule', () => {
    const block: TableBlock = {
      type: 'table',
      id: ID,
      headers: ['열1'],
      rows: [],
      cells: [
        { r: 0, c: 0, text: '점수', header: true },
        // cell.bg explicitly set — must override the conditional rule.
        { r: 1, c: 0, text: '99', bg: '#abc' },
        // no explicit bg — conditional rule applies.
        { r: 2, c: 0, text: '88' },
      ],
      options: {
        conditionalFormatting: [
          { operator: 'gt', value: 50, style: { bg: '#fee' } },
        ],
      },
    }
    const html = renderToStaticMarkup(harness(<TableBlockView block={block} />))
    // The user-set #abc must appear; #fee must appear for the un-overridden cell.
    expect(html).toContain('background-color:#abc')
    expect(html).toContain('background-color:#fee')
    // Cell with explicit bg should NOT also carry the conditional bg.
    const abcOccurrences = (html.match(/background-color:#abc/g) ?? []).length
    expect(abcOccurrences).toBe(1)
  })

  it('header cells skip conditional formatting', () => {
    const block: TableBlock = {
      type: 'table',
      id: ID,
      headers: ['값'],
      rows: [],
      cells: [
        { r: 0, c: 0, text: '100', header: true },
        { r: 1, c: 0, text: '100' },
      ],
      options: {
        conditionalFormatting: [
          { operator: 'gte', value: 100, style: { bg: '#fde' } },
        ],
      },
    }
    const html = renderToStaticMarkup(harness(<TableBlockView block={block} />))
    // Only one match — the body cell, not the header cell.
    expect((html.match(/background-color:#fde/g) ?? []).length).toBe(1)
  })
})
