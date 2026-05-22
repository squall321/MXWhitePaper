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

describe('parseCsv — TSV/CSV regression (editor-paste-improvements)', () => {
  it('parses TSV (tab-separated) headers and rows', () => {
    const r = parseCsv('Name\tAge\tCity\nAlice\t30\tSeoul\nBob\t25\tBusan')
    expect(r).not.toBeNull()
    expect(r!.delimiter).toBe('\t')
    expect(r!.headers).toEqual(['Name', 'Age', 'City'])
    expect(r!.rows).toEqual([
      ['Alice', '30', 'Seoul'],
      ['Bob', '25', 'Busan'],
    ])
  })

  it('parses CSV (comma-separated) headers and rows', () => {
    const r = parseCsv('Name,Age,City\nAlice,30,Seoul\nBob,25,Busan')
    expect(r).not.toBeNull()
    expect(r!.delimiter).toBe(',')
    expect(r!.headers).toEqual(['Name', 'Age', 'City'])
    expect(r!.rows).toEqual([
      ['Alice', '30', 'Seoul'],
      ['Bob', '25', 'Busan'],
    ])
  })

  it('prefers tab when cells contain commas but tabs separate columns', () => {
    const r = parseCsv('Name\tNote\nAlice\thi, there\nBob\tplain')
    expect(r).not.toBeNull()
    expect(r!.delimiter).toBe('\t')
    expect(r!.headers).toEqual(['Name', 'Note'])
    expect(r!.rows).toEqual([
      ['Alice', 'hi, there'],
      ['Bob', 'plain'],
    ])
  })

  it('TSV and CSV of the same data yield identical headers and rows', () => {
    const tsv = parseCsv('Name\tAge\tCity\nAlice\t30\tSeoul\nBob\t25\tBusan')
    const csv = parseCsv('Name,Age,City\nAlice,30,Seoul\nBob,25,Busan')
    expect(tsv).not.toBeNull()
    expect(csv).not.toBeNull()
    expect(tsv!.headers).toEqual(csv!.headers)
    expect(tsv!.rows).toEqual(csv!.rows)
  })
})
