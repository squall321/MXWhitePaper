import { useCallback, useEffect, useRef, useState } from 'react'
import { useGestures } from '@/features/mobile/useGestures'

export interface LightboxItem {
  /** Original-size URL (no thumb). */
  src: string
  alt?: string
  caption?: string
}

/** Zoom bounds for pinch-zoom. Below the lower one we treat as "tap to close". */
export const LIGHTBOX_MIN_ZOOM = 1.0
export const LIGHTBOX_MAX_ZOOM = 4.0
export const LIGHTBOX_DISMISS_ZOOM = 1.05

/** Clamp the live pinch scale into the allowed [1, 4] range. */
export function clampZoom(scale: number): number {
  if (!Number.isFinite(scale)) return LIGHTBOX_MIN_ZOOM
  if (scale < LIGHTBOX_MIN_ZOOM) return LIGHTBOX_MIN_ZOOM
  if (scale > LIGHTBOX_MAX_ZOOM) return LIGHTBOX_MAX_ZOOM
  return scale
}

interface LightboxProps {
  open: boolean
  /** Single-image convenience — equivalent to a 1-element items array. */
  src?: string
  alt?: string
  caption?: string
  /** Multi-image variant — used by GalleryBlockView. */
  items?: LightboxItem[]
  /** Initial index when items[] is supplied. Defaults to 0. */
  startIndex?: number
  onClose: () => void
}

/**
 * Pure index navigation for the lightbox state machine. Extracted so we can
 * unit-test it without a DOM. Wraps around the ends.
 */
export function nextIndex(current: number, length: number, dir: 1 | -1): number {
  if (length <= 0) return 0
  return (current + dir + length) % length
}

/**
 * Fullscreen image overlay. Used by both `<ImageBlockView>` (single image)
 * and `<GalleryBlockView>` (multi-image with prev/next + ←/→ navigation).
 *
 * - Esc closes; click on backdrop closes.
 * - ←/→ navigates within `items[]` (multi only).
 * - Caption shows beneath the active image; alt text overlays top-right.
 */
export function Lightbox({
  open,
  src,
  alt,
  caption,
  items,
  startIndex = 0,
  onClose,
}: LightboxProps) {
  // Normalise the props into a single items[] view.
  const list: LightboxItem[] = items ?? (src ? [{ src, alt, caption }] : [])
  const total = list.length
  const [idx, setIdx] = useState(startIndex)
  // Pinch-zoom state. Reset whenever we navigate or open/close.
  const [zoom, setZoom] = useState(LIGHTBOX_MIN_ZOOM)
  const pinchStartRef = useRef(LIGHTBOX_MIN_ZOOM)
  const stageRef = useRef<HTMLDivElement>(null)

  // Reset index whenever the lightbox reopens.
  useEffect(() => {
    if (open) {
      setIdx(Math.min(startIndex, Math.max(0, total - 1)))
      setZoom(LIGHTBOX_MIN_ZOOM)
    }
  }, [open, startIndex, total])

  const go = useCallback(
    (dir: 1 | -1) => {
      setIdx((i) => nextIndex(i, total, dir))
      setZoom(LIGHTBOX_MIN_ZOOM)
    },
    [total],
  )

  // Pinch-zoom + double-tap. Pinch updates `zoom`; once the user releases at a
  // value < LIGHTBOX_DISMISS_ZOOM we treat it as a "pinch to close" gesture.
  useGestures(stageRef, {
    onPinch: (scale) => {
      const next = clampZoom(pinchStartRef.current * scale)
      setZoom(next)
    },
    onDoubleTap: () => {
      // Double-tap toggles between fit and 2× zoom.
      setZoom((z) => (z > LIGHTBOX_MIN_ZOOM ? LIGHTBOX_MIN_ZOOM : 2))
    },
  })

  // Snapshot the zoom level when a fresh pinch begins (we do this lazily by
  // resetting after each pinch settle).
  useEffect(() => {
    pinchStartRef.current = zoom
  }, [zoom])

  // After the user releases below the dismiss threshold, close the lightbox.
  useEffect(() => {
    if (!open) return
    if (zoom < LIGHTBOX_DISMISS_ZOOM && zoom !== LIGHTBOX_MIN_ZOOM) {
      onClose()
    }
  }, [zoom, open, onClose])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight' && total > 1) {
        e.preventDefault()
        go(1)
      } else if (e.key === 'ArrowLeft' && total > 1) {
        e.preventDefault()
        go(-1)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose, total, go])

  if (!open || total === 0) return null
  const safeIdx = Math.min(idx, total - 1)
  const cur = list[safeIdx]
  if (!cur) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="이미지 확대"
      data-lightbox
      data-index={safeIdx}
      data-total={total}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/85 p-4"
      onClick={onClose}
    >
      <div
        ref={stageRef}
        data-zoom={zoom.toFixed(2)}
        className="relative max-h-[90vh] max-w-[95vw]"
        onClick={(e) => e.stopPropagation()}
        style={{ touchAction: 'none' }}
      >
        <img
          src={cur.src}
          alt={cur.alt ?? cur.caption ?? ''}
          className="max-h-[90vh] max-w-[95vw] rounded shadow-2xl"
          style={{
            transform: `scale(${zoom})`,
            transformOrigin: 'center center',
            transition: 'transform 80ms ease-out',
          }}
        />
        {cur.alt && (
          <span
            data-alt-overlay
            className="absolute right-2 top-2 max-w-[60%] truncate rounded bg-black/60 px-2 py-1 text-xs text-white/90"
          >
            {cur.alt}
          </span>
        )}
        {total > 1 && (
          <>
            <button
              type="button"
              aria-label="이전 이미지"
              data-nav="prev"
              onClick={(e) => {
                e.stopPropagation()
                go(-1)
              }}
              className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 px-3 py-2 text-lg text-white hover:bg-black/80"
            >
              ‹
            </button>
            <button
              type="button"
              aria-label="다음 이미지"
              data-nav="next"
              onClick={(e) => {
                e.stopPropagation()
                go(1)
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 px-3 py-2 text-lg text-white hover:bg-black/80"
            >
              ›
            </button>
          </>
        )}
      </div>
      {cur.caption && (
        <p className="mt-3 max-w-[80vw] text-center text-sm text-white/90">
          {cur.caption}
        </p>
      )}
      {total > 1 && (
        <p className="mt-1 text-xs text-white/60">
          {safeIdx + 1} / {total}
        </p>
      )}
    </div>
  )
}
