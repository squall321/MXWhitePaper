/**
 * Sprint 1 — PivotTableBlockEditor SSR + helpers.
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  PivotTableBlockEditor,
  detectFields,
  parseCsv,
} from '../PivotTableBlockEditor'
import type { PivotTableBlock } from '@/types/document'

function mkBlock(over: Partial<PivotTableBlock> = {}): PivotTableBlock {
  return {
    type: 'pivot-table',
    id: '01TEST0PIVOT000000000000ED',
    source: { kind: 'inline', rows: [] },
    rows: [],
    cols: [],
    values: [{ field: '', agg: 'sum' }],
    ...over,
  }
}

describe('PivotTableBlockEditor', () => {
  it('SSR — Source paste / DimPicker / ValuesPicker / Preview 영역 모두 노출', () => {
    const html = renderToStaticMarkup(
      <PivotTableBlockEditor block={mkBlock()} onChange={vi.fn()} />,
    )
    expect(html).toContain('Pivot Table')
    expect(html).toContain('CSV paste')
    expect(html).toContain('JSON rows')
    expect(html).toContain('Rows')
    expect(html).toContain('Cols')
    expect(html).toContain('Values')
    expect(html).toContain('미리보기')
    expect(html).toContain('data-block-editor="pivot-table"')
  })

  it('detectFields — raw rows 의 모든 key 합집합 반환', () => {
    expect(detectFields([])).toEqual([])
    expect(
      detectFields([
        { a: 1, b: 2 },
        { a: 3, c: 4 },
      ]),
    ).toEqual(['a', 'b', 'c'])
  })

  it('parseCsv — header + numeric/text/null 분기 + comma 분리', () => {
    const rows = parseCsv('dept,year,revenue\nSales,2024,100\nR&D,2024,80')
    expect(rows).toEqual([
      { dept: 'Sales', year: 2024, revenue: 100 },
      { dept: 'R&D', year: 2024, revenue: 80 },
    ])
  })

  it('parseCsv — tab 분리 자동 감지 + quoted text + 빈 cell → null', () => {
    const rows = parseCsv('a\tb\tc\n"x,y"\t\t10')
    expect(rows).toEqual([{ a: 'x,y', b: null, c: 10 }])
  })

  it('parseCsv — quoted "" escape', () => {
    const rows = parseCsv('a\n"He said ""hi"""')
    expect(rows).toEqual([{ a: 'He said "hi"' }])
  })

  it('detected fields 노출 + 감지된 필드 명 포함', () => {
    const html = renderToStaticMarkup(
      <PivotTableBlockEditor
        block={mkBlock({
          source: {
            kind: 'inline',
            rows: [{ department: 'Sales', revenue: 100 }],
          },
        })}
        onChange={vi.fn()}
      />,
    )
    expect(html).toContain('감지된 필드')
    expect(html).toContain('department')
    expect(html).toContain('revenue')
  })

  it('preview 동작 — 빈 축이면 안내 메시지', () => {
    const html = renderToStaticMarkup(
      <PivotTableBlockEditor block={mkBlock()} onChange={vi.fn()} />,
    )
    expect(html).toContain('표가 없습니다')
  })

  // ── Sprint 2 — Totals / Sort / Filters UI ────────────────────────────

  it('Sprint 2 SSR — Totals(3 checkbox) + Sort(axis/by/order) + Filters(Add button) 노출', () => {
    const html = renderToStaticMarkup(
      <PivotTableBlockEditor
        block={mkBlock({
          source: { kind: 'inline', rows: [{ d: 'A', v: 1 }] },
          rows: ['d'],
          values: [{ field: 'v', agg: 'sum' }],
        })}
        onChange={vi.fn()}
      />,
    )
    expect(html).toContain('data-testid="pivot-totals-picker"')
    expect(html).toContain('data-testid="pivot-totals-grand"')
    expect(html).toContain('data-testid="pivot-totals-row"')
    expect(html).toContain('data-testid="pivot-totals-col"')
    expect(html).toContain('data-testid="pivot-sort-picker"')
    expect(html).toContain('data-testid="pivot-sort-by"')
    expect(html).toContain('data-testid="pivot-filters-picker"')
    expect(html).toContain('data-testid="pivot-add-filter"')
    // sort by-options when row axis (1 dim + 1 measure label "sum(v)")
    expect(html).toContain('sum(v)')
  })

  it('Sprint 2 SSR — existing totals 값이 checkbox checked 로 반영', () => {
    const html = renderToStaticMarkup(
      <PivotTableBlockEditor
        block={mkBlock({
          source: { kind: 'inline', rows: [{ d: 'A', v: 1 }] },
          rows: ['d'],
          totals: { grand: true, row: true, col: false },
        })}
        onChange={vi.fn()}
      />,
    )
    // Two checked checkboxes (grand + row). React SSR emits "checked"
    expect(html.match(/data-testid="pivot-totals-(grand|row|col)"[^>]*checked/g)?.length).toBe(
      2,
    )
  })

  it('Sprint 2 SSR — existing sort 값이 select / radio 에 반영', () => {
    const html = renderToStaticMarkup(
      <PivotTableBlockEditor
        block={mkBlock({
          source: { kind: 'inline', rows: [{ d: 'A', v: 1 }] },
          rows: ['d'],
          sort: { axis: 'row', by: 'd', order: 'desc' },
        })}
        onChange={vi.fn()}
      />,
    )
    expect(html).toContain('data-testid="pivot-sort-by"')
    // <select> with value attribute set to "d" — React SSR omits `value` attr
    // but emits a <option selected> child instead.
    expect(html).toMatch(/<option[^>]*selected[^>]*value="d"|<option[^>]*value="d"[^>]*selected/)
  })

  it('Sprint 2 SSR — 기존 filters 가 row 로 렌더', () => {
    const html = renderToStaticMarkup(
      <PivotTableBlockEditor
        block={mkBlock({
          source: { kind: 'inline', rows: [{ d: 'A', v: 1 }] },
          rows: ['d'],
          filters: [
            { field: 'd', op: 'in', value: ['A', 'B'] },
            { field: 'v', op: 'gt', value: 10 },
          ],
        })}
        onChange={vi.fn()}
      />,
    )
    expect(html).toContain('data-testid="pivot-filter-row-0"')
    expect(html).toContain('data-testid="pivot-filter-row-1"')
    // in/not_in 일 때 array → "A,B" CSV 표현
    expect(html).toContain('A,B')
  })

  // ── Sprint 4 — calculated field (measure.expr) UI ────────────────────

  it('Sprint 4 SSR — field 모드 (default) 일 때 mode toggle 2 개 + field select 렌더', () => {
    const html = renderToStaticMarkup(
      <PivotTableBlockEditor
        block={mkBlock({
          source: { kind: 'inline', rows: [{ revenue: 100, cost: 30 }] },
          values: [{ field: 'revenue', agg: 'sum' }],
        })}
        onChange={vi.fn()}
      />,
    )
    expect(html).toContain('data-testid="pivot-value-row-0"')
    expect(html).toContain('data-testid="pivot-value-mode-field-0"')
    expect(html).toContain('data-testid="pivot-value-mode-expr-0"')
    // field 라디오가 checked
    expect(html).toMatch(/data-testid="pivot-value-mode-field-0"[^>]*checked/)
  })

  it('Sprint 4 SSR — expr 모드일 때 textarea + 사용 가능 fields 힌트 노출', () => {
    const html = renderToStaticMarkup(
      <PivotTableBlockEditor
        block={mkBlock({
          source: { kind: 'inline', rows: [{ revenue: 100, cost: 30 }] },
          values: [{ expr: 'revenue - cost', agg: 'sum' }],
        })}
        onChange={vi.fn()}
      />,
    )
    expect(html).toContain('data-testid="pivot-value-expr-0"')
    expect(html).toContain('data-testid="pivot-value-expr-fields-0"')
    expect(html).toContain('사용 가능 fields')
    // expr 라디오가 checked
    expect(html).toMatch(/data-testid="pivot-value-mode-expr-0"[^>]*checked/)
    // 식 본문이 textarea 안에 들어가 있음
    expect(html).toContain('revenue - cost')
  })
})
