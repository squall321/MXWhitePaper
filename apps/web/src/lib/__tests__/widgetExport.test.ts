import { describe, it, expect } from 'vitest'
import {
  chartLabeledToCsv,
  csvCell,
  flatTableToCsv,
  ganttTasksToCsv,
  kpiCardsToCsv,
  rowsToCsv,
  tsvCell,
} from '../widgetExport'

// Pure-helper unit tests. DOM-dependent helpers (svgElementToPng,
// svgElementToString, downloadBlob) need a real browser — covered by
// Playwright e2e in a follow-up, not by vitest (the web package doesn't
// pull jsdom).

describe('csvCell / tsvCell', () => {
  it('quotes CSV cells that contain comma / quote / newline', () => {
    expect(csvCell('hello')).toBe('hello')
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"')
    expect(csvCell('')).toBe('')
    expect(csvCell(null)).toBe('')
    expect(csvCell(42)).toBe('42')
  })

  it('strips tabs and newlines for TSV (no standard escape)', () => {
    expect(tsvCell('a\tb')).toBe('a b')
    expect(tsvCell('line1\nline2')).toBe('line1 line2')
    expect(tsvCell(null)).toBe('')
  })
})

describe('rowsToCsv', () => {
  it('joins headers + rows with CRLF and RFC 4180 escaping', () => {
    const csv = rowsToCsv(['name', 'value'], [
      ['a', 1],
      ['b, c', 2],
    ])
    expect(csv).toBe('name,value\r\na,1\r\n"b, c",2')
  })

  it('renders empty rows as just the header', () => {
    expect(rowsToCsv(['x'], [])).toBe('x')
  })
})

describe('kpiCardsToCsv', () => {
  it('omits trend column when no item carries trend', () => {
    const csv = kpiCardsToCsv([
      { label: 'Revenue', value: '1.2B', delta: '+3%' },
      { label: 'Users', value: 1234 },
    ])
    expect(csv.split('\r\n')[0]).toBe('label,value,delta')
    expect(csv).toContain('Users,1234,')
  })

  it('includes trend column when any item has trend', () => {
    const csv = kpiCardsToCsv([
      { label: 'A', value: 1, trend: 'up' },
      { label: 'B', value: 2 },
    ])
    const lines = csv.split('\r\n')
    expect(lines[0]).toBe('label,value,delta,trend')
    expect(lines[1]).toBe('A,1,,up')
    expect(lines[2]).toBe('B,2,,')
  })

  it('handles empty items list — just headers', () => {
    const csv = kpiCardsToCsv([])
    expect(csv).toBe('label,value,delta')
  })
})

describe('ganttTasksToCsv', () => {
  it('serialises tasks to name/start/end/progress columns', () => {
    const csv = ganttTasksToCsv([
      { name: 'Design', start: '2026-01-01', end: '2026-01-15', progress: 100 },
      { name: 'Build, ship', start: '2026-01-16', end: '2026-02-28' },
    ])
    const lines = csv.split('\r\n')
    expect(lines[0]).toBe('name,start,end,progress')
    expect(lines[1]).toBe('Design,2026-01-01,2026-01-15,100')
    expect(lines[2]).toBe('"Build, ship",2026-01-16,2026-02-28,')
  })
})

describe('flatTableToCsv', () => {
  it('round-trips a simple 2×2 table', () => {
    const csv = flatTableToCsv(['col1', 'col2'], [['a', 'b'], ['c', 'd']])
    expect(csv).toBe('col1,col2\r\na,b\r\nc,d')
  })
})

describe('chartLabeledToCsv', () => {
  it('uses xAxisLabel as the first column header', () => {
    const csv = chartLabeledToCsv('Year', ['2024', '2025'], [
      { name: 'Rev', values: [100, 150] },
      { name: 'Cost', values: [80, 90] },
    ])
    expect(csv).toBe('Year,Rev,Cost\r\n2024,100,80\r\n2025,150,90')
  })

  it('defaults to "x" header and leaves missing values empty', () => {
    const csv = chartLabeledToCsv(undefined, ['a', 'b', 'c'], [
      { name: 'S1', values: [1, 2] },
    ])
    const lines = csv.split('\r\n')
    expect(lines[0]).toBe('x,S1')
    expect(lines[3]).toBe('c,')
  })
})
