import { describe, it, expect } from 'vitest'
import { looksLikeCsv, parseCsv } from '../csv-paste'

describe('looksLikeCsv', () => {
  it('detects basic comma-separated CSV', () => {
    expect(looksLikeCsv('a,b\n1,2\n3,4')).toBe(true)
  })
  it('detects tab-separated CSV', () => {
    expect(looksLikeCsv('a\tb\n1\t2')).toBe(true)
  })
  it('rejects single-line text', () => {
    expect(looksLikeCsv('just one line')).toBe(false)
  })
  it('rejects prose with random commas', () => {
    expect(looksLikeCsv('hello, this is not\na CSV at all')).toBe(false)
  })
})

describe('parseCsv', () => {
  it('parses simple comma CSV with headers', () => {
    const r = parseCsv('Name,Age\nAlice,30\nBob,25')
    expect(r).not.toBeNull()
    expect(r!.delimiter).toBe(',')
    expect(r!.headers).toEqual(['Name', 'Age'])
    expect(r!.rows).toEqual([
      ['Alice', '30'],
      ['Bob', '25'],
    ])
  })

  it('parses tab-separated', () => {
    const r = parseCsv('Name\tAge\nAlice\t30')
    expect(r!.delimiter).toBe('\t')
    expect(r!.headers).toEqual(['Name', 'Age'])
  })

  it('handles quoted fields with embedded commas', () => {
    const r = parseCsv('Name,Note\n"Alice, Q","hi"\nBob,plain')
    expect(r!.rows[0]).toEqual(['Alice, Q', 'hi'])
    expect(r!.rows[1]).toEqual(['Bob', 'plain'])
  })

  it('handles escaped double quotes', () => {
    const r = parseCsv('A,B\n"He said ""hi""",ok')
    expect(r!.rows[0]).toEqual(['He said "hi"', 'ok'])
  })

  it('returns null for non-CSV text', () => {
    expect(parseCsv('not a CSV')).toBeNull()
    expect(parseCsv('one line, only')).toBeNull()
  })

  it('pads short rows to header length', () => {
    const r = parseCsv('a,b,c\n1,2\n3,4,5')
    expect(r!.rows[0]).toEqual(['1', '2', ''])
    expect(r!.rows[1]).toEqual(['3', '4', '5'])
  })
})
