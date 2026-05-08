import type { CropRect } from './cropMath'

/**
 * Canvas-based re-encoders used by the crop and rotate flows. Lifted out of
 * the React components so we can mock them in tests (the test environment
 * has no DOM).
 *
 * Rationale: we re-encode to PNG by default because:
 *   - Lossless re-encode keeps quality stable across multiple edits.
 *   - The BE strips EXIF in either case, so MIME choice is purely about
 *     fidelity.
 */

/** Default re-encode MIME — lossless PNG. */
export const ENCODE_MIME = 'image/png'

/**
 * Read a URL into an `HTMLImageElement` with `crossOrigin='anonymous'` so the
 * canvas isn't tainted (which would block `toBlob`). The BE serves images
 * with permissive CORS for this exact reason.
 */
export function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`이미지를 불러오지 못했습니다: ${src}`))
    img.src = src
  })
}

/**
 * Crop an image element to the provided pixel-rect. Returns a Blob ready for
 * `uploadImage`.
 */
export async function cropImageToBlob(
  img: HTMLImageElement,
  rect: CropRect,
  mime: string = ENCODE_MIME,
): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(rect.w))
  canvas.height = Math.max(1, Math.round(rect.h))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d context unavailable')
  ctx.drawImage(
    img,
    rect.x,
    rect.y,
    rect.w,
    rect.h,
    0,
    0,
    canvas.width,
    canvas.height,
  )
  return canvasToBlob(canvas, mime)
}

/**
 * Rotate an image element by `angle` (must be 0/90/180/270) and return a
 * Blob. 90° / 270° swap width and height of the output canvas.
 */
export async function rotateImageToBlob(
  img: HTMLImageElement,
  angle: 0 | 90 | 180 | 270,
  mime: string = ENCODE_MIME,
): Promise<Blob> {
  const w = img.naturalWidth
  const h = img.naturalHeight
  const swap = angle === 90 || angle === 270
  const canvas = document.createElement('canvas')
  canvas.width = swap ? h : w
  canvas.height = swap ? w : h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d context unavailable')
  ctx.translate(canvas.width / 2, canvas.height / 2)
  ctx.rotate((angle * Math.PI) / 180)
  ctx.drawImage(img, -w / 2, -h / 2)
  return canvasToBlob(canvas, mime)
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) reject(new Error('canvas.toBlob 결과가 비어 있습니다'))
        else resolve(blob)
      },
      mime,
    )
  })
}
