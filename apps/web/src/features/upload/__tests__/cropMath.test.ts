import { describe, it, expect } from 'vitest'
import {
  applyHandleDrag,
  clampRect,
  denormaliseRect,
  moveRect,
  rotate90,
} from '../cropMath'

describe('clampRect', () => {
  it('keeps a rect inside the image box', () => {
    const r = clampRect({ x: -50, y: -50, w: 200, h: 100 }, 100, 80)
    expect(r.x).toBeGreaterThanOrEqual(0)
    expect(r.y).toBeGreaterThanOrEqual(0)
    expect(r.x + r.w).toBeLessThanOrEqual(100)
    expect(r.y + r.h).toBeLessThanOrEqual(80)
  })
  it('enforces a minimum size', () => {
    const r = clampRect({ x: 0, y: 0, w: 1, h: 1 }, 200, 200, 16)
    expect(r.w).toBe(16)
    expect(r.h).toBe(16)
  })
})

describe('applyHandleDrag', () => {
  it('moves the top-left corner with NW handle', () => {
    const r0 = { x: 10, y: 10, w: 80, h: 80 }
    const r = applyHandleDrag(r0, 'nw', 5, 5, 100, 100)
    expect(r.x).toBe(15)
    expect(r.y).toBe(15)
    expect(r.w).toBe(75)
    expect(r.h).toBe(75)
  })
  it('moves the bottom-right corner with SE handle', () => {
    const r0 = { x: 10, y: 10, w: 50, h: 50 }
    const r = applyHandleDrag(r0, 'se', 10, 10, 200, 200)
    expect(r.w).toBe(60)
    expect(r.h).toBe(60)
    expect(r.x).toBe(10)
    expect(r.y).toBe(10)
  })
  it('flips when dragged past the opposite corner', () => {
    const r0 = { x: 10, y: 10, w: 50, h: 50 }
    // drag NW 100px right/down — past the SE corner.
    const r = applyHandleDrag(r0, 'nw', 100, 100, 500, 500)
    expect(r.w).toBeGreaterThanOrEqual(16)
    expect(r.h).toBeGreaterThanOrEqual(16)
    expect(r.x).toBeGreaterThanOrEqual(0)
    expect(r.y).toBeGreaterThanOrEqual(0)
  })
})

describe('moveRect', () => {
  it('translates and clamps to image bounds', () => {
    const r0 = { x: 0, y: 0, w: 50, h: 50 }
    const r = moveRect(r0, -100, -100, 100, 100)
    expect(r.x).toBe(0)
    expect(r.y).toBe(0)
  })
  it('clamps when moved past the right edge', () => {
    const r0 = { x: 50, y: 50, w: 30, h: 30 }
    const r = moveRect(r0, 200, 200, 100, 100)
    expect(r.x).toBe(70)
    expect(r.y).toBe(70)
  })
})

describe('denormaliseRect', () => {
  it('converts 0..1 normalized coords to pixel coords', () => {
    const r = denormaliseRect({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, 1000, 500)
    expect(r.x).toBe(100)
    expect(r.y).toBe(50)
    expect(r.w).toBe(800)
    expect(r.h).toBe(400)
  })
})

describe('rotate90', () => {
  it('cycles through 0/90/180/270', () => {
    expect(rotate90(0, 1)).toBe(90)
    expect(rotate90(90, 1)).toBe(180)
    expect(rotate90(180, 1)).toBe(270)
    expect(rotate90(270, 1)).toBe(0)
  })
  it('handles negative steps', () => {
    expect(rotate90(0, -1)).toBe(270)
  })
})
