/**
 * M-2 — Drill CSV export helpers.
 *
 * Two builders: drillRowsToCsv (chart/kpi/pivot — multi-row) and
 * drillSingleRowToCsv (table — single row as field:value pairs).
 * Both go through `rowsToCsv` which handles RFC 4180 quoting.
 */
import { describe, it, expect } from 'vitest'
import { drillRowsToCsv, drillSingleRowToCsv } from '../widgetExport'

describe('drillRowsToCsv', () => {
  it('header row + body rows with field union order', () => {
    const csv = drillRowsToCsv(
      ['dept', 'amount'],
      [
        { dept: 'Sales', amount: 100 },
        { dept: 'R&D', amount: 80 },
      ],
    )
    expect(csv).toBe('dept,amount\r\nSales,100\r\nR&D,80')
  })

  it('missing keys → empty cells', () => {
    const csv = drillRowsToCsv(
      ['a', 'b', 'c'],
      [{ a: 1 }, { b: 2, c: 3 }],
    )
    expect(csv).toBe('a,b,c\r\n1,,\r\n,2,3')
  })

  it('comma/quote/newline are RFC 4180 quoted', () => {
    const csv = drillRowsToCsv(
      ['note'],
      [{ note: 'has, comma' }, { note: 'has "quote"' }, { note: 'line\nbreak' }],
    )
    expect(csv).toBe('note\r\n"has, comma"\r\n"has ""quote"""\r\n"line\nbreak"')
  })

  it('null cell → empty string', () => {
    const csv = drillRowsToCsv(['a'], [{ a: null }])
    expect(csv).toBe('a\r\n')
  })

  it('empty rows array → header only', () => {
    const csv = drillRowsToCsv(['a', 'b'], [])
    expect(csv).toBe('a,b')
  })
})

describe('drillSingleRowToCsv', () => {
  it('two-column field:value layout', () => {
    const csv = drillSingleRowToCsv(['dept', 'amount', 'region'], {
      dept: 'Sales',
      amount: 100,
      region: 'Seoul',
    })
    expect(csv).toBe('__field__,__value__\r\ndept,Sales\r\namount,100\r\nregion,Seoul')
  })

  it('fields not present in row → empty value', () => {
    const csv = drillSingleRowToCsv(['a', 'b'], { a: 1 })
    expect(csv).toBe('__field__,__value__\r\na,1\r\nb,')
  })

  it('field order is preserved from caller (header columns first)', () => {
    const csv = drillSingleRowToCsv(['a', 'z', 'm'], { z: 2, m: 3, a: 1 })
    expect(csv).toBe('__field__,__value__\r\na,1\r\nz,2\r\nm,3')
  })
})
