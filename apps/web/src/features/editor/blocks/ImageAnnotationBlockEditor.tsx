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

export const IA_TOOLS = ['select', 'arrow', 'rect', 'callout', 'textbox'] as const
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

/**
 * 요소를 (dx, dy) 만큼 평행이동한 새 요소 반환 (pure). 좌표는 정규화 [0..1] 이라
 * dx/dy 도 같은 단위. 이미지 경계 밖으로 나가지 않도록 clamp 는 호출 측 담당
 * (드래그 도중 부분 노출 허용 — 사용자가 의도적으로 살짝 걸칠 수 있음).
 */
export function moveAnnotation(
  el: AnnotationElement,
  dx: number,
  dy: number,
): AnnotationElement {
  if (el.kind === 'arrow') {
    return {
      ...el,
      from: { x: el.from.x + dx, y: el.from.y + dy },
      to: { x: el.to.x + dx, y: el.to.y + dy },
    }
  }
  if (el.kind === 'rect') {
    return { ...el, x: el.x + dx, y: el.y + dy }
  }
  if (el.kind === 'textbox') {
    return { ...el, x: el.x + dx, y: el.y + dy }
  }
  // callout — anchor 도 같이 옮김 (있을 때).
  return {
    ...el,
    x: el.x + dx,
    y: el.y + dy,
    anchor: el.anchor
      ? { x: el.anchor.x + dx, y: el.anchor.y + dy }
      : el.anchor,
  }
}

/**
 * 우하단 핸들 드래그로 리사이즈 가능한 kind 인지 — rect / textbox 만.
 * arrow 는 from/to 끝점 별도 편집 (후속), callout 은 bubble 크기 라벨 길이로
 * 자동이라 리사이즈 의미 없음.
 */
export function isResizable(
  el: AnnotationElement,
): el is Extract<AnnotationElement, { kind: 'rect' | 'textbox' }> {
  return el.kind === 'rect' || el.kind === 'textbox'
}

/**
 * rect/textbox 우하단을 (cx, cy) 로 끌어 리사이즈. 최소 크기 보장 (w >= 0.02,
 * h >= 0.02 — 핸들이 시각적으로 살아있을 정도).
 */
export function resizeAnnotation(
  el: Extract<AnnotationElement, { kind: 'rect' | 'textbox' }>,
  cx: number,
  cy: number,
): AnnotationElement {
  const w = Math.max(0.02, cx - el.x)
  const h = Math.max(0.02, cy - el.y)
  return { ...el, w, h }
}

/**
 * Multi-line 텍스트 박스. rect 와 같은 (start, end) 드래그로 박스를 만든 뒤
 * 그 자리에 textarea 가 떠서 사용자가 본문을 입력한다. callout 과 달리
 * 짧은 라벨이 아니라 단락성 설명용 — 이미지의 특정 부분에 대한 보강 자료.
 */
export function buildTextbox(
  start: readonly [number, number],
  end: readonly [number, number],
  text: string,
  color: string,
): Extract<AnnotationElement, { kind: 'textbox' }> {
  const x = Math.min(start[0], end[0])
  const y = Math.min(start[1], end[1])
  const w = Math.max(0.05, Math.abs(end[0] - start[0]))
  const h = Math.max(0.04, Math.abs(end[1] - start[1]))
  return {
    kind: 'textbox',
    id: nextAnnotationId(),
    x,
    y,
    w,
    h,
    text,
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
    if (el.kind === 'textbox') {
      // multi-line 텍스트 박스 — 명시적 w/h 로 bbox 검사.
      if (cx >= el.x - radius && cx <= el.x + el.w + radius && cy >= el.y - radius && cy <= el.y + el.h + radius) {
        return el
      }
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

  // Select-tool 의 이동/리사이즈 드래그 상태. mode='move' 면 평행이동,
  // mode='resize' 면 우하단 핸들을 끌어 w/h 조정. originalEl 은 드래그 시작
  // 시점의 요소 스냅샷 — 매 프레임 그 원본 기준 이동/리사이즈해야 누적 오차 없음.
  // pointerStart 는 드래그 시작 시 마우스 정규화 좌표.
  const dragState = useRef<{
    mode: 'move' | 'resize'
    originalEl: AnnotationElement
    pointerStart: [number, number]
  } | null>(null)

  // Inline callout text input — when tool is "callout", a click drops an
  // anchor and shows the input until the user commits / Esc.
  const [calloutPos, setCalloutPos] = useState<[number, number] | null>(null)
  const [calloutText, setCalloutText] = useState('')

  // Textbox 편집 상태 — 사용자가 텍스트박스 도구로 박스를 드래그-그린 직후
  // (pointerUp) 에 활성화. 그 자리에 textarea 가 떠서 multi-line 본문을 받음.
  // Esc / 외부 클릭 / Ctrl+Enter 로 저장.
  const [textboxDraft, setTextboxDraft] = useState<{
    x: number; y: number; w: number; h: number
  } | null>(null)
  const [textboxText, setTextboxText] = useState('')

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
      // 1) 이미 선택된 요소가 있고 그 우하단 핸들 위면 resize 모드.
      if (selectedId) {
        const sel = annotations.find((a) => a.id === selectedId)
        if (sel && isResizable(sel)) {
          const hx = sel.x + sel.w
          const hy = sel.y + sel.h
          const HANDLE_R = 0.025  // 핸들 클릭 허용 반경
          if (Math.abs(pos[0] - hx) <= HANDLE_R && Math.abs(pos[1] - hy) <= HANDLE_R) {
            dragState.current = { mode: 'resize', originalEl: sel, pointerStart: pos }
            return
          }
        }
      }
      // 2) 요소 본체 위면 그 요소 선택 + move 모드 시작.
      const hit = pickElement(annotations, pos[0], pos[1])
      setSelectedId(hit?.id ?? null)
      if (hit) {
        dragState.current = { mode: 'move', originalEl: hit, pointerStart: pos }
      }
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
    } else if (tool === 'textbox') {
      // textbox 도 rect 처럼 박스를 드래그로 그림 — buildTextbox 로 draft.
      // 본문 text 는 pointerUp 후 textarea 에서 입력받는다.
      draft.current = buildTextbox(pos, pos, '', color)
    } else {
      draft.current = buildRect(pos, pos, color)
    }
    // re-render to show draft preview
    setAnnotations((cur) => [...cur])
  }

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const pos = norm(e)

    // 선택-도구 드래그 (이동/리사이즈) — 원본 스냅샷 기준 좌표 갱신.
    if (dragState.current) {
      const ds = dragState.current
      const next = annotations.map((a) => {
        if (a.id !== ds.originalEl.id) return a
        if (ds.mode === 'move') {
          const dx = pos[0] - ds.pointerStart[0]
          const dy = pos[1] - ds.pointerStart[1]
          return moveAnnotation(ds.originalEl, dx, dy)
        }
        // resize — 우하단을 mouse 로
        if (isResizable(ds.originalEl)) {
          return resizeAnnotation(ds.originalEl, pos[0], pos[1])
        }
        return a
      })
      setAnnotations(next)
      return
    }

    if (!draft.current || !startNorm.current) return
    if (draft.current.kind === 'arrow') {
      draft.current = buildArrow(startNorm.current, pos, color)
    } else if (draft.current.kind === 'rect') {
      draft.current = buildRect(startNorm.current, pos, color)
    } else if (draft.current.kind === 'textbox') {
      draft.current = buildTextbox(startNorm.current, pos, '', color)
    }
    // tickle a state update so the preview <g> re-renders
    setAnnotations((cur) => [...cur])
  }

  const onPointerUp = () => {
    // 이동/리사이즈 드래그 마무리 — 현재 상태를 undo 기록과 함께 commit.
    // 이동량이 0 이면 (= 클릭만) commit 안 함 (불필요한 history 누적 방지).
    if (dragState.current) {
      const ds = dragState.current
      dragState.current = null
      const current = annotations.find((a) => a.id === ds.originalEl.id)
      if (current && current !== ds.originalEl) {
        // moveAnnotation/resizeAnnotation 이 새 객체를 만들므로 참조 비교로
        // 변동 여부 판단. 같은 객체 (즉 변동 없음) 면 commit skip.
        commit(annotations)
      }
      return
    }

    if (!draft.current) return
    if (draft.current.kind === 'textbox') {
      // 드래그 끝 — 박스 좌표만 저장하고 textarea 로 본문 입력 받음.
      // 사용자가 텍스트 입력 후 Ctrl+Enter / 외부 클릭으로 commit.
      const d = draft.current
      setTextboxDraft({ x: d.x, y: d.y, w: d.w, h: d.h })
      setTextboxText('')
      draft.current = null
      startNorm.current = null
      // preview 가 사라지도록 한번 더 re-render
      setAnnotations((cur) => [...cur])
      return
    }
    const next = [...annotations, draft.current]
    draft.current = null
    startNorm.current = null
    commit(next)
  }

  const commitTextbox = () => {
    if (!textboxDraft) return
    const txt = textboxText.trim()
    if (txt) {
      const el = buildTextbox(
        [textboxDraft.x, textboxDraft.y],
        [textboxDraft.x + textboxDraft.w, textboxDraft.y + textboxDraft.h],
        txt,
        color,
      )
      commit([...annotations, el])
    }
    setTextboxDraft(null)
    setTextboxText('')
  }

  const cancelTextbox = () => {
    setTextboxDraft(null)
    setTextboxText('')
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
        <ToolButton tool={tool} setTool={setTool} value="textbox" label={t('editor.ia.tool.textbox')} />

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
          // 도구별 cursor 힌트 — 그리기 도구는 crosshair, select 는 default.
          // 요소/핸들 위 cursor 는 각 요소 SVG 가 자체 처리 (resize 핸들은
          // 위에서 nwse-resize 로 표시).
          style={{ cursor: tool === 'select' ? 'default' : 'crosshair' }}
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
          {/* 선택된 rect/textbox 의 우하단 리사이즈 핸들. 다른 요소 위에 그려야
              가시성 확보 — annotations.map 보다 뒤. cursor:nwse-resize 로 의미 전달. */}
          {(() => {
            if (!selectedId) return null
            const sel = annotations.find((a) => a.id === selectedId)
            if (!sel || !isResizable(sel)) return null
            return (
              <rect
                x={sel.x + sel.w - 0.012}
                y={sel.y + sel.h - 0.012}
                width={0.024}
                height={0.024}
                fill="#fff"
                stroke="#0ea5e9"
                strokeWidth={0.004}
                style={{ cursor: 'nwse-resize' }}
                data-testid="ia-resize-handle"
              />
            )
          })()}
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

        {textboxDraft && (
          // 드래그-그린 박스 위에 정확히 같은 위치/크기로 textarea overlay.
          // 좌표는 SVG viewport 와 동일한 비율 (이미지가 컨테이너를 꽉 채움).
          // Ctrl+Enter = 저장, Esc = 취소, blur = 저장.
          <textarea
            autoFocus
            aria-label={t('editor.ia.textboxInput')}
            value={textboxText}
            onChange={(e) => setTextboxText(e.target.value)}
            onBlur={commitTextbox}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                commitTextbox()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                cancelTextbox()
              }
            }}
            placeholder={t('editor.ia.textboxPlaceholder')}
            className="absolute resize-none rounded border-2 bg-white px-1.5 py-1 text-sm shadow outline-none"
            style={{
              left: `${textboxDraft.x * 100}%`,
              top: `${textboxDraft.y * 100}%`,
              width: `${textboxDraft.w * 100}%`,
              height: `${textboxDraft.h * 100}%`,
              borderColor: color,
              color,
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
