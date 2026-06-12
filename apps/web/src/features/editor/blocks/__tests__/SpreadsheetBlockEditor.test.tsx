import { describe, it, expect, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SpreadsheetBlockEditor } from '../SpreadsheetBlockEditor'
import { useEditorStore } from '@/features/editor/state'
import type { SpreadsheetBlock } from '@/types/document'

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

const SLUG = 'demo-doc'

const baseBlock: SpreadsheetBlock = {
  type: 'spreadsheet',
  id: '01EDITORBLOCK0000000000SS1',
  title: '예산',
  cols: 4,
  rows: 5,
  cells: { A1: '10', B1: '20', C1: '=A1+B1' },
}

describe('<SpreadsheetBlockEditor /> smoke', () => {
  beforeEach(() => {
    useEditorStore.getState().reset()
    useEditorStore.setState({ slug: SLUG, etag: 'etag-test' })
  })

  it('renders title input + add row/col buttons + grid inputs', () => {
    const html = renderToStaticMarkup(
      harness(<SpreadsheetBlockEditor slug={SLUG} block={baseBlock} />),
    )
    expect(html.length).toBeGreaterThan(0)
    expect(html).toContain('예산')
    expect(html).toContain('+ 행 추가')
    expect(html).toContain('+ 열 추가')
    // Header letters A..D for cols=4.
    expect(html).toContain('>A<')
    expect(html).toContain('>D<')
  })

  it('renders the formula bar with em-dash when nothing focused yet', () => {
    const html = renderToStaticMarkup(
      harness(<SpreadsheetBlockEditor slug={SLUG} block={baseBlock} />),
    )
    // Initial focused state is null → label '—'.
    expect(html).toContain('—')
    expect(html).toContain('셀을 선택하세요')
  })

  it('initially shows COMPUTED values in the inputs (no cell focused)', () => {
    const html = renderToStaticMarkup(
      harness(<SpreadsheetBlockEditor slug={SLUG} block={baseBlock} />),
    )
    // C1 is `=A1+B1` which evaluates to 30; with no focus the input value
    // shows the computed result, not the formula text.
    expect(html).toContain('value="30"')
    // A1's literal "10" still renders.
    expect(html).toContain('value="10"')
  })

  it('exposes data-cell-ref on each input', () => {
    const html = renderToStaticMarkup(
      harness(<SpreadsheetBlockEditor slug={SLUG} block={baseBlock} />),
    )
    expect(html).toContain('data-cell-ref="A1"')
    expect(html).toContain('data-cell-ref="D5"')
  })

  it('renders row labels 1..5 for rows=5', () => {
    const html = renderToStaticMarkup(
      harness(<SpreadsheetBlockEditor slug={SLUG} block={baseBlock} />),
    )
    expect(html).toContain('>1<')
    expect(html).toContain('>5<')
  })

  it('renders ✕ delete buttons in row + column headers (SSR)', () => {
    const html = renderToStaticMarkup(
      harness(<SpreadsheetBlockEditor slug={SLUG} block={baseBlock} />),
    )
    // Row delete buttons exist for rows 1..5.
    expect(html).toContain('aria-label="행 1 삭제"')
    expect(html).toContain('aria-label="행 5 삭제"')
    expect(html).toContain('data-spreadsheet-delete-row="1"')
    // Column delete buttons exist for A..D (cols=4).
    expect(html).toContain('aria-label="열 A 삭제"')
    expect(html).toContain('aria-label="열 D 삭제"')
    expect(html).toContain('data-spreadsheet-delete-col="A"')
  })

  it('renders 중간 삽입 buttons in row + column headers (SSR)', () => {
    const html = renderToStaticMarkup(
      harness(<SpreadsheetBlockEditor slug={SLUG} block={baseBlock} />),
    )
    expect(html).toContain('aria-label="행 1 위에 삽입"')
    expect(html).toContain('aria-label="행 5 아래에 삽입"')
    expect(html).toContain('aria-label="열 A 왼쪽에 삽입"')
    expect(html).toContain('aria-label="열 D 오른쪽에 삽입"')
    expect(html).toContain('data-spreadsheet-insert-row-above="1"')
    expect(html).toContain('data-spreadsheet-insert-col-left="A"')
  })

  it('renders CSV/TSV export buttons in toolbar (SSR)', () => {
    const html = renderToStaticMarkup(
      harness(<SpreadsheetBlockEditor slug={SLUG} block={baseBlock} />),
    )
    expect(html).toContain('data-spreadsheet-export-csv')
    expect(html).toContain('data-spreadsheet-export-tsv')
    expect(html).toContain('aria-label="CSV 내보내기"')
    expect(html).toContain('aria-label="TSV 내보내기"')
  })

  it('hides ✕ delete buttons when there is only a single row/col', () => {
    const oneByOne: SpreadsheetBlock = {
      ...baseBlock,
      cols: 1,
      rows: 1,
      cells: {},
    }
    const html = renderToStaticMarkup(
      harness(<SpreadsheetBlockEditor slug={SLUG} block={oneByOne} />),
    )
    // Last row/col deletion would empty the grid — should be suppressed.
    expect(html).not.toContain('aria-label="행 1 삭제"')
    expect(html).not.toContain('aria-label="열 A 삭제"')
  })
})
