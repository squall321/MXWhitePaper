import { describe, it, expect } from 'vitest'
import {
  classifySwipe,
  classifyTap,
  distance,
  pinchScale,
  LONG_PRESS_MS,
  LONG_PRESS_SLOP,
  SWIPE_MIN_RATIO,
  SWIPE_MAX_MS,
  DOUBLE_TAP_MS,
  DOUBLE_TAP_SLOP,
  type DoubleTapState,
} from '../useGestures'

/**
 * Pure-helper tests. The hook itself wires pointer events, but every decision
 * (swipe direction, double-tap acceptance, pinch scale) flows through these
 * helpers — so testing them = testing the hook's behaviour, without needing
 * jsdom/RTL. Same approach as BlockResizeWrapper.
 */

describe('thresholds — sanity bounds for downstream tuning', () => {
  it('long-press is 600ms with 8px slop', () => {
    expect(LONG_PRESS_MS).toBe(600)
    expect(LONG_PRESS_SLOP).toBe(8)
  })

  it('swipe needs 40% of the short axis within 600ms', () => {
    expect(SWIPE_MIN_RATIO).toBe(0.4)
    expect(SWIPE_MAX_MS).toBe(600)
  })

  it('double-tap window is 300ms / 24px', () => {
    expect(DOUBLE_TAP_MS).toBe(300)
    expect(DOUBLE_TAP_SLOP).toBe(24)
  })
})

describe('distance', () => {
  it('returns 0 for the same point', () => {
    expect(distance({ x: 5, y: 5 }, { x: 5, y: 5 })).toBe(0)
  })

  it('matches Pythagoras for a 3-4-5 triangle', () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5)
  })
})

describe('pinchScale', () => {
  it('returns scale ratio when start distance is meaningful', () => {
    expect(pinchScale(100, 200)).toBe(2)
    expect(pinchScale(100, 50)).toBe(0.5)
  })

  it('returns null when start distance is too small', () => {
    expect(pinchScale(0, 100)).toBeNull()
    expect(pinchScale(0.5, 100)).toBeNull()
  })
})

describe('classifySwipe', () => {
  const VW = 400 // viewport short axis used across cases

  it('rejects when total time exceeds SWIPE_MAX_MS', () => {
    expect(
      classifySwipe({ dx: 300, dy: 0, durationMs: SWIPE_MAX_MS + 1, viewportShortPx: VW }),
    ).toBeNull()
  })

  it('rejects when neither axis clears the 40% threshold', () => {
    // 40% of 400 = 160; both below
    expect(classifySwipe({ dx: 100, dy: 100, durationMs: 200, viewportShortPx: VW })).toBeNull()
  })

  it('classifies a fast right swipe', () => {
    // dx > minTravel, |dx| > |dy|, dx > 0 → right
    expect(classifySwipe({ dx: 200, dy: 10, durationMs: 200, viewportShortPx: VW })).toBe(
      'right',
    )
  })

  it('classifies a fast left swipe (negative dx, dominant horizontal)', () => {
    expect(classifySwipe({ dx: -180, dy: 20, durationMs: 200, viewportShortPx: VW })).toBe(
      'left',
    )
  })

  it('classifies a downward swipe when |dy| dominates', () => {
    expect(classifySwipe({ dx: 50, dy: 200, durationMs: 200, viewportShortPx: VW })).toBe(
      'down',
    )
  })

  it('classifies an upward swipe', () => {
    expect(classifySwipe({ dx: 50, dy: -200, durationMs: 200, viewportShortPx: VW })).toBe(
      'up',
    )
  })

  it('respects exact 40% threshold (inclusive)', () => {
    // 0.4 * 400 = 160; dx=160 must qualify
    expect(classifySwipe({ dx: 160, dy: 0, durationMs: 100, viewportShortPx: VW })).toBe(
      'right',
    )
  })
})

describe('classifyTap (double-tap state machine)', () => {
  const empty: DoubleTapState = { lastTapAt: null, lastX: 0, lastY: 0 }

  it('first tap stashes a pending state, no double fires', () => {
    const r = classifyTap(empty, { at: 1000, x: 50, y: 50 })
    expect(r.kind).toBe('first')
    if (r.kind === 'first') {
      expect(r.state.lastTapAt).toBe(1000)
      expect(r.state.lastX).toBe(50)
    }
  })

  it('second tap within 300ms and 24px → double', () => {
    const after = classifyTap(
      { lastTapAt: 1000, lastX: 50, lastY: 50 },
      { at: 1200, x: 60, y: 55 },
    )
    expect(after.kind).toBe('double')
    if (after.kind === 'double') {
      expect(after.point).toEqual({ x: 60, y: 55 })
    }
  })

  it('second tap too late (>300ms) → re-stashes as a new first tap', () => {
    const after = classifyTap(
      { lastTapAt: 1000, lastX: 50, lastY: 50 },
      { at: 1500, x: 50, y: 50 },
    )
    expect(after.kind).toBe('first')
  })

  it('second tap too far (>24px) → re-stashes', () => {
    const after = classifyTap(
      { lastTapAt: 1000, lastX: 50, lastY: 50 },
      { at: 1100, x: 100, y: 100 },
    )
    expect(after.kind).toBe('first')
  })

  it('exact 300ms boundary still counts as a double-tap', () => {
    const after = classifyTap(
      { lastTapAt: 1000, lastX: 50, lastY: 50 },
      { at: 1000 + DOUBLE_TAP_MS, x: 50, y: 50 },
    )
    expect(after.kind).toBe('double')
  })
})
