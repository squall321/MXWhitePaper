import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import type {
  AnnotationElement,
  ImageAnnotationBlock,
  Slug,
} from '@/types/document'
import { useImage } from '@/features/upload/hooks/useImage'
import {
  ImageDropzone,
  type ImageDropzoneHandle,
} from '@/features/upload/components/ImageDropzone'
import { useEditorStore } from '../state'
import { patchBlock, isPreconditionFailed } from '../api'
import {
  AnnotationArrowMarker,
  AnnotationElementView,
} from '@/components/blocks/ImageAnnotationBlock'
import { useT } from '@/lib/i18n'

/**
 * `image-annotation` block — edit mode.
 *
 * Layers (top → bottom):
 *   1. Toolbar : tool picker (select/arrow/rect/callout) + color swatches +
 *                undo / redo / clear, plus a "이미지 교체" button that opens
 *                the existing ImageDropzone (reuses uploadImage).
 *   2. Image   : same `<img>` resolved through `useImage(imageId)` —
 *                the dropzone-replace flow swaps it via `imageId` in PATCH.
 *   3. SVG     : viewBox `0 0 1 1`. Pointer events convert client → normalised
 *                coords so persistence is independent of rendered size.
 *
 * Pure helpers exported for unit testing:
 *   - `clientToNorm` : screen → [0..1]
 *   - `pushUndo`     : stack-with-cap helper
 *   - `popUndo`      : undo / redo move
 *
 * Persistence: each commit pushes an undo snapshot, then schedules a
 * debounced PATCH (800 ms after the last edit) — same shape as the
 * whiteboard editor.
 */

interface Props {
  slug: Slug
  block: ImageAnnotationBlock
}

export const IA_TOOLS = ['select', 'arrow', 'rect', 'callout'] as const
export type IAnnotationTool = (typeof IA_TOOLS)[number]

export const IA_COLORS = [
  '#dc2626', // red
  '#ea580c', // orange
  '#ca8a04', // yellow
  '#16a34a', // green
  '#0891b2', // teal
  '#2563eb', // blue
  '#7c3aed', // purple
  '#111827', // black
] as const

const PERSIST_MS = 800
const UNDO_DEPTH = 50

/* ---------- pure helpers (exported for tests) ---------- */

/** Stable-enough id for a fresh annotation element. Not a ULID — just unique
 *  inside the block's array, mirroring how WhiteboardBlockEditor mints ids. */
export function nextAnnotationId(): string {
  return `ann-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`
}

/** Convert a pointer's `(clientX, clientY)` to normalised `[0..1]` against the
 *  rect's `left/top/width/height`. Pure. Out-of-bounds is clamped so a tiny
 *  drag past the image edge doesn't jump to negative coordinates. */
export function clientToNorm(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
): [number, number] {
  if (rect.width <= 0 || rect.height <= 0) return [0, 0]
  const x = (clientX - rect.left) / rect.width
  const y = (clientY - rect.top) / rect.height
  return [Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y))]
}

/** Push a new snapshot onto an undo stack, capped at `UNDO_DEPTH`. Pure —
 *  returns a *new* array. Drops the oldest entry when over the cap. */
export function pushUndo<T>(stack: ReadonlyArray<T>, snap: T, cap = UNDO_DEPTH): T[] {
  const next = [...stack, snap]
  if (next.length > cap) next.shift()
  return next
}

/** Pop one entry off the head of an undo stack. Pure — returns the popped
 *  entry plus the *new* stack. `undefined` when the stack is empty. */
export function popUndo<T>(stack: ReadonlyArray<T>): { value?: T; next: T[] } {
  if (stack.length === 0) return { next: [] }
  const next = stack.slice(0, -1)
  return { value: stack[stack.length - 1], next }
}

/** Build a fresh arrow / rect / callout element at the given anchor. Pure. */
export function buildArrow(
  from: readonly [number, number],
  to: readonly [number, number],
  color: string,
): Extract<AnnotationElement, { kind: 'arrow' }> {
  return {
    kind: 'arrow',
    id: nextAnnotationId(),
    from: { x: from[0], y: from[1] },
    to: { x: to[0], y: to[1] },
    color,
  }
}

export function buildRect(
  start: readonly [number, number],
  end: readonly [number, number],
  color: string,
): Extract<AnnotationElement, { kind: 'rect' }> {
  const x = Math.min(start[0], end[0])
  const y = Math.min(start[1], end[1])
  const w = Math.abs(end[0] - start[0])
  const h = Math.abs(end[1] - start[1])
  return {
    kind: 'rect',
    id: nextAnnotationId(),
    x,
    y,
    w,
    h,
    color,
  }
}

export function buildCallout(
  pos: readonly [number, number],
  text: string,
  color: string,
): Extract<AnnotationElement, { kind: 'callout' }> {
  return {
    kind: 'callout',
    id: nextAnnotationId(),
    x: pos[0],
    y: pos[1],
    label: text,
    color,
  }
}

/** Eraser-style hit-test for the "select" tool. Returns the *last* (top-most)
 *  element whose bounding region contains `(cx, cy)` within `radius`. Pure. */
export function pickElement(
  elements: ReadonlyArray<AnnotationElement>,
  cx: number,
  cy: number,
  radius = 0.02,
): AnnotationElement | null {
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i]!
    if (el.kind === 'rect') {
      if (cx >= el.x - radius && cx <= el.x + el.w + radius && cy >= el.y - radius && cy <= el.y + el.h + radius) {
        return el
      }
      continue
    }
    if (el.kind === 'arrow') {
      // segment hit-test (matches whiteboard's distance-to-segment math)
      const ax = el.from.x
      const ay = el.from.y
      const bx = el.to.x
      const by = el.to.y
      const dx = bx - ax
      const dy = by - ay
      const len2 = dx * dx + dy * dy
      let dist
      if (len2 === 0) {
        dist = Math.hypot(cx - ax, cy - ay)
      } else {
        let t = ((cx - ax) * dx + (cy - ay) * dy) / len2
        t = Math.max(0, Math.min(1, t))
        const px = ax + t * dx
        const py = ay + t * dy
        dist = Math.hypot(cx - px, cy - py)
      }
      if (dist <= radius) return el
      continue
    }
    // callout — bubble bbox roughly label.length * 0.014
    const bw = Math.max(0.08, el.label.length * 0.014)
    const bh = 0.045
    if (cx >= el.x - radius && cx <= el.x + bw + radius && cy >= el.y - radius && cy <= el.y + bh + radius) {
      return el
    }
  }
  return null
}

/* ---------- React component ---------- */

export function ImageAnnotationBlockEditor({ slug, block }: Props) {
  const t = useT()
  const etag = useEditorStore((s) => s.etag)
  const apply = useEditorStore((s) => s.applyServerSnapshot)

  const { data: image } = useImage(block.imageId || undefined)
  const src = image?.urls.view ?? `/api/v1/images/${encodeURIComponent(block.imageId)}`
  const bg = image?.dominant_color ?? '#f3f4f6'

  const [annotations, setAnnotations] = useState<AnnotationElement[]>(block.annotations)
  const [tool, setTool] = useState<IAnnotationTool>('arrow')
  const [color, setColor] = useState<string>(IA_COLORS[0])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [savedOnce, setSavedOnce] = useState(false)

  // Drafting state — while dragging an arrow / rect, we mount a preview
  // element with this synthetic id so it draws in real-time without entering
  // the persisted array.
  const draft = useRef<AnnotationElement | null>(null)
  const startNorm = useRef<[number, number] | null>(null)

  // Inline callout text input — when tool is "callout", a click drops an
  // anchor and shows the input until the user commits / Esc.
  const [calloutPos, setCalloutPos] = useState<[number, number] | null>(null)
  const [calloutText, setCalloutText] = useState('')

  const undoStack = useRef<AnnotationElement[][]>([])
  const redoStack = useRef<AnnotationElement[][]>([])

  const persistTimer = useRef<number | null>(null)
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const dropzoneRef = useRef<ImageDropzoneHandle>(null)

  // Sync from server until the user starts editing locally.
  useEffect(() => {
    if (!savedOnce) setAnnotations(block.annotations)
  }, [block.annotations, savedOnce])

  const persist = useCallback(
    async (next: AnnotationElement[], nextImageId?: string) => {
      if (!etag) return
      try {
        const patch: Partial<ImageAnnotationBlock> = { annotations: next }
        if (nextImageId !== undefined) patch.imageId = nextImageId
        const result = await patchBlock(slug, block.id, patch, etag, t('editor.ia.changeLog'))
        apply(result.document, result.etag)
        setError(null)
        setSavedOnce(true)
      } catch (err) {
        if (isPreconditionFailed(err)) setError(t('editor.common.conflict'))
        else setError((err as Error).message)
      }
    },
    [apply, block.id, etag, slug, t],
  )

  const schedulePersist = useCallback(
    (next: AnnotationElement[]) => {
      if (persistTimer.current) window.clearTimeout(persistTimer.current)
      persistTimer.current = window.setTimeout(() => {
        void persist(next)
      }, PERSIST_MS)
    },
    [persist],
  )

  const commit = useCallback(
    (next: AnnotationElement[]) => {
      undoStack.current = pushUndo(undoStack.current, annotations, UNDO_DEPTH)
      redoStack.current = []
      setAnnotations(next)
      schedulePersist(next)
    },
    [annotations, schedulePersist],
  )

  const onUndo = () => {
    const { value, next } = popUndo(undoStack.current)
    if (!value) return
    redoStack.current = pushUndo(redoStack.current, annotations, UNDO_DEPTH)
    undoStack.current = next
    setAnnotations(value)
    schedulePersist(value)
  }
  const onRedo = () => {
    const { value, next } = popUndo(redoStack.current)
    if (!value) return
    undoStack.current = pushUndo(undoStack.current, annotations, UNDO_DEPTH)
    redoStack.current = next
    setAnnotations(value)
    schedulePersist(value)
  }
  const onClear = () => {
    if (annotations.length === 0) return
    commit([])
  }

  const onDeleteSelected = useCallback(() => {
    if (!selectedId) return
    const next = annotations.filter((a) => a.id !== selectedId)
    if (next.length === annotations.length) return
    setSelectedId(null)
    commit(next)
  }, [annotations, commit, selectedId])

  // Backspace deletes the selected element while focus is inside the editor.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'Backspace' || e.key === 'Delete') && selectedId && wrapperRef.current?.contains(document.activeElement)) {
        e.preventDefault()
        onDeleteSelected()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onDeleteSelected, selectedId])

  const norm = (e: ReactPointerEvent<SVGSVGElement>): [number, number] => {
    const svg = e.currentTarget
    const rect = svg.getBoundingClientRect()
    return clientToNorm(e.clientX, e.clientY, rect)
  }

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (calloutPos) return
    const pos = norm(e)
    e.currentTarget.setPointerCapture(e.pointerId)

    if (tool === 'select') {
      const hit = pickElement(annotations, pos[0], pos[1])
      setSelectedId(hit?.id ?? null)
      return
    }
    if (tool === 'callout') {
      setCalloutPos(pos)
      setCalloutText('')
      return
    }

    startNorm.current = pos
    if (tool === 'arrow') {
      draft.current = buildArrow(pos, pos, color)
    } else {
      draft.current = buildRect(pos, pos, color)
    }
    // re-render to show draft preview
    setAnnotations((cur) => [...cur])
  }

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!draft.current || !startNorm.current) return
    const pos = norm(e)
    if (draft.current.kind === 'arrow') {
      draft.current = buildArrow(startNorm.current, pos, color)
    } else if (draft.current.kind === 'rect') {
      draft.current = buildRect(startNorm.current, pos, color)
    }
    // tickle a state update so the preview <g> re-renders
    setAnnotations((cur) => [...cur])
  }

  const onPointerUp = () => {
    if (draft.current) {
      const next = [...annotations, draft.current]
      draft.current = null
      startNorm.current = null
      commit(next)
    }
  }

  const commitCallout = () => {
    if (!calloutPos) return
    const txt = calloutText.trim()
    if (txt) {
      const el = buildCallout(calloutPos, txt, color)
      commit([...annotations, el])
    }
    setCalloutPos(null)
    setCalloutText('')
  }

  const onReplaceImage = () => dropzoneRef.current?.openFilePicker()

  return (
    <div
      ref={wrapperRef}
      tabIndex={-1}
      className="space-y-2 rounded border border-smsg-100 bg-smsg-100/40 p-3"
      data-image-annotation-editor
      data-block-id={block.id}
    >
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <ToolButton tool={tool} setTool={setTool} value="select" label={t('editor.ia.tool.select')} />
        <ToolButton tool={tool} setTool={setTool} value="arrow" label={t('editor.ia.tool.arrow')} />
        <ToolButton tool={tool} setTool={setTool} value="rect" label={t('editor.ia.tool.rect')} />
        <ToolButton tool={tool} setTool={setTool} value="callout" label={t('editor.ia.tool.callout')} />

        <span className="mx-1 h-5 w-px bg-gray-300" aria-hidden="true" />

        <div className="flex items-center gap-1" role="radiogroup" aria-label={t('editor.ia.colorGroup')}>
          {IA_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={color === c}
              aria-label={t('editor.ia.colorLabel', { color: c })}
              onClick={() => setColor(c)}
              className={`h-5 w-5 rounded-full border ${color === c ? 'border-black ring-2 ring-smsg-400' : 'border-gray-400'}`}
              style={{ background: c }}
            />
          ))}
        </div>

        <span className="mx-1 h-5 w-px bg-gray-300" aria-hidden="true" />

        <button
          type="button"
          onClick={onUndo}
          disabled={undoStack.current.length === 0}
          className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-40"
        >
          {t('editor.ia.undo')}
        </button>
        <button
          type="button"
          onClick={onRedo}
          disabled={redoStack.current.length === 0}
          className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-40"
        >
          {t('editor.ia.redo')}
        </button>
        <button
          type="button"
          onClick={onClear}
          className="rounded-md border border-red-300 bg-white px-2 py-1 text-xs text-red-700 hover:bg-red-50"
        >
          {t('editor.ia.clear')}
        </button>
        <button
          type="button"
          aria-label={t('editor.ia.deleteAria')}
          title={t('editor.ia.deleteTitle')}
          onClick={onDeleteSelected}
          disabled={!selectedId}
          className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-40"
        >
          🗑
        </button>

        <span className="mx-1 h-5 w-px bg-gray-300" aria-hidden="true" />

        <button
          type="button"
          onClick={onReplaceImage}
          className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs hover:bg-gray-50"
        >
          {t('editor.ia.replaceImage')}
        </button>
      </div>

      {error && (
        <p role="status" aria-live="polite" className="text-[11px] text-red-600">
          {error}
        </p>
      )}

      {/* Canvas */}
      <div className="relative overflow-hidden rounded border border-gray-200" style={{ backgroundColor: bg }}>
        <img src={src} alt={block.caption ?? ''} loading="lazy" className="block w-full" />
        <svg
          viewBox="0 0 1 1"
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full touch-none select-none"
          aria-label={t('editor.ia.canvasLabel')}
          data-image-annotation-canvas
          data-tool={tool}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <AnnotationArrowMarker />
          {annotations.map((ann) => (
            <g
              key={ann.id}
              opacity={selectedId === ann.id ? 0.6 : 1}
              data-selected={selectedId === ann.id ? '' : undefined}
            >
              <AnnotationElementView ann={ann} />
            </g>
          ))}
          {/* live draft preview */}
          {draft.current ? <AnnotationElementView ann={draft.current} /> : null}
        </svg>

        {calloutPos && (
          <input
            autoFocus
            type="text"
            aria-label={t('editor.ia.calloutInput')}
            value={calloutText}
            onChange={(e) => setCalloutText(e.target.value)}
            onBlur={commitCallout}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commitCallout()
              } else if (e.key === 'Escape') {
                setCalloutPos(null)
                setCalloutText('')
              }
            }}
            className="absolute rounded border border-smsg-400 bg-white px-1 text-sm shadow"
            style={{
              left: `${calloutPos[0] * 100}%`,
              top: `${calloutPos[1] * 100}%`,
            }}
          />
        )}
      </div>

      {/* Hidden replace dropzone — same UX as ImageBlockEditor's 🔁 button. */}
      <ImageDropzone
        ref={dropzoneRef}
        mode="replace"
        onImageReady={(rec) => {
          void persist(annotations, rec.image_id)
        }}
      />
    </div>
  )
}

/** Tiny tool-toggle button, mirrors WhiteboardBlockEditor's `<ToolButton>`. */
function ToolButton({
  tool,
  setTool,
  value,
  label,
}: {
  tool: IAnnotationTool
  setTool: (t: IAnnotationTool) => void
  value: IAnnotationTool
  label: string
}) {
  const active = tool === value
  return (
    <button
      type="button"
      onClick={() => setTool(value)}
      aria-pressed={active}
      data-ia-tool={value}
      className={`rounded-md border px-2 py-1 text-xs ${
        active
          ? 'border-smsg-500 bg-smsg-50 text-smsg-900'
          : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
      }`}
    >
      {label}
    </button>
  )
}
