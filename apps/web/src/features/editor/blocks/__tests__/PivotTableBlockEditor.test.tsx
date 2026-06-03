/**
 * Sprint 1 — PivotTableBlockEditor SSR + helpers.
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

// Sprint 6 — PivotTableBlockEditor mounts the live PivotTableBlockView as
// a preview, which now reads useQuery for the data-source hydration path.
// Wrap with a fresh QueryClientProvider so React doesn't throw.
function harness(node: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  })
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>
}

function ssr(node: ReactNode) {
  return renderToStaticMarkup(harness(node))
}
import {
  PivotTableBlockEditor,
  applyPivotDragEnd,
  detectFields,
  fieldDragId,
  itemDragId,
  parseCsv,
  zoneDropId,
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
    const html = ssr(
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
    const html = ssr(
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
    const html = ssr(
      <PivotTableBlockEditor block={mkBlock()} onChange={vi.fn()} />,
    )
    expect(html).toContain('표가 없습니다')
  })

  // ── Sprint 2 — Totals / Sort / Filters UI ────────────────────────────

  it('Sprint 2 SSR — Totals(3 checkbox) + Sort(axis/by/order) + Filters(Add button) 노출', () => {
    const html = ssr(
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
    const html = ssr(
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
    const html = ssr(
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
    const html = ssr(
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
    const html = ssr(
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
    const html = ssr(
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

  // ── DnD pivot pickers ──────────────────────────────────────────────────

  it('DnD SSR — Available Fields panel 렌더 + 각 필드가 draggable 버튼으로 노출', () => {
    const html = ssr(
      <PivotTableBlockEditor
        block={mkBlock({
          source: {
            kind: 'inline',
            rows: [{ department: 'Sales', year: 2024, revenue: 100 }],
          },
        })}
        onChange={vi.fn()}
      />,
    )
    expect(html).toContain('data-testid="pivot-available-fields"')
    expect(html).toContain('Available Fields')
    expect(html).toContain('data-testid="pivot-field-department"')
    expect(html).toContain('data-testid="pivot-field-year"')
    expect(html).toContain('data-testid="pivot-field-revenue"')
    // 사용자 힌트 (드래그하라)
    expect(html).toContain('드래그하여')
  })

  it('DnD SSR — Rows / Cols / Values 모두 droppable zone wrapper 보유', () => {
    const html = ssr(
      <PivotTableBlockEditor
        block={mkBlock({
          source: { kind: 'inline', rows: [{ a: 1, b: 2 }] },
        })}
        onChange={vi.fn()}
      />,
    )
    expect(html).toContain('data-testid="pivot-dropzone-rows"')
    expect(html).toContain('data-testid="pivot-dropzone-cols"')
    expect(html).toContain('data-testid="pivot-dropzone-values"')
    // 빈 Rows/Cols zone 은 "필드 드래그" 힌트
    expect(html).toContain('필드 드래그')
  })

  it('DnD accessibility — DnD 추가 후에도 기존 dropdown fallback 보존 (회귀 가드)', () => {
    const html = ssr(
      <PivotTableBlockEditor
        block={mkBlock({
          source: { kind: 'inline', rows: [{ a: 1, b: 2 }] },
        })}
        onChange={vi.fn()}
      />,
    )
    // 키보드 사용자 fallback — Rows / Cols dropdown 라벨 + 옵션 1개 이상
    expect(html).toContain('aria-label="Rows 필드 추가"')
    expect(html).toContain('aria-label="Cols 필드 추가"')
    expect(html).toContain('+ 필드 추가')
    // Values 의 + measure 버튼 + agg select 도 그대로
    expect(html).toContain('data-testid="pivot-add-value"')
    expect(html).toContain('aria-label="value 1 agg"')
  })

  // ── applyPivotDragEnd — 순수 reducer (테스트가 dnd-kit 이벤트를 시뮬레이션
  //     하지 않고 reducer 만 통해 상태 전이를 검증한다) ──────────────────────

  describe('applyPivotDragEnd', () => {
    const base = mkBlock({
      source: { kind: 'inline', rows: [{ dept: 'A', year: 2024, revenue: 1 }] },
      rows: ['dept'],
      cols: [],
      values: [{ field: 'revenue', agg: 'sum' }],
    })

    it('Available field → Rows zone: rows 배열 끝에 push', () => {
      const next = applyPivotDragEnd(base, fieldDragId('year'), zoneDropId('rows'))
      expect(next).not.toBe(base)
      expect(next.rows).toEqual(['dept', 'year'])
    })

    it('Available field → Values zone: agg=sum default + multi-value 유지', () => {
      const next = applyPivotDragEnd(base, fieldDragId('year'), zoneDropId('values'))
      expect(next.values).toHaveLength(2)
      expect(next.values[1]).toEqual({ field: 'year', agg: 'sum' })
    })

    it('Available field → Rows zone with dup: 변경 없음 (같은 dim 중복 방지)', () => {
      const next = applyPivotDragEnd(base, fieldDragId('dept'), zoneDropId('rows'))
      expect(next).toBe(base)
    })

    it('Rows item → Cols zone: dim 이 zone 간 이동', () => {
      const next = applyPivotDragEnd(base, itemDragId('rows', 0), zoneDropId('cols'))
      expect(next.rows).toEqual([])
      expect(next.cols).toEqual(['dept'])
    })

    it('Rows item → 같은 zone 의 다른 item: arrayMove reorder', () => {
      const twoRows = { ...base, rows: ['dept', 'year'] }
      const next = applyPivotDragEnd(twoRows, itemDragId('rows', 1), itemDragId('rows', 0))
      expect(next.rows).toEqual(['year', 'dept'])
    })

    it('Values item ↔ rows/cols zone: 차원 metadata 가 다르므로 변경 없음', () => {
      // values → rows
      expect(applyPivotDragEnd(base, itemDragId('values', 0), zoneDropId('rows'))).toBe(base)
      // field 일반 케이스는 values 로 들어갈 수 있지만, dim item 이 values 로 들어가는 건
      // 동일하게 거부 (cross-mapping 없음).
      const withColDim = { ...base, cols: ['year'] }
      expect(
        applyPivotDragEnd(withColDim, itemDragId('cols', 0), zoneDropId('values')),
      ).toBe(withColDim)
    })

    it('드래그 over 가 없거나 (drop 외부) 같은 위치면 변경 없음', () => {
      expect(applyPivotDragEnd(base, fieldDragId('year'), null)).toBe(base)
      expect(applyPivotDragEnd(base, itemDragId('rows', 0), itemDragId('rows', 0))).toBe(base)
    })
  })
})
