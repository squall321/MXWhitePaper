import { describe, it, expect } from 'vitest'
import {
  applyConditionalFormatting,
  mergeCondStyle,
  type ConditionalRule,
} from '../conditionalFormatting'

const ctx = (idx = 0, name?: string, columnValues?: (string | number)[]) => ({
  columnIndex: idx,
  columnName: name,
  columnValues,
})

describe('applyConditionalFormatting — operators', () => {
  const style = { bg: '#ffe0e0' }

  it('gt — numeric coercion handles plain string', () => {
    const rules: ConditionalRule[] = [{ operator: 'gt', value: 100, style }]
    expect(applyConditionalFormatting(rules, '150', ctx())).toEqual(style)
    expect(applyConditionalFormatting(rules, '99', ctx())).toBeUndefined()
  })

  it('gte / lt / lte / neq', () => {
    const gte: ConditionalRule[] = [{ operator: 'gte', value: 10, style }]
    expect(applyConditionalFormatting(gte, '10', ctx())).toEqual(style)
    const lt: ConditionalRule[] = [{ operator: 'lt', value: 5, style }]
    expect(applyConditionalFormatting(lt, '4', ctx())).toEqual(style)
    const lte: ConditionalRule[] = [{ operator: 'lte', value: 5, style }]
    expect(applyConditionalFormatting(lte, '5', ctx())).toEqual(style)
    const neq: ConditionalRule[] = [{ operator: 'neq', value: 0, style }]
    expect(applyConditionalFormatting(neq, '1', ctx())).toEqual(style)
    expect(applyConditionalFormatting(neq, '0', ctx())).toBeUndefined()
  })

  it('eq — falls back to string compare when not numeric', () => {
    const rules: ConditionalRule[] = [{ operator: 'eq', value: 'Pass', style }]
    expect(applyConditionalFormatting(rules, 'Pass', ctx())).toEqual(style)
    expect(applyConditionalFormatting(rules, 'Fail', ctx())).toBeUndefined()
  })

  it('between — inclusive range', () => {
    const rules: ConditionalRule[] = [
      { operator: 'between', value: [10, 20], style },
    ]
    expect(applyConditionalFormatting(rules, '10', ctx())).toEqual(style)
    expect(applyConditionalFormatting(rules, '20', ctx())).toEqual(style)
    expect(applyConditionalFormatting(rules, '21', ctx())).toBeUndefined()
  })

  it('top_n — picks the top N column values', () => {
    const rules: ConditionalRule[] = [{ operator: 'top_n', value: 2, style }]
    const colVals = ['10', '50', '30', '20']
    expect(
      applyConditionalFormatting(rules, '50', ctx(0, undefined, colVals)),
    ).toEqual(style)
    expect(
      applyConditionalFormatting(rules, '30', ctx(0, undefined, colVals)),
    ).toEqual(style)
    expect(
      applyConditionalFormatting(rules, '20', ctx(0, undefined, colVals)),
    ).toBeUndefined()
  })

  it('bottom_n — picks the bottom N column values', () => {
    const rules: ConditionalRule[] = [{ operator: 'bottom_n', value: 1, style }]
    const colVals = ['10', '50', '30']
    expect(
      applyConditionalFormatting(rules, '10', ctx(0, undefined, colVals)),
    ).toEqual(style)
    expect(
      applyConditionalFormatting(rules, '30', ctx(0, undefined, colVals)),
    ).toBeUndefined()
  })

  it('top_n — skips when columnValues missing', () => {
    const rules: ConditionalRule[] = [{ operator: 'top_n', value: 1, style }]
    expect(applyConditionalFormatting(rules, '50', ctx())).toBeUndefined()
  })

  it('contains / not_contains — case-insensitive substring', () => {
    const c: ConditionalRule[] = [
      { operator: 'contains', value: 'pass', style },
    ]
    expect(applyConditionalFormatting(c, 'Passed', ctx())).toEqual(style)
    expect(applyConditionalFormatting(c, 'Failed', ctx())).toBeUndefined()
    const nc: ConditionalRule[] = [
      { operator: 'not_contains', value: 'fail', style },
    ]
    expect(applyConditionalFormatting(nc, 'Passed', ctx())).toEqual(style)
    expect(applyConditionalFormatting(nc, 'Failed', ctx())).toBeUndefined()
  })

  it('handles formatted numeric strings (thousands, %, currency)', () => {
    const rules: ConditionalRule[] = [{ operator: 'gt', value: 1000, style }]
    expect(applyConditionalFormatting(rules, '1,234', ctx())).toEqual(style)
    expect(applyConditionalFormatting(rules, '$5,000', ctx())).toEqual(style)
  })
})

describe('applyConditionalFormatting — column scope + merging', () => {
  it('column index scope skips other columns', () => {
    const rules: ConditionalRule[] = [
      { column: 1, operator: 'gt', value: 0, style: { bg: '#fff' } },
    ]
    expect(applyConditionalFormatting(rules, '5', ctx(0))).toBeUndefined()
    expect(applyConditionalFormatting(rules, '5', ctx(1))).toEqual({
      bg: '#fff',
    })
  })

  it('column name scope matches by header', () => {
    const rules: ConditionalRule[] = [
      { column: '매출', operator: 'gt', value: 0, style: { bg: '#fff' } },
    ]
    expect(
      applyConditionalFormatting(rules, '5', ctx(0, '매출')),
    ).toEqual({ bg: '#fff' })
    expect(
      applyConditionalFormatting(rules, '5', ctx(0, '비용')),
    ).toBeUndefined()
  })

  it('multiple matching rules OR-merge style keys; later wins per-key', () => {
    const rules: ConditionalRule[] = [
      { operator: 'gt', value: 0, style: { bg: '#aaa', bold: true } },
      { operator: 'gt', value: 10, style: { bg: '#bbb', fg: '#111' } },
    ]
    expect(applyConditionalFormatting(rules, '20', ctx())).toEqual({
      bg: '#bbb',
      bold: true,
      fg: '#111',
    })
  })

  it('empty/undefined cellValue → no style', () => {
    const rules: ConditionalRule[] = [
      { operator: 'gt', value: 0, style: { bg: '#aaa' } },
    ]
    expect(applyConditionalFormatting(rules, '', ctx())).toBeUndefined()
    expect(applyConditionalFormatting(rules, undefined, ctx())).toBeUndefined()
  })

  it('empty rules array → no style', () => {
    expect(applyConditionalFormatting([], '5', ctx())).toBeUndefined()
    expect(applyConditionalFormatting(undefined, '5', ctx())).toBeUndefined()
  })
})

describe('mergeCondStyle — sparse cell override priority', () => {
  it('cell.bg/color/bold override conditional style', () => {
    const base = { bg: '#aaa', fg: '#111', bold: true }
    const merged = mergeCondStyle(base, { bg: '#fff', color: '#222' })
    expect(merged).toEqual({ bg: '#fff', fg: '#222', bold: true })
  })

  it('returns base when override is empty', () => {
    expect(mergeCondStyle({ bg: '#aaa' }, undefined)).toEqual({ bg: '#aaa' })
    expect(mergeCondStyle({ bg: '#aaa' }, {})).toEqual({ bg: '#aaa' })
  })

  it('returns override only when base undefined', () => {
    expect(mergeCondStyle(undefined, { bg: '#fff' })).toEqual({ bg: '#fff' })
    expect(mergeCondStyle(undefined, undefined)).toBeUndefined()
  })
})
