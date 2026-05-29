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
})
