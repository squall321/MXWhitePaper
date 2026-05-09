import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import type {
  Slug,
  WhiteboardBlock,
  WhiteboardElement,
} from '@/types/document'
import { useEditorStore } from '@/features/editor/state'
import { patchBlock, isPreconditionFailed } from '@/features/editor/api'
import { WhiteboardElementsLayer } from '@/components/blocks/WhiteboardBlock'

/**
 * In-house whiteboard editor — pen / shapes / text / eraser, persisted as
 * pure-JSON `WhiteboardElement[]` per the schema. No excalidraw, no fabric,
 * no playwright — every interaction is a small DOM pointer-event loop on a
 * single SVG canvas.
 *
 * Architecture:
 *   1. Local `elements` state is the editable working copy.
 *   2. Tool / color / width are local UI state (not persisted on the block).
 *   3. Undo / redo: snapshot stack of `elements` arrays (max depth 50).
 *   4. PATCH /blocks/:id is debounced 800ms after the last edit.
 *
 * Pure helpers are exported for unit testing (build/eraser/shape commit).
 */

interface Props {
  slug: Slug
  block: WhiteboardBlock
}

export const WB_TOOLS = ['pen', 'eraser', 'rect', 'ellipse', 'line', 'arrow', 'text'] as const
export type WhiteboardTool = (typeof WB_TOOLS)[number]

export const WB_COLORS = ['#111827', '#dc2626', '#2563eb', '#16a34a', '#ca8a04', '#ffffff'] as const
export const WB_WIDTHS = [1, 2, 4, 8] as const

const PERSIST_MS = 800
const ERASER_RADIUS = 8 // px (in viewbox units)
const UNDO_DEPTH = 50

/* ---------- pure helpers (exported for tests) ---------- */

/** Generate a stable unique id for a new element. Not a ULID — just unique
 *  within the block's element array. */
export function nextElementId(): string {
  return `wbe-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`
}

/** Distance from a point to a line segment (for the eraser hit-test). */
export function distancePointToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(px - ax, py - ay)
  let t = ((px - ax) * dx + (py - ay) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  const cx = ax + t * dx
  const cy = ay + t * dy
  return Math.hypot(px - cx, py - cy)
}

/** True when the cursor (cx,cy) intersects any segment of `points` within `radius`. */
export function strokeIntersects(
  points: ReadonlyArray<readonly [number, number]>,
  cx: number,
  cy: number,
  radius: number,
): boolean {
  if (points.length === 0) return false
  if (points.length === 1) {
    const p = points[0]!
    return Math.hypot(cx - p[0], cy - p[1]) <= radius
  }
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!
    const b = points[i]!
    if (distancePointToSegment(cx, cy, a[0], a[1], b[0], b[1]) <= radius) return true
  }
  return false
}

/** Hit-test for shape elements. Approximates each shape by its bounding-box
 *  margin: cursor inside (or within `radius`) the shape's rect counts as a hit.
 *  Good enough for the eraser — we don't need pixel-perfect precision. */
export function shapeIntersects(
  el: Extract<WhiteboardElement, { kind: 'shape' }>,
  cx: number,
  cy: number,
  radius: number,
): boolean {
  const x1 = Math.min(el.x, el.x + el.w)
  const y1 = Math.min(el.y, el.y + el.h)
  const x2 = Math.max(el.x, el.x + el.w)
  const y2 = Math.max(el.y, el.y + el.h)
  if (el.shape === 'line' || el.shape === 'arrow') {
    return distancePointToSegment(cx, cy, el.x, el.y, el.x + el.w, el.y + el.h) <= radius
  }
  return cx >= x1 - radius && cx <= x2 + radius && cy >= y1 - radius && cy <= y2 + radius
}

/** Hit-test for text elements — bounding box approximated by `text.length × fontSize`. */
export function textIntersects(
  el: Extract<WhiteboardElement, { kind: 'text' }>,
  cx: number,
  cy: number,
  radius: number,
): boolean {
  const w = Math.max(8, el.text.length * el.fontSize * 0.55)
  const h = el.fontSize
  return cx >= el.x - radius && cx <= el.x + w + radius && cy >= el.y - radius && cy <= el.y + h + radius
}

/** Element-level eraser hit-test: dispatches per `kind`. */
export function elementIntersects(
  el: WhiteboardElement,
  cx: number,
  cy: number,
  radius: number,
): boolean {
  if (el.kind === 'stroke') return strokeIntersects(el.points as [number, number][], cx, cy, radius)
  if (el.kind === 'shape') return shapeIntersects(el, cx, cy, radius)
  return textIntersects(el, cx, cy, radius)
}

/** Remove every element the eraser touches. Pure — does not mutate input. */
export function applyEraser(
  elements: ReadonlyArray<WhiteboardElement>,
  cx: number,
  cy: number,
  radius: number,
): WhiteboardElement[] {
  return elements.filter((el) => !elementIntersects(el, cx, cy, radius))
}

/** Append a new point to a stroke, but only if it's far enough from the last
 *  one. Returns the next points array. Pure. */
export function appendStrokePoint(
  points: ReadonlyArray<readonly [number, number]>,
  next: readonly [number, number],
  minDist = 2,
): [number, number][] {
  if (points.length === 0) return [[next[0], next[1]]]
  const last = points[points.length - 1]!
  if (Math.hypot(next[0] - last[0], next[1] - last[1]) < minDist) {
    return points as [number, number][]
  }
  return [...(points as [number, number][]), [next[0], next[1]]]
}

/** Build the initial element when the user starts drawing/dragging. */
export function buildPenStart(
  start: readonly [number, number],
  color: string,
  width: number,
): Extract<WhiteboardElement, { kind: 'stroke' }> {
  return {
    kind: 'stroke',
    id: nextElementId(),
    points: [[start[0], start[1]]],
    stroke: color,
    strokeWidth: width,
  }
}

export function buildShapeStart(
  shape: 'rect' | 'ellipse' | 'line' | 'arrow',
  start: readonly [number, number],
  color: string,
  width: number,
): Extract<WhiteboardElement, { kind: 'shape' }> {
  return {
    kind: 'shape',
    id: nextElementId(),
    shape,
    x: start[0],
    y: start[1],
    w: 0,
    h: 0,
    stroke: color,
    strokeWidth: width,
  }
}

export function buildTextElement(
  pos: readonly [number, number],
  text: string,
  fontSize: number,
  color: string,
): Extract<WhiteboardElement, { kind: 'text' }> {
  return {
    kind: 'text',
    id: nextElementId(),
    x: pos[0],
    y: pos[1],
    text,
    fontSize,
    color,
  }
}

/** Update the live shape's w/h while the pointer is dragging. Pure. */
export function resizeShape(
  shape: Extract<WhiteboardElement, { kind: 'shape' }>,
  current: readonly [number, number],
): Extract<WhiteboardElement, { kind: 'shape' }> {
  return { ...shape, w: current[0] - shape.x, h: current[1] - shape.y }
}

/* ---------- React component ---------- */

export function WhiteboardBlockEditor({ slug, block }: Props) {
  const etag = useEditorStore((s) => s.etag)
  const apply = useEditorStore((s) => s.applyServerSnapshot)

  const [elements, setElements] = useState<WhiteboardElement[]>(block.elements)
  const [tool, setTool] = useState<WhiteboardTool>('pen')
  const [color, setColor] = useState<string>(WB_COLORS[0])
  const [width, setWidth] = useState<number>(2)
  const [error, setError] = useState<string | null>(null)
  const [savedOnce, setSavedOnce] = useState(false)

  // Active drag (for pen + shape modes). Held in a ref so pointer-move handlers
  // can read the latest state without re-creating the closure.
  const drag = useRef<
    | { kind: 'pen'; element: Extract<WhiteboardElement, { kind: 'stroke' }> }
    | { kind: 'shape'; element: Extract<WhiteboardElement, { kind: 'shape' }> }
    | null
  >(null)

  // Inline text input — single-shot. While `textPos` is set, an absolute-
  // positioned <input> shows at that viewbox coord.
  const [textPos, setTextPos] = useState<[number, number] | null>(null)
  const [textValue, setTextValue] = useState('')

  // Undo / redo stacks: each entry is a *snapshot* of the elements array.
  const undoStack = useRef<WhiteboardElement[][]>([])
  const redoStack = useRef<WhiteboardElement[][]>([])

  const persistTimer = useRef<number | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)

  // Sync from server on remote update (until the user starts editing).
  useEffect(() => {
    if (!savedOnce) setElements(block.elements)
  }, [block.elements, savedOnce])

  const pushUndo = useCallback((snap: WhiteboardElement[]) => {
    undoStack.current.push(snap)
    if (undoStack.current.length > UNDO_DEPTH) undoStack.current.shift()
    redoStack.current = []
  }, [])

  const persist = useCallback(
    async (next: WhiteboardElement[]) => {
      if (!etag) return
      try {
        const result = await patchBlock(
          slug,
          block.id,
          { ...block, elements: next },
          etag,
          '화이트보드 편집',
        )
        apply(result.document, result.etag)
        setError(null)
        setSavedOnce(true)
      } catch (err) {
        if (isPreconditionFailed(err)) setError('충돌 — 새로고침 필요')
        else setError((err as Error).message)
      }
    },
    [apply, block, etag, slug],
  )

  const schedulePersist = useCallback(
    (next: WhiteboardElement[]) => {
      if (persistTimer.current) window.clearTimeout(persistTimer.current)
      persistTimer.current = window.setTimeout(() => {
        void persist(next)
      }, PERSIST_MS)
    },
    [persist],
  )

  const commit = useCallback(
    (next: WhiteboardElement[]) => {
      pushUndo(elements)
      setElements(next)
      schedulePersist(next)
    },
    [elements, pushUndo, schedulePersist],
  )

  const onUndo = () => {
    const prev = undoStack.current.pop()
    if (!prev) return
    redoStack.current.push(elements)
    setElements(prev)
    schedulePersist(prev)
  }
  const onRedo = () => {
    const next = redoStack.current.pop()
    if (!next) return
    undoStack.current.push(elements)
    setElements(next)
    schedulePersist(next)
  }
  const onClear = () => {
    if (elements.length === 0) return
    commit([])
  }

  /** Translate an event into viewbox coordinates. */
  const toViewbox = (e: ReactPointerEvent<SVGSVGElement>): [number, number] => {
    const svg = svgRef.current
    if (!svg) return [0, 0]
    const rect = svg.getBoundingClientRect()
    const sx = (e.clientX - rect.left) * (block.viewbox.w / rect.width)
    const sy = (e.clientY - rect.top) * (block.viewbox.h / rect.height)
    return [sx, sy]
  }

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (textPos) return // text input is open — ignore drawing
    const pos = toViewbox(e)
    e.currentTarget.setPointerCapture(e.pointerId)

    if (tool === 'pen') {
      const el = buildPenStart(pos, color, width)
      drag.current = { kind: 'pen', element: el }
      setElements((cur) => [...cur, el])
      return
    }
    if (tool === 'eraser') {
      const next = applyEraser(elements, pos[0], pos[1], ERASER_RADIUS)
      if (next.length !== elements.length) {
        commit(next)
      }
      return
    }
    if (tool === 'text') {
      setTextPos(pos)
      setTextValue('')
      return
    }
    // shape modes
    const el = buildShapeStart(tool, pos, color, width)
    drag.current = { kind: 'shape', element: el }
    setElements((cur) => [...cur, el])
  }

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!drag.current) {
      // Continuous-eraser while button is pressed.
      if (tool === 'eraser' && e.buttons === 1) {
        const pos = toViewbox(e)
        const next = applyEraser(elements, pos[0], pos[1], ERASER_RADIUS)
        if (next.length !== elements.length) setElements(next)
      }
      return
    }
    const pos = toViewbox(e)
    if (drag.current.kind === 'pen') {
      const cur = drag.current.element
      const points = appendStrokePoint(cur.points as [number, number][], pos)
      if (points === cur.points) return
      const updated = { ...cur, points }
      drag.current = { kind: 'pen', element: updated }
      setElements((els) => els.map((x) => (x.id === cur.id ? updated : x)))
    } else {
      const cur = drag.current.element
      const updated = resizeShape(cur, pos)
      drag.current = { kind: 'shape', element: updated }
      setElements((els) => els.map((x) => (x.id === cur.id ? updated : x)))
    }
  }

  const onPointerUp = () => {
    if (drag.current) {
      pushUndo(elements.filter((x) => x.id !== drag.current!.element.id))
      schedulePersist(elements)
      drag.current = null
    } else if (tool === 'eraser') {
      // Continuous-eraser already mutated; persist the latest snapshot.
      schedulePersist(elements)
    }
  }

  const commitText = () => {
    if (!textPos) return
    const txt = textValue.trim()
    if (txt) {
      const el = buildTextElement(textPos, txt, 16, color)
      commit([...elements, el])
    }
    setTextPos(null)
    setTextValue('')
  }

  return (
    <div
      className="space-y-2 rounded border border-smsg-100 bg-smsg-100/40 p-3"
      data-whiteboard-block-editor
      data-block-id={block.id}
    >
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <ToolButton tool={tool} setTool={setTool} value="pen" label="펜" />
        <ToolButton tool={tool} setTool={setTool} value="eraser" label="지우개" />
        <ToolButton tool={tool} setTool={setTool} value="rect" label="사각형" />
        <ToolButton tool={tool} setTool={setTool} value="ellipse" label="원" />
        <ToolButton tool={tool} setTool={setTool} value="line" label="선" />
        <ToolButton tool={tool} setTool={setTool} value="arrow" label="화살표" />
        <ToolButton tool={tool} setTool={setTool} value="text" label="텍스트" />

        <span className="mx-1 h-5 w-px bg-gray-300" aria-hidden />

        <div className="flex items-center gap-1" role="radiogroup" aria-label="색상">
          {WB_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={color === c}
              aria-label={`색상 ${c}`}
              onClick={() => setColor(c)}
              className={`h-5 w-5 rounded-full border ${color === c ? 'border-black ring-2 ring-smsg-400' : 'border-gray-400'}`}
              style={{ background: c }}
            />
          ))}
          <input
            type="color"
            aria-label="사용자 색상"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="h-5 w-7 cursor-pointer rounded border border-gray-300"
          />
        </div>

        <span className="mx-1 h-5 w-px bg-gray-300" aria-hidden />

        <div className="flex items-center gap-1" role="radiogroup" aria-label="굵기">
          {WB_WIDTHS.map((wp) => (
            <button
              key={wp}
              type="button"
              role="radio"
              aria-checked={width === wp}
              onClick={() => setWidth(wp)}
              className={`flex h-7 w-7 items-center justify-center rounded border text-[10px] ${
                width === wp ? 'border-smsg-500 bg-smsg-50' : 'border-gray-300 bg-white'
              }`}
            >
              <span
                className="block rounded-full bg-current"
                style={{ width: wp * 2, height: wp * 2 }}
                aria-hidden
              />
              <span className="sr-only">{wp}</span>
            </button>
          ))}
        </div>

        <span className="mx-1 h-5 w-px bg-gray-300" aria-hidden />

        <button
          type="button"
          onClick={onUndo}
          className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-40"
          disabled={undoStack.current.length === 0}
        >
          되돌리기
        </button>
        <button
          type="button"
          onClick={onRedo}
          className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-40"
          disabled={redoStack.current.length === 0}
        >
          다시실행
        </button>
        <button
          type="button"
          onClick={onClear}
          className="rounded-md border border-red-300 bg-white px-2 py-1 text-xs text-red-700 hover:bg-red-50"
        >
          지우기
        </button>
      </div>

      {error && <p className="text-[11px] text-red-600">{error}</p>}

      {/* Canvas */}
      <div className="relative rounded border border-gray-200 bg-white">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${block.viewbox.w} ${block.viewbox.h}`}
          width="100%"
          aria-label="화이트보드 캔버스"
          data-whiteboard-canvas
          className="block max-w-full touch-none select-none"
          style={{ aspectRatio: `${block.viewbox.w}/${block.viewbox.h}` }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <WhiteboardElementsLayer elements={elements} />
        </svg>
        {textPos && (
          <input
            autoFocus
            type="text"
            aria-label="텍스트 입력"
            value={textValue}
            onChange={(e) => setTextValue(e.target.value)}
            onBlur={commitText}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commitText()
              } else if (e.key === 'Escape') {
                setTextPos(null)
                setTextValue('')
              }
            }}
            className="absolute rounded border border-smsg-400 bg-white px-1 text-sm shadow"
            style={{
              // Approximate position — the SVG and div share `getBoundingClientRect()`.
              left: `${(textPos[0] / block.viewbox.w) * 100}%`,
              top: `${(textPos[1] / block.viewbox.h) * 100}%`,
            }}
          />
        )}
      </div>
    </div>
  )
}

/** Small reusable tool-toggle button used in the toolbar. */
function ToolButton({
  tool,
  setTool,
  value,
  label,
}: {
  tool: WhiteboardTool
  setTool: (t: WhiteboardTool) => void
  value: WhiteboardTool
  label: string
}) {
  const active = tool === value
  return (
    <button
      type="button"
      onClick={() => setTool(value)}
      aria-pressed={active}
      data-wb-tool={value}
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
