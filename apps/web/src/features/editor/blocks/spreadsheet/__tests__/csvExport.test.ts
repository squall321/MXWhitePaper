import { describe, it, expect } from 'vitest'
import { spreadsheetToDelimited } from '../csvExport'
import { evaluateAll } from '../formulaEngine'

describe('spreadsheetToDelimited', () => {
  it('serializes a 2×2 grid as CSV with computed values', () => {
    const cells = { A1: '10', B1: '20', A2: '=A1+B1' }
    const computed = evaluateAll(cells)
    const out = spreadsheetToDelimited({
      cols: 2,
      rows: 2,
      cells,
      computed,
      dialect: 'csv',
    })
    // A1=10,B1=20  / A2=30,B2=empty
    expect(out).toBe('10,20\r\n30,')
  })

  it('uses TSV separator + escapes embedded tabs', () => {
    const cells = { A1: 'hello\tworld', B1: 'second' }
    const out = spreadsheetToDelimited({
      cols: 2,
      rows: 1,
      cells,
      dialect: 'tsv',
    })
    // tab inside cell replaced with space (TSV has no standard escape).
    expect(out).toBe('hello world\tsecond')
  })

  it('escapes commas + double quotes per RFC 4180 in CSV', () => {
    const cells = { A1: 'a,b', B1: 'say "hi"', A2: 'plain' }
    const out = spreadsheetToDelimited({
      cols: 2,
      rows: 2,
      cells,
      dialect: 'csv',
    })
    expect(out).toBe('"a,b","say ""hi"""\r\nplain,')
  })

  it('emits error codes for unresolved refs when not in raw mode', () => {
    // 1×2 grid with A1 (row 0) and A2 (row 1). A1 has a computed error.
    const cells = { A1: '=Z99', A2: 'ok' }
    const out = spreadsheetToDelimited({
      cols: 1,
      rows: 2,
      cells,
      computed: { A1: { value: '', error: '#REF!' }, A2: { value: 'ok' } },
      dialect: 'csv',
    })
    expect(out).toBe('#REF!\r\nok')
  })

  it('raw=true preserves formula text instead of computed value', () => {
    const cells = { A1: '10', B1: '=A1*2' }
    const computed = evaluateAll(cells)
    const out = spreadsheetToDelimited({
      cols: 2,
      rows: 1,
      cells,
      computed,
      raw: true,
      dialect: 'csv',
    })
    expect(out).toBe('10,=A1*2')
  })
})
