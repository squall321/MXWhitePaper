import { describe, it, expect } from 'vitest'
import {
  applyDragDays,
  dragHitZone,
  ganttDragPatch,
  pxToDayDelta,
} from '../ganttDrag'

const DAY_MS = 86400000

describe('dragHitZone', () => {
  it('left 8px → start, right 8px → end, middle → body (wide bar)', () => {
    expect(dragHitZone(0, 100)).toBe('start')
    expect(dragHitZone(8, 100)).toBe('start')
    expect(dragHitZone(8.5, 100)).toBe('body')
    expect(dragHitZone(50, 100)).toBe('body')
    expect(dragHitZone(91.5, 100)).toBe('body')
    expect(dragHitZone(92, 100)).toBe('end')
    expect(dragHitZone(100, 100)).toBe('end')
  })

  it('narrow bar shrinks edges to barW/3 so a body zone survives', () => {
    // barW=12 → edge=4: [0,4]=start, (4,8)=body, [8,12]=end
    expect(dragHitZone(4, 12)).toBe('start')
    expect(dragHitZone(6, 12)).toBe('body')
    expect(dragHitZone(8, 12)).toBe('end')
  })
})

describe('pxToDayDelta', () => {
  // barAreaW 360px / span 36 days → 10px per day (GanttBlockView 와 동일 환산).
  const span = 36 * DAY_MS

  it('converts px to rounded day deltas', () => {
    expect(pxToDayDelta(10, 360, span)).toBe(1)
    expect(pxToDayDelta(14, 360, span)).toBe(1)
    expect(pxToDayDelta(15, 360, span)).toBe(2)
    expect(pxToDayDelta(-30, 360, span)).toBe(-3)
    expect(pxToDayDelta(0, 360, span)).toBe(0)
  })

  it('returns 0 for degenerate inputs', () => {
    expect(pxToDayDelta(10, 0, span)).toBe(0)
    expect(pxToDayDelta(10, 360, 0)).toBe(0)
    expect(pxToDayDelta(NaN, 360, span)).toBe(0)
  })
})

describe('applyDragDays', () => {
  const start = Date.parse('2026-05-01')
  const end = Date.parse('2026-05-05')

  it('body shifts both ends', () => {
    expect(applyDragDays(start, end, 'body', 2)).toEqual({
      startMs: start + 2 * DAY_MS,
      endMs: end + 2 * DAY_MS,
    })
  })

  it('start moves only start, clamped at end', () => {
    expect(applyDragDays(start, end, 'start', -1)).toEqual({
      startMs: start - DAY_MS,
      endMs: end,
    })
    expect(applyDragDays(start, end, 'start', 100)).toEqual({
      startMs: end,
      endMs: end,
    })
  })

  it('end moves only end, clamped at start', () => {
    expect(applyDragDays(start, end, 'end', 3)).toEqual({
      startMs: start,
      endMs: end + 3 * DAY_MS,
    })
    expect(applyDragDays(start, end, 'end', -100)).toEqual({
      startMs: start,
      endMs: start,
    })
  })
})

describe('ganttDragPatch', () => {
  const task = { start: '2026-05-01', end: '2026-05-05' }

  it('body → patches both dates', () => {
    expect(ganttDragPatch(task, 'body', 2)).toEqual({
      start: '2026-05-03',
      end: '2026-05-07',
    })
  })

  it('start → patches start only; end → end only', () => {
    expect(ganttDragPatch(task, 'start', 1)).toEqual({ start: '2026-05-02' })
    expect(ganttDragPatch(task, 'end', -1)).toEqual({ end: '2026-05-04' })
  })

  it('resize clamps so start never passes end', () => {
    expect(ganttDragPatch(task, 'start', 100)).toEqual({ start: '2026-05-05' })
    expect(ganttDragPatch(task, 'end', -100)).toEqual({ end: '2026-05-01' })
  })

  it('returns null for no-ops and invalid dates', () => {
    expect(ganttDragPatch(task, 'body', 0)).toBeNull()
    // start == end 인 bar 의 start 를 오른쪽으로 — 클램프 결과가 원본과 동일.
    expect(ganttDragPatch({ start: '2026-05-05', end: '2026-05-05' }, 'start', 3)).toBeNull()
    expect(ganttDragPatch({ start: 'bad', end: '2026-05-05' }, 'body', 1)).toBeNull()
  })

  it('crosses month boundaries correctly (UTC)', () => {
    expect(ganttDragPatch({ start: '2026-05-30', end: '2026-05-31' }, 'body', 2)).toEqual({
      start: '2026-06-01',
      end: '2026-06-02',
    })
  })
})
