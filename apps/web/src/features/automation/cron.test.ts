import { describe, expect, it } from 'vitest'
import { nextRun, parseCron, relativeTimeKo } from './cron'

// Mirror of apps/api/tests/test_cron_parser.py — keep them aligned.

describe('parseCron', () => {
  it('parses every-minute', () => {
    const p = parseCron('* * * * *')
    expect(p.minute.size).toBe(60)
    expect(p.hour.size).toBe(24)
    expect(p.domUnrestricted).toBe(true)
    expect(p.dowUnrestricted).toBe(true)
  })

  it('treats `?` as `*`', () => {
    const p = parseCron('0 9 ? * 1')
    expect(p.minute.has(0)).toBe(true)
    expect(p.domUnrestricted).toBe(true)
  })

  it('parses range', () => {
    const p = parseCron('0 9-17 * * *')
    expect([...p.hour].sort((a, b) => a - b)).toEqual([
      9, 10, 11, 12, 13, 14, 15, 16, 17,
    ])
  })

  it('parses step', () => {
    const p = parseCron('*/15 * * * *')
    expect([...p.minute].sort((a, b) => a - b)).toEqual([0, 15, 30, 45])
  })

  it('parses comma list', () => {
    const p = parseCron('0 9,12,18 * * *')
    expect([...p.hour].sort((a, b) => a - b)).toEqual([9, 12, 18])
  })

  it('rejects too few fields', () => {
    expect(() => parseCron('* * * *')).toThrow()
  })

  it('rejects out-of-range minute', () => {
    expect(() => parseCron('60 * * * *')).toThrow()
  })

  it('rejects named dow', () => {
    expect(() => parseCron('0 9 * * mon')).toThrow()
  })

  it('rejects L extension', () => {
    expect(() => parseCron('0 9 L * *')).toThrow()
  })
})

describe('nextRun', () => {
  it('every-minute → +1 min', () => {
    const p = parseCron('* * * * *')
    const out = nextRun(p, new Date(Date.UTC(2026, 4, 9, 14, 30, 15)))
    expect(out.toISOString()).toBe('2026-05-09T14:31:00.000Z')
  })

  it('weekly Mon 9am — Saturday → next Mon', () => {
    const p = parseCron('0 9 * * 1')
    // 2026-05-09 is a Saturday; next Mon is 2026-05-11.
    const out = nextRun(p, new Date(Date.UTC(2026, 4, 9, 14, 30)))
    expect(out.toISOString()).toBe('2026-05-11T09:00:00.000Z')
  })

  it('strictly greater than `after`', () => {
    const p = parseCron('0 * * * *')
    const out = nextRun(p, new Date(Date.UTC(2026, 4, 9, 14, 0)))
    expect(out.toISOString()).toBe('2026-05-09T15:00:00.000Z')
  })

  it('monthly first-of-month', () => {
    const p = parseCron('0 9 1 * *')
    const out = nextRun(p, new Date(Date.UTC(2026, 4, 9, 14, 30)))
    expect(out.toISOString()).toBe('2026-06-01T09:00:00.000Z')
  })

  it('dom OR dow rule', () => {
    const p = parseCron('0 9 1 * 1') // 1st of month OR Monday
    // 2026-05-09 Sat → next Mon 2026-05-11.
    const out = nextRun(p, new Date(Date.UTC(2026, 4, 9, 14, 30)))
    expect(out.toISOString()).toBe('2026-05-11T09:00:00.000Z')
  })
})

describe('relativeTimeKo', () => {
  it('reports minutes for sub-hour', () => {
    const now = new Date(Date.UTC(2026, 4, 9, 14, 0))
    const target = new Date(Date.UTC(2026, 4, 9, 14, 5))
    expect(relativeTimeKo(now, target)).toBe('5분 뒤')
  })
  it('reports hours for sub-day', () => {
    const now = new Date(Date.UTC(2026, 4, 9, 14, 0))
    const target = new Date(Date.UTC(2026, 4, 9, 17, 30))
    expect(relativeTimeKo(now, target)).toBe('3시간 30분 뒤')
  })
  it('returns 지남 for past target', () => {
    const now = new Date(Date.UTC(2026, 4, 9, 14, 0))
    const target = new Date(Date.UTC(2026, 4, 9, 13, 0))
    expect(relativeTimeKo(now, target)).toBe('지남')
  })
})
