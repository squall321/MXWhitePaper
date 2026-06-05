/**
 * K-1 — TableBlockView source hydration SSR tests.
 *
 * When `block.source` is set, viewer renders rows derived from raw
 * source rows (filtered through block.filters), with cells projected
 * onto block.headers. block.rows is ignored. Sparse mode skips
 * hydration entirely.
 */
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TableBlockView } from '../TableBlock'
import type { TableBlock } from '@/types/document'

function ssr(node: ReactNode): string {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  })
  return renderToStaticMarkup(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

describe('<TableBlockView /> — source hydration (K)', () => {
  it('source 가 없으면 block.rows 그대로 (back-compat)', () => {
    const block: TableBlock = {
      type: 'table',
      id: '01TABLENOSRC00000000000000',
      headers: ['dept', 'amount'],
      rows: [
        ['Sales', '100'],
        ['R&D', '80'],
      ],
    }
    const html = ssr(<TableBlockView block={block} />)
    expect(html).toContain('Sales')
    expect(html).toContain('100')
    expect(html).toContain('R&amp;D')
    expect(html).toContain('80')
  })

  it('source 가 있으면 source rows 를 headers 로 project 해서 표시', () => {
    const block: TableBlock = {
      type: 'table',
      id: '01TABLESRC00000000000000AB',
      headers: ['dept', 'amount'],
      rows: [['IGNORED', '0']],
      source: {
        kind: 'inline',
        rows: [
          { dept: 'Sales', amount: 100, hidden_col: 'a' },
          { dept: 'HR', amount: 30, hidden_col: 'b' },
        ],
      },
    } as TableBlock
    const html = ssr(<TableBlockView block={block} />)
    expect(html).not.toContain('IGNORED')
    expect(html).toContain('Sales')
    expect(html).toContain('HR')
    expect(html).toContain('100')
    expect(html).toContain('30')
    // hidden_col is not in headers → not rendered in main grid
    // (it shows up only in drill modal which isn't open at SSR time)
    expect(html).not.toContain('hidden_col')
  })

  it('block.filters 가 source rows 에 적용', () => {
    const block: TableBlock = {
      type: 'table',
      id: '01TABLEFLT0000000000000000',
      headers: ['dept', 'amount'],
      rows: [],
      source: {
        kind: 'inline',
        rows: [
          { dept: 'Sales', amount: 100 },
          { dept: 'R&D', amount: 80 },
          { dept: 'HR', amount: 30 },
        ],
      },
      filters: [{ field: 'amount', op: 'gt', value: 50 }],
    } as TableBlock
    const html = ssr(<TableBlockView block={block} />)
    expect(html).toContain('100')
    expect(html).toContain('80')
    expect(html).not.toContain('>30<')
  })

  it('cursor-pointer wiring 은 source 가 있을 때만', () => {
    const noSource: TableBlock = {
      type: 'table',
      id: '01TABLENOSRC00000000000001',
      headers: ['a'],
      rows: [['1']],
    }
    const withSource: TableBlock = {
      ...noSource,
      id: '01TABLESRC00000000000000XY',
      source: { kind: 'inline', rows: [{ a: 1 }] },
    } as TableBlock
    expect(ssr(<TableBlockView block={noSource} />)).not.toContain('cursor-pointer')
    expect(ssr(<TableBlockView block={withSource} />)).toContain('cursor-pointer')
  })

  it('sparse mode 는 source 가 있어도 무시', () => {
    const block: TableBlock = {
      type: 'table',
      id: '01TABLESPRSE0000000000000A',
      headers: ['dept', 'amount'],
      rows: [],
      cells: [
        { r: 0, c: 0, text: 'dept', header: true },
        { r: 0, c: 1, text: 'amount', header: true },
        { r: 1, c: 0, text: 'Static', rowSpan: 2 },
        { r: 1, c: 1, text: '999' },
        { r: 2, c: 1, text: '777' },
      ],
      source: {
        kind: 'inline',
        rows: [{ dept: 'Sales', amount: 100 }],
      },
    } as TableBlock
    const html = ssr(<TableBlockView block={block} />)
    // Static (sparse) wins over hydration
    expect(html).toContain('Static')
    expect(html).toContain('999')
    expect(html).not.toContain('Sales')
  })
})
