import { useCallback, useEffect, useRef, useState } from 'react'
import {
  applyHandleDrag,
  clampRect,
  denormaliseRect,
  moveRect,
  type CropRect,
  type HandleId,
} from './cropMath'
import { cropImageToBlob, loadImageElement } from './canvasEncode'

interface CropOverlayProps {
  /** URL of the image to crop. */
  src: string
  /** Called with the re-encoded Blob when the user clicks 적용. */
  onApply: (blob: Blob) => void | Promise<void>
  /** Called when the user dismisses the overlay. */
  onCancel: () => void
}

const HANDLES: HandleId[] = ['nw', 'ne', 'sw', 'se']

/**
 * Modal-style inline crop overlay for ImageBlockEditor. Loads the original
 * URL into an off-DOM `<img>` to read its natural pixel size, then renders a
 * box with four corner handles. Dragging a handle resizes the rect; dragging
 * the body translates it. On 적용 we crop via canvas and emit the Blob.
 *
 * The rect is stored in IMAGE-pixel coordinates (not CSS pixels) so it is
 * resolution-independent — the on-screen overlay scales the rect when
 * rendering.
 */
export function CropOverlay({ src, onApply, onCancel }: CropOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [rect, setRect] = useState<CropRect | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load image and seed the rect to a centered 80% box.
  useEffect(() => {
    let cancelled = false
    loadImageElement(src)
      .then((el) => {
        if (cancelled) return
        setImg(el)
        const margin = 0.1
        setRect(
          denormaliseRect(
            { x: margin, y: margin, w: 1 - margin * 2, h: 1 - margin * 2 },
            el.naturalWidth,
            el.naturalHeight,
          ),
        )
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message)
      })
    return () => {
      cancelled = true
    }
  }, [src])

  // Esc closes overlay.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onCancel])

  // Drag state — kept in refs to avoid render storms.
  const dragRef = useRef<{
    mode: HandleId | 'move'
    startX: number
    startY: number
    rect0: CropRect
    scale: number
  } | null>(null)

  const onPointerDown = useCallback(
    (mode: HandleId | 'move') => (e: React.PointerEvent) => {
      if (!img || !rect || !containerRef.current) return
      e.preventDefault()
      e.stopPropagation()
      const target = e.currentTarget as HTMLElement
      target.setPointerCapture(e.pointerId)
      const containerW = containerRef.current.clientWidth
      const scale = containerW / img.naturalWidth
      dragRef.current = {
        mode,
        startX: e.clientX,
        startY: e.clientY,
        rect0: rect,
        scale,
      }
    },
    [img, rect],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current
      if (!drag || !img) return
      const dx = (e.clientX - drag.startX) / drag.scale
      const dy = (e.clientY - drag.startY) / drag.scale
      if (drag.mode === 'move') {
        setRect(moveRect(drag.rect0, dx, dy, img.naturalWidth, img.naturalHeight))
      } else {
        setRect(
          applyHandleDrag(
            drag.rect0,
            drag.mode,
            dx,
            dy,
            img.naturalWidth,
            img.naturalHeight,
          ),
        )
      }
    },
    [img],
  )

  const onPointerUp = useCallback(() => {
    dragRef.current = null
  }, [])

  const onApplyClick = async () => {
    if (!img || !rect) return
    setBusy(true)
    setError(null)
    try {
      const safe = clampRect(rect, img.naturalWidth, img.naturalHeight)
      const blob = await cropImageToBlob(img, safe)
      await onApply(blob)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // Convert image-pixel rect → CSS-pixel overlay rect.
  let overlayStyle: React.CSSProperties | undefined
  if (img && rect && containerRef.current) {
    const cw = containerRef.current.clientWidth
    const scale = cw / img.naturalWidth
    overlayStyle = {
      left: rect.x * scale,
      top: rect.y * scale,
      width: rect.w * scale,
      height: rect.h * scale,
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="이미지 자르기"
      data-crop-overlay
      className="fixed inset-0 z-modal flex flex-col items-center justify-center bg-black/85 p-4"
      onClick={onCancel}
    >
      <div
        className="relative max-h-[80vh] max-w-[90vw] overflow-hidden rounded shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div ref={containerRef} className="relative inline-block select-none">
          {img && (
            <img
              src={src}
              alt=""
              draggable={false}
              className="block max-h-[80vh] max-w-[90vw]"
            />
          )}
          {overlayStyle && (
            <div
              data-crop-rect
              role="region"
              aria-label="자르기 영역"
              className="absolute cursor-move border-2 border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]"
              style={overlayStyle}
              onPointerDown={onPointerDown('move')}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
            >
              {HANDLES.map((h) => (
                <span
                  key={h}
                  data-handle={h}
                  role="button"
                  aria-label={`자르기 핸들 ${h}`}
                  onPointerDown={onPointerDown(h)}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  className={
                    'absolute h-3 w-3 cursor-pointer border border-white bg-smsg-500' +
                    (h === 'nw'
                      ? ' -left-1.5 -top-1.5'
                      : h === 'ne'
                        ? ' -right-1.5 -top-1.5'
                        : h === 'sw'
                          ? ' -bottom-1.5 -left-1.5'
                          : ' -bottom-1.5 -right-1.5')
                  }
                />
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        {error && (
          <span className="rounded bg-red-100 px-2 py-1 text-xs text-red-700">
            {error}
          </span>
        )}
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded border border-white/40 bg-transparent px-3 py-1 text-xs text-white hover:bg-white/10"
        >
          취소
        </button>
        <button
          type="button"
          onClick={() => void onApplyClick()}
          disabled={busy || !img || !rect}
          className="rounded bg-smsg-500 px-3 py-1 text-xs font-semibold text-white hover:bg-smsg-700 disabled:opacity-60"
        >
          {busy ? '적용 중…' : '적용'}
        </button>
      </div>
    </div>
  )
}
