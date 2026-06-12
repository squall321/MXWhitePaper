import { describe, it, expect } from 'vitest'
import { parseSpreadsheetPaste } from '../pasteParse'

describe('parseSpreadsheetPaste', () => {
  it('탭 구분 (Excel TSV) 그리드를 파싱한다', () => {
    expect(parseSpreadsheetPaste('a\tb\nc\td')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
  })

  it('탭이 하나라도 있으면 TSV 우선 — 콤마는 필드 내용으로 보존', () => {
    expect(parseSpreadsheetPaste('a\tb,c')).toEqual([['a', 'b,c']])
  })

  it('탭 없는 multi-line 은 CSV 로 파싱한다', () => {
    expect(parseSpreadsheetPaste('a,b\nc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
  })

  it('quote-aware CSV — 콤마 포함 필드 + "" escape', () => {
    expect(parseSpreadsheetPaste('"x,y",z\n"he said ""hi""",w')).toEqual([
      ['x,y', 'z'],
      ['he said "hi"', 'w'],
    ])
  })

  it('quote 안의 개행은 필드 내용으로 보존된다', () => {
    expect(parseSpreadsheetPaste('"a\nb",c\nd,e')).toEqual([
      ['a\nb', 'c'],
      ['d', 'e'],
    ])
  })

  it('CRLF 줄 구분 + trailing 빈 행을 제거한다', () => {
    expect(parseSpreadsheetPaste('a\tb\r\nc\td\r\n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
    expect(parseSpreadsheetPaste('a\tb\n\n\n')).toEqual([['a', 'b']])
  })

  it('jagged 행은 최대 너비로 right-pad 한다', () => {
    expect(parseSpreadsheetPaste('a\tb\nc')).toEqual([
      ['a', 'b'],
      ['c', ''],
    ])
  })

  it('단일 토큰은 null — 기본 paste 동작 유지', () => {
    expect(parseSpreadsheetPaste('hello')).toBeNull()
    // 단일 행 CSV (개행/탭 없음) 도 단일 토큰 취급.
    expect(parseSpreadsheetPaste('a,b')).toBeNull()
    expect(parseSpreadsheetPaste('')).toBeNull()
  })

  it('Excel 단일 셀 복사 (trailing CRLF 포함) 도 null', () => {
    expect(parseSpreadsheetPaste('a\r\n')).toBeNull()
    expect(parseSpreadsheetPaste('a\n')).toBeNull()
  })
})
