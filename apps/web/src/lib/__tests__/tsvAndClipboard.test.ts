/**
 * N — TSV builders + UTF-8 BOM + clipboard fallback.
 *
 * TSV builders mirror CSV builders but use tab separator. `tsvCell`
 * collapses tabs/newlines to spaces (Excel TSV is line-sensitive).
 * `copyToClipboard` returns false in jsdom (no clipboard, no execCommand
 * impl) — verifies the fallback path doesn't throw.
 */
import { describe, it, expect } from 'vitest'
import {
  drillRowsToTsv,
  drillSingleRowToTsv,
  rowsToTsv,
  UTF8_BOM,
  copyToClipboard,
} from '../widgetExport'

describe('rowsToTsv', () => {
  it('tab-separated, CRLF line break', () => {
    expect(rowsToTsv(['a', 'b'], [[1, 2], [3, 4]])).toBe('a\tb\r\n1\t2\r\n3\t4')
  })
  it('tab in cell collapsed to space (no quoting)', () => {
    expect(rowsToTsv(['x'], [['has\ttab']])).toBe('x\r\nhas tab')
  })
  it('newline in cell collapsed (TSV is line-sensitive)', () => {
    expect(rowsToTsv(['x'], [['line\nbreak']])).toBe('x\r\nline break')
  })
})

describe('drillRowsToTsv', () => {
  it('field union ordering preserved', () => {
    const tsv = drillRowsToTsv(
      ['dept', 'amount'],
      [{ dept: 'Sales', amount: 100 }],
    )
    expect(tsv).toBe('dept\tamount\r\nSales\t100')
  })
})

describe('drillSingleRowToTsv', () => {
  it('field/value 2-column layout', () => {
    const tsv = drillSingleRowToTsv(['dept', 'amount'], {
      dept: 'Sales',
      amount: 100,
    })
    expect(tsv).toBe('__field__\t__value__\r\ndept\tSales\r\namount\t100')
  })
})

describe('UTF8_BOM', () => {
  it('is the canonical BOM code-point (U+FEFF)', () => {
    expect(UTF8_BOM).toBe('﻿')
    expect(UTF8_BOM.length).toBe(1)
  })
})

describe('copyToClipboard', () => {
  it('returns false (or true if mocked) without throwing in jsdom', async () => {
    // Defensive: just verify it resolves with a boolean.
    const ok = await copyToClipboard('hello')
    expect(typeof ok).toBe('boolean')
  })

  it('falls back to execCommand textarea when async Clipboard API throws (S2)', async () => {
    if (typeof navigator === 'undefined' || typeof document === 'undefined') return
    const descriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    if (!descriptor || !descriptor.configurable) return
    // self-review F6 — try/finally 로 mock 누수 회피. assertion 실패 시
    // 다른 test 가 mock 된 clipboard / execCommand 를 inherit 못 하게.
    const originalExec = document.execCommand
    let execCalled = false
    try {
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: async () => { throw new Error('permission denied') } },
        configurable: true,
      })
      Object.defineProperty(document, 'execCommand', {
        value: () => { execCalled = true; return true },
        configurable: true,
        writable: true,
      })
      const ok = await copyToClipboard('via fallback')
      expect(execCalled).toBe(true)
      expect(ok).toBe(true)
    } finally {
      if (originalExec) document.execCommand = originalExec
      Object.defineProperty(navigator, 'clipboard', descriptor)
    }
  })

  it('uses async Clipboard API when available (env-permitting)', async () => {
    // SSR vitest 환경엔 navigator 자체가 없을 수 있다. clipboard mock 도
    // descriptor configurable 일 때만 가능. 둘 다 못 하면 contract 만 확인.
    if (typeof navigator === 'undefined') {
      const ok = await copyToClipboard('no-navigator')
      expect(typeof ok).toBe('boolean')
      return
    }
    const descriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    if (!descriptor || !descriptor.configurable) {
      const ok = await copyToClipboard('contract only')
      expect(typeof ok).toBe('boolean')
      return
    }
    let written = ''
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async (s: string) => { written = s } },
      configurable: true,
    })
    const ok = await copyToClipboard('via api')
    expect(ok).toBe(true)
    expect(written).toBe('via api')
    Object.defineProperty(navigator, 'clipboard', descriptor)
  })
})
