/**
 * I (cycle b) — KpiCardsBlockView hydration tests.
 *
 * Validates that `items[i].compute` correctly:
 *   1. Aggregates raw rows from `block.source` (inline).
 *   2. Honors per-card `when` filter (extra in-clause).
 *   3. Coexists with static items (mixed block).
 *   4. Falls back to today's behavior when source is absent.
 *
 * Renders SSR (no DOM events) under QueryClientProvider.
 */
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { KpiCardsBlockView } from '../KpiCardsBlock'
import type { KpiCardsBlock } from '@/types/document'

function ssr(node: ReactNode): string {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  })
  return renderToStaticMarkup(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

const ROWS = [
  { dept: 'Sales', status: 'closed', amount: 100 },
  { dept: 'Sales', status: 'open', amount: 50 },
  { dept: 'R&D', status: 'closed', amount: 80 },
  { dept: 'R&D', status: 'open', amount: 40 },
  { dept: 'HR', status: 'closed', amount: 30 },
]

describe('KpiCardsBlock — compute hydration (I cycle b)', () => {
  it('정적 items 는 source 가 있어도 변경 없이 통과', () => {
    const block: KpiCardsBlock = {
      type: 'kpi-cards',
      id: '01KPISTATIC0000000000000A',
      source: { kind: 'inline', rows: ROWS },
      items: [
        { label: '정적', value: 'static value' },
        { label: '정적 숫자', value: 999 },
      ],
    } as KpiCardsBlock
    const html = ssr(<KpiCardsBlockView block={block} />)
    expect(html).toContain('static value')
    expect(html).toContain('999')
  })

  it('compute 가 있는 item 만 source 에서 집계', () => {
    const block: KpiCardsBlock = {
      type: 'kpi-cards',
      id: '01KPICOMPUTE000000000000A',
      source: { kind: 'inline', rows: ROWS },
      items: [
        {
          label: '총 매출',
          value: 0,
          compute: { field: 'amount', agg: 'sum' },
        },
        {
          label: '평균',
          value: 0,
          compute: { field: 'amount', agg: 'avg' },
        },
        {
          label: '건수',
          value: 0,
          compute: { field: 'amount', agg: 'count' },
        },
      ],
    } as KpiCardsBlock
    const html = ssr(<KpiCardsBlockView block={block} />)
    expect(html).toContain('300') // sum of all amounts
    expect(html).toContain('60') // avg = 300/5
    expect(html).toContain('5') // count = 5 rows
  })

  it('per-card when 으로 한 카드만 추가 필터', () => {
    const block: KpiCardsBlock = {
      type: 'kpi-cards',
      id: '01KPIWHEN00000000000000AB',
      source: { kind: 'inline', rows: ROWS },
      items: [
        {
          label: '마감 매출',
          value: 0,
          compute: { field: 'amount', agg: 'sum', when: { field: 'status', value: 'closed' } },
        },
        {
          label: '진행 매출',
          value: 0,
          compute: { field: 'amount', agg: 'sum', when: { field: 'status', value: 'open' } },
        },
      ],
    } as KpiCardsBlock
    const html = ssr(<KpiCardsBlockView block={block} />)
    // closed: 100 + 80 + 30 = 210
    expect(html).toContain('210')
    // open: 50 + 40 = 90
    expect(html).toContain('90')
  })

  it('block.filters 가 모든 compute item 에 적용', () => {
    const block: KpiCardsBlock = {
      type: 'kpi-cards',
      id: '01KPIFILTER000000000000AB',
      source: { kind: 'inline', rows: ROWS },
      filters: [{ field: 'dept', op: 'in', value: ['Sales'] }],
      items: [
        {
          label: 'Sales 합계',
          value: 0,
          compute: { field: 'amount', agg: 'sum' },
        },
      ],
    } as KpiCardsBlock
    const html = ssr(<KpiCardsBlockView block={block} />)
    // Sales only: 100 + 50 = 150
    expect(html).toContain('150')
    expect(html).not.toContain('300') // total
  })

  it('source 가 없으면 today 와 동일 (back-compat)', () => {
    const block: KpiCardsBlock = {
      type: 'kpi-cards',
      id: '01KPICOMPNOSRC0000000000A',
      items: [
        {
          label: '매출',
          value: 'precomputed',
          compute: { field: 'amount', agg: 'sum' },
        },
      ],
    } as KpiCardsBlock
    const html = ssr(<KpiCardsBlockView block={block} />)
    // compute 가 있어도 source 가 없으면 정적 value 그대로
    expect(html).toContain('precomputed')
  })

  it('when 의 value 가 배열이면 in semantic', () => {
    const block: KpiCardsBlock = {
      type: 'kpi-cards',
      id: '01KPIWHENARR0000000000AB',
      source: { kind: 'inline', rows: ROWS },
      items: [
        {
          label: '특정 부서',
          value: 0,
          compute: {
            field: 'amount',
            agg: 'sum',
            when: { field: 'dept', value: ['Sales', 'R&D'] },
          },
        },
      ],
    } as KpiCardsBlock
    const html = ssr(<KpiCardsBlockView block={block} />)
    // Sales (100+50) + R&D (80+40) = 270
    expect(html).toContain('270')
  })
})
