import { describe, it, expect } from 'vitest'
import {
  rotateAnnotation,
  rotateAnnotations,
  rotatePoint,
  type RotateAngle,
} from '../annotationRotate'
import type { AnnotationElement } from '@/types/document'

const ANGLES: RotateAngle[] = [0, 90, 180, 270]

const close = (a: number, b: number, eps = 1e-9) =>
  Math.abs(a - b) < eps

describe('rotatePoint', () => {
  it('0° is identity', () => {
    expect(rotatePoint(0.2, 0.3, 0)).toEqual([0.2, 0.3])
  })
  it('90° CW maps (x, y) → (1-y, x)', () => {
    expect(rotatePoint(0.2, 0.3, 90)).toEqual([0.7, 0.2])
  })
  it('180° maps (x, y) → (1-x, 1-y)', () => {
    expect(rotatePoint(0.2, 0.3, 180)).toEqual([0.8, 0.7])
  })
  it('270° CW maps (x, y) → (y, 1-x)', () => {
    expect(rotatePoint(0.2, 0.3, 270)).toEqual([0.3, 0.8])
  })
  it('four 90° rotations return to the original point', () => {
    const start: [number, number] = [0.17, 0.42]
    let p: [number, number] = start
    for (let i = 0; i < 4; i++) p = rotatePoint(p[0], p[1], 90)
    expect(close(p[0], start[0])).toBe(true)
    expect(close(p[1], start[1])).toBe(true)
  })
})

describe('rotateAnnotation — arrow', () => {
  const ar: AnnotationElement = {
    kind: 'arrow',
    id: 'ar1',
    from: { x: 0.1, y: 0.2 },
    to: { x: 0.6, y: 0.8 },
    color: '#000',
  }

  it('0° leaves coords untouched', () => {
    const out = rotateAnnotation(ar, 0)
    if (out.kind !== 'arrow') throw new Error('kind')
    expect(out.from).toEqual({ x: 0.1, y: 0.2 })
    expect(out.to).toEqual({ x: 0.6, y: 0.8 })
  })
  it('90° rotates both endpoints', () => {
    const out = rotateAnnotation(ar, 90)
    if (out.kind !== 'arrow') throw new Error('kind')
    // (0.1, 0.2) → (1-0.2, 0.1) = (0.8, 0.1)
    expect(out.from.x).toBeCloseTo(0.8, 9)
    expect(out.from.y).toBeCloseTo(0.1, 9)
    // (0.6, 0.8) → (0.2, 0.6)
    expect(out.to.x).toBeCloseTo(0.2, 9)
    expect(out.to.y).toBeCloseTo(0.6, 9)
  })
  it('180° flips both endpoints', () => {
    const out = rotateAnnotation(ar, 180)
    if (out.kind !== 'arrow') throw new Error('kind')
    expect(out.from.x).toBeCloseTo(0.9, 9)
    expect(out.from.y).toBeCloseTo(0.8, 9)
    expect(out.to.x).toBeCloseTo(0.4, 9)
    expect(out.to.y).toBeCloseTo(0.2, 9)
  })
  it('270° rotates both endpoints', () => {
    const out = rotateAnnotation(ar, 270)
    if (out.kind !== 'arrow') throw new Error('kind')
    expect(out.from.x).toBeCloseTo(0.2, 9)
    expect(out.from.y).toBeCloseTo(0.9, 9)
    expect(out.to.x).toBeCloseTo(0.8, 9)
    expect(out.to.y).toBeCloseTo(0.4, 9)
  })
})

describe('rotateAnnotation — rect', () => {
  const rect: AnnotationElement = {
    kind: 'rect',
    id: 're1',
    x: 0.1,
    y: 0.2,
    w: 0.3,
    h: 0.4,
    color: '#000',
  }

  it('0° is identity', () => {
    const out = rotateAnnotation(rect, 0)
    if (out.kind !== 'rect') throw new Error('kind')
    expect(out.x).toBe(0.1)
    expect(out.y).toBe(0.2)
    expect(out.w).toBe(0.3)
    expect(out.h).toBe(0.4)
  })
  it('90° swaps w/h and re-anchors top-left', () => {
    const out = rotateAnnotation(rect, 90)
    if (out.kind !== 'rect') throw new Error('kind')
    // (0.1, 0.2) → (0.8, 0.1); (0.4, 0.6) → (0.4, 0.4)
    // new tl = (min(0.8, 0.4), min(0.1, 0.4)) = (0.4, 0.1)
    expect(out.x).toBeCloseTo(0.4, 9)
    expect(out.y).toBeCloseTo(0.1, 9)
    expect(out.w).toBeCloseTo(0.4, 9)
    expect(out.h).toBeCloseTo(0.3, 9)
  })
  it('180° preserves w/h and re-anchors top-left', () => {
    const out = rotateAnnotation(rect, 180)
    if (out.kind !== 'rect') throw new Error('kind')
    expect(out.x).toBeCloseTo(0.6, 9)
    expect(out.y).toBeCloseTo(0.4, 9)
    expect(out.w).toBeCloseTo(0.3, 9)
    expect(out.h).toBeCloseTo(0.4, 9)
  })
  it('270° swaps w/h and re-anchors top-left', () => {
    const out = rotateAnnotation(rect, 270)
    if (out.kind !== 'rect') throw new Error('kind')
    // (0.1, 0.2) → (0.2, 0.9); (0.4, 0.6) → (0.6, 0.6)
    // new tl = (0.2, 0.6)
    expect(out.x).toBeCloseTo(0.2, 9)
    expect(out.y).toBeCloseTo(0.6, 9)
    expect(out.w).toBeCloseTo(0.4, 9)
    expect(out.h).toBeCloseTo(0.3, 9)
  })
  it('four 90° rotations return to the original rect', () => {
    let r: AnnotationElement = rect
    for (let i = 0; i < 4; i++) r = rotateAnnotation(r, 90)
    if (r.kind !== 'rect') throw new Error('kind')
    expect(r.x).toBeCloseTo(rect.x, 9)
    expect(r.y).toBeCloseTo(rect.y, 9)
    expect(r.w).toBeCloseTo(rect.w, 9)
    expect(r.h).toBeCloseTo(rect.h, 9)
  })
})

describe('rotateAnnotation — callout', () => {
  const callout: AnnotationElement = {
    kind: 'callout',
    id: 'cl1',
    x: 0.3,
    y: 0.4,
    label: 'hi',
    color: '#000',
  }

  it('0° is identity', () => {
    const out = rotateAnnotation(callout, 0)
    if (out.kind !== 'callout') throw new Error('kind')
    expect(out.x).toBe(0.3)
    expect(out.y).toBe(0.4)
  })
  it('90° rotates anchor position', () => {
    const out = rotateAnnotation(callout, 90)
    if (out.kind !== 'callout') throw new Error('kind')
    expect(out.x).toBeCloseTo(0.6, 9)
    expect(out.y).toBeCloseTo(0.3, 9)
    expect(out.label).toBe('hi')
    expect(out.anchor).toBeUndefined()
  })
  it('180° rotates anchor position', () => {
    const out = rotateAnnotation(callout, 180)
    if (out.kind !== 'callout') throw new Error('kind')
    expect(out.x).toBeCloseTo(0.7, 9)
    expect(out.y).toBeCloseTo(0.6, 9)
  })
  it('270° rotates anchor position', () => {
    const out = rotateAnnotation(callout, 270)
    if (out.kind !== 'callout') throw new Error('kind')
    expect(out.x).toBeCloseTo(0.4, 9)
    expect(out.y).toBeCloseTo(0.7, 9)
  })

  it('rotates `anchor` when present', () => {
    const withAnchor: AnnotationElement = {
      ...callout,
      anchor: { x: 0.5, y: 0.6 },
    }
    const out = rotateAnnotation(withAnchor, 90)
    if (out.kind !== 'callout') throw new Error('kind')
    expect(out.anchor?.x).toBeCloseTo(0.4, 9)
    expect(out.anchor?.y).toBeCloseTo(0.5, 9)
  })
})

describe('rotateAnnotation — textbox', () => {
  const tb: AnnotationElement = {
    kind: 'textbox',
    id: 'tb1',
    x: 0.2,
    y: 0.2,
    w: 0.3,
    h: 0.1,
    text: '본문\n두 줄',
    color: '#000',
  }

  it('0° is identity', () => {
    const out = rotateAnnotation(tb, 0)
    if (out.kind !== 'textbox') throw new Error('kind')
    expect(out.x).toBe(0.2)
    expect(out.y).toBe(0.2)
    expect(out.w).toBe(0.3)
    expect(out.h).toBe(0.1)
    expect(out.text).toBe('본문\n두 줄')
  })
  it('90° swaps w/h and preserves text', () => {
    const out = rotateAnnotation(tb, 90)
    if (out.kind !== 'textbox') throw new Error('kind')
    // (0.2, 0.2) → (0.8, 0.2); (0.5, 0.3) → (0.7, 0.5)
    expect(out.x).toBeCloseTo(0.7, 9)
    expect(out.y).toBeCloseTo(0.2, 9)
    expect(out.w).toBeCloseTo(0.1, 9)
    expect(out.h).toBeCloseTo(0.3, 9)
    expect(out.text).toBe('본문\n두 줄')
  })
  it('180° preserves w/h', () => {
    const out = rotateAnnotation(tb, 180)
    if (out.kind !== 'textbox') throw new Error('kind')
    expect(out.x).toBeCloseTo(0.5, 9)
    expect(out.y).toBeCloseTo(0.7, 9)
    expect(out.w).toBeCloseTo(0.3, 9)
    expect(out.h).toBeCloseTo(0.1, 9)
  })
  it('270° swaps w/h', () => {
    const out = rotateAnnotation(tb, 270)
    if (out.kind !== 'textbox') throw new Error('kind')
    // (0.2, 0.2) → (0.2, 0.8); (0.5, 0.3) → (0.3, 0.5)
    expect(out.x).toBeCloseTo(0.2, 9)
    expect(out.y).toBeCloseTo(0.5, 9)
    expect(out.w).toBeCloseTo(0.1, 9)
    expect(out.h).toBeCloseTo(0.3, 9)
  })
})

describe('rotateAnnotations (list)', () => {
  const sample: AnnotationElement[] = [
    {
      kind: 'arrow',
      id: 'ar1',
      from: { x: 0.1, y: 0.1 },
      to: { x: 0.5, y: 0.5 },
      color: '#000',
    },
    { kind: 'rect', id: 're1', x: 0.2, y: 0.2, w: 0.3, h: 0.1, color: '#000' },
    { kind: 'callout', id: 'cl1', x: 0.6, y: 0.7, label: 'hi', color: '#000' },
    {
      kind: 'textbox',
      id: 'tb1',
      x: 0.1,
      y: 0.5,
      w: 0.2,
      h: 0.2,
      text: 'x',
      color: '#000',
    },
  ]

  it('returns a NEW array (does not mutate input) for every angle', () => {
    for (const angle of ANGLES) {
      const out = rotateAnnotations(sample, angle)
      expect(out).not.toBe(sample)
      expect(out.length).toBe(sample.length)
    }
  })

  it('0° preserves identity values', () => {
    const out = rotateAnnotations(sample, 0)
    for (let i = 0; i < sample.length; i++) {
      expect(out[i]).toEqual(sample[i])
    }
  })

  it('four 90° rotations restore every element', () => {
    let cur = sample
    for (let i = 0; i < 4; i++) cur = rotateAnnotations(cur, 90)
    for (let i = 0; i < sample.length; i++) {
      const a = sample[i]!
      const b = cur[i]!
      // Loose JSON equality with tolerance on coords.
      expect(b.kind).toBe(a.kind)
      expect(b.id).toBe(a.id)
      if (a.kind === 'arrow' && b.kind === 'arrow') {
        expect(b.from.x).toBeCloseTo(a.from.x, 9)
        expect(b.from.y).toBeCloseTo(a.from.y, 9)
        expect(b.to.x).toBeCloseTo(a.to.x, 9)
        expect(b.to.y).toBeCloseTo(a.to.y, 9)
      }
      if (a.kind === 'rect' && b.kind === 'rect') {
        expect(b.x).toBeCloseTo(a.x, 9)
        expect(b.y).toBeCloseTo(a.y, 9)
        expect(b.w).toBeCloseTo(a.w, 9)
        expect(b.h).toBeCloseTo(a.h, 9)
      }
      if (a.kind === 'callout' && b.kind === 'callout') {
        expect(b.x).toBeCloseTo(a.x, 9)
        expect(b.y).toBeCloseTo(a.y, 9)
      }
      if (a.kind === 'textbox' && b.kind === 'textbox') {
        expect(b.x).toBeCloseTo(a.x, 9)
        expect(b.y).toBeCloseTo(a.y, 9)
        expect(b.w).toBeCloseTo(a.w, 9)
        expect(b.h).toBeCloseTo(a.h, 9)
      }
    }
  })
})
