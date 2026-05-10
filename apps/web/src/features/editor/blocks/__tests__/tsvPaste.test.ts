import { describe, expect, it } from 'vitest'
import {
  applyTabularPasteToFlat,
  looksLikeTabular,
  parseTabular,
} from '../tsvPaste'

describe('looksLikeTabular', () => {
  it('passes through single-line plain text', () => {
    expect(looksLikeTabular('hello, world')).toBe(false)
    expect(looksLikeTabular('a,b,c')).toBe(false)
  })
  it('detects tab-separated single line', () => {
    expect(looksLikeTabular('a\tb\tc')).toBe(true)
  })
  it('detects multi-line TSV', () => {
    expect(looksLikeTabular('a\tb\nc\td')).toBe(true)
  })
  it('detects multi-line CSV when every line has commas', () => {
    expect(looksLikeTabular('a,b,c\nd,e,f')).toBe(true)
  })
  it('rejects multi-line text with no per-line commas', () => {
    expect(looksLikeTabular('hello\nworld')).toBe(false)
  })
  it('handles CRLF', () => {
    expect(looksLikeTabular('a\tb\r\nc\td\r\n')).toBe(true)
  })
})

describe('parseTabular', () => {
  it('prefers tabs over commas when both present', () => {
    const r = parseTabular('a,1\tb,2\nc,3\td,4')
    expect(r.cols).toBe(2)
    expect(r.rows).toEqual([
      ['a,1', 'b,2'],
      ['c,3', 'd,4'],
    ])
  })
  it('pads short rows with empty strings', () => {
    const r = parseTabular('a\tb\tc\nd\te')
    expect(r.cols).toBe(3)
    expect(r.rows).toEqual([
      ['a', 'b', 'c'],
      ['d', 'e', ''],
    ])
  })
  it('strips trailing newline', () => {
    const r = parseTabular('a\tb\n')
    expect(r.rows).toEqual([['a', 'b']])
  })
})

describe('applyTabularPasteToFlat', () => {
  it('grows the table to fit the paste', () => {
    const block = {
      headers: ['A', 'B'],
      rows: [
        ['1', '2'],
      ],
    }
    const paste = parseTabular('x\ty\tz\nu\tv\tw')
    const out = applyTabularPasteToFlat(block, 0, 1, paste)
    expect(out.headers).toEqual(['A', 'B', '열 3', '열 4'])
    expect(out.rows).toEqual([
      ['1', 'x', 'y', 'z'],
      ['', 'u', 'v', 'w'],
    ])
  })
  it('keeps existing data outside the paste rectangle', () => {
    const block = {
      headers: ['A', 'B', 'C'],
      rows: [
        ['1', '2', '3'],
        ['4', '5', '6'],
      ],
    }
    const out = applyTabularPasteToFlat(block, 1, 1, parseTabular('X\tY'))
    expect(out.rows).toEqual([
      ['1', '2', '3'],
      ['4', 'X', 'Y'],
    ])
  })
})
