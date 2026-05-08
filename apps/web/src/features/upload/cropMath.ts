/**
 * Pure helpers for the crop overlay. Kept separate from the React component
 * so the math can be unit-tested without DOM / canvas.
 */

export interface CropRect {
  /** Top-left X in image pixel coords. */
  x: number
  /** Top-left Y in image pixel coords. */
  y: number
  /** Width in image pixels. Always > 0. */
  w: number
  /** Height in image pixels. Always > 0. */
  h: number
}

/** Discrete handle indices the overlay drags. */
export type HandleId = 'nw' | 'ne' | 'sw' | 'se'

/**
 * Clamp a CropRect inside the image bounds and enforce a minimum size.
 * Negative widths/heights collapse to the minimum.
 */
export function clampRect(
  rect: CropRect,
  imgW: number,
  imgH: number,
  min = 16,
): CropRect {
  const w = Math.max(min, Math.min(rect.w, imgW))
  const h = Math.max(min, Math.min(rect.h, imgH))
  const x = Math.max(0, Math.min(rect.x, imgW - w))
  const y = Math.max(0, Math.min(rect.y, imgH - h))
  return { x, y, w, h }
}

/**
 * Apply a corner-handle drag delta. We keep the OPPOSITE corner pinned and
 * move only the dragged corner — the rect can flip across the pin, so we
 * normalise back to {x,y,w,h>0} at the end.
 */
export function applyHandleDrag(
  rect: CropRect,
  handle: HandleId,
  dx: number,
  dy: number,
  imgW: number,
  imgH: number,
  min = 16,
): CropRect {
  let x1 = rect.x
  let y1 = rect.y
  let x2 = rect.x + rect.w
  let y2 = rect.y + rect.h
  if (handle === 'nw') {
    x1 += dx
    y1 += dy
  } else if (handle === 'ne') {
    x2 += dx
    y1 += dy
  } else if (handle === 'sw') {
    x1 += dx
    y2 += dy
  } else {
    x2 += dx
    y2 += dy
  }
  const nx = Math.min(x1, x2)
  const ny = Math.min(y1, y2)
  const nw = Math.max(min, Math.abs(x2 - x1))
  const nh = Math.max(min, Math.abs(y2 - y1))
  return clampRect({ x: nx, y: ny, w: nw, h: nh }, imgW, imgH, min)
}

/**
 * Translate a rect by (dx, dy), clamped to the image. Used when the user
 * drags the rect body itself rather than a corner handle.
 */
export function moveRect(
  rect: CropRect,
  dx: number,
  dy: number,
  imgW: number,
  imgH: number,
): CropRect {
  return clampRect({ ...rect, x: rect.x + dx, y: rect.y + dy }, imgW, imgH)
}

/**
 * Convert a normalized 0..1 rect (the overlay records drags in CSS-pixel
 * space) to an image-pixel rect. Both inputs use the same coordinate origin.
 */
export function denormaliseRect(
  norm: CropRect,
  imgW: number,
  imgH: number,
): CropRect {
  return clampRect(
    {
      x: Math.round(norm.x * imgW),
      y: Math.round(norm.y * imgH),
      w: Math.round(norm.w * imgW),
      h: Math.round(norm.h * imgH),
    },
    imgW,
    imgH,
  )
}

/**
 * Bumps a rotation angle by 90° steps, kept in the canonical [0, 90, 180, 270]
 * set. Negative steps rotate counter-clockwise.
 */
export function rotate90(angle: number, steps = 1): 0 | 90 | 180 | 270 {
  const norm = (((angle + steps * 90) % 360) + 360) % 360
  return norm as 0 | 90 | 180 | 270
}
