/**
 * Rotate every annotation in an ImageAnnotationBlock by 0 / 90 / 180 / 270
 * degrees clockwise. Coords are normalized [0..1] against the image viewport,
 * so the transform is image-size-independent.
 *
 * Transform (CW) on a normalized point (x, y):
 *   0°   : (x, y)
 *   90°  : (1 - y, x)
 *   180° : (1 - x, 1 - y)
 *   270° : (y, 1 - x)
 *
 * For width/height: 90° / 270° swap them. We re-anchor `rect` / `textbox`
 * elements to their new top-left after rotation so the on-screen body is
 * preserved.
 *
 * Pure — no DOM, easy to unit-test.
 */
import type { AnnotationElement } from '@/types/document'

export type RotateAngle = 0 | 90 | 180 | 270

/** Rotate a single normalized point (x, y) clockwise by `angle`. */
export function rotatePoint(
  x: number,
  y: number,
  angle: RotateAngle,
): [number, number] {
  switch (angle) {
    case 90:
      return [1 - y, x]
    case 180:
      return [1 - x, 1 - y]
    case 270:
      return [y, 1 - x]
    default:
      return [x, y]
  }
}

/**
 * Rotate one annotation element. `rect` / `textbox` keep their on-screen body
 * by rotating their two opposite corners and re-deriving (x, y, w, h).
 */
export function rotateAnnotation(
  el: AnnotationElement,
  angle: RotateAngle,
): AnnotationElement {
  if (angle === 0) return el
  if (el.kind === 'arrow') {
    const [fx, fy] = rotatePoint(el.from.x, el.from.y, angle)
    const [tx, ty] = rotatePoint(el.to.x, el.to.y, angle)
    return { ...el, from: { x: fx, y: fy }, to: { x: tx, y: ty } }
  }
  if (el.kind === 'rect') {
    const [ax, ay] = rotatePoint(el.x, el.y, angle)
    const [bx, by] = rotatePoint(el.x + el.w, el.y + el.h, angle)
    return {
      ...el,
      x: Math.min(ax, bx),
      y: Math.min(ay, by),
      w: Math.abs(bx - ax),
      h: Math.abs(by - ay),
    }
  }
  if (el.kind === 'textbox') {
    const [ax, ay] = rotatePoint(el.x, el.y, angle)
    const [bx, by] = rotatePoint(el.x + el.w, el.y + el.h, angle)
    return {
      ...el,
      x: Math.min(ax, bx),
      y: Math.min(ay, by),
      w: Math.abs(bx - ax),
      h: Math.abs(by - ay),
    }
  }
  // callout — anchor 도 같이 회전 (있을 때).
  const [cx, cy] = rotatePoint(el.x, el.y, angle)
  const next: AnnotationElement = { ...el, x: cx, y: cy }
  if (el.anchor) {
    const [ax, ay] = rotatePoint(el.anchor.x, el.anchor.y, angle)
    return { ...next, anchor: { x: ax, y: ay } } as AnnotationElement
  }
  return next
}

/** Rotate every annotation in the given list. Pure — returns a new array. */
export function rotateAnnotations(
  annotations: ReadonlyArray<AnnotationElement>,
  angle: RotateAngle,
): AnnotationElement[] {
  if (angle === 0) return annotations.slice()
  return annotations.map((a) => rotateAnnotation(a, angle))
}
