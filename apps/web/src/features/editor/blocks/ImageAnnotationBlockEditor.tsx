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
import { withBase } from '@/lib/basePath'
import { useImage } from '@/features/upload/hooks/useImage'
import {
  ImageDropzone,
  type ImageDropzoneHandle,
} from '@/features/upload/components/ImageDropzone'
import { uploadImage } from '@/features/upload/uploadImage'
import { loadImageElement, rotateImageToBlob } from '@/features/upload/canvasEncode'
import { rotateAnnotations } from '@/features/upload/annotationRotate'
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
  bgColor?: string,
): Extract<AnnotationElement, { kind: 'callout' }> {
  return {
    kind: 'callout',
    id: nextAnnotationId(),
    x: pos[0],
    y: pos[1],
    label: text,
    color,
    ...(bgColor ? { bgColor } : {}),
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
 * arrow 의 from/to 한쪽 끝점만 (cx, cy) 로 옮긴 새 arrow 반환. 다른 끝점은
 * 고정. 선택된 arrow 의 끝점 핸들 드래그에서 사용.
 */
export function moveArrowEndpoint(
  el: Extract<AnnotationElement, { kind: 'arrow' }>,
  which: 'from' | 'to',
  cx: number,
  cy: number,
): AnnotationElement {
  if (which === 'from') return { ...el, from: { x: cx, y: cy } }
  return { ...el, to: { x: cx, y: cy } }
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
    // callout — bubble bbox roughly label.length * 0.014. label 이 없는 legacy
    // row (text 필드만 있는 옛 데이터) 도 안전하게 처리.
    const labelLen = (el.label ?? (el as unknown as { text?: string }).text ?? '').length
    const bw = Math.max(0.08, labelLen * 0.014)
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
  const src = image?.urls.view ?? withBase(`/api/v1/images/${encodeURIComponent(block.imageId)}`)
  const bg = image?.dominant_color ?? '#f3f4f6'

  const [annotations, setAnnotations] = useState<AnnotationElement[]>(block.annotations)
  const [tool, setTool] = useState<IAnnotationTool>('arrow')
  const [color, setColor] = useState<string>(IA_COLORS[0])
  /**
   * callout 라벨 배경 색. undefined = 흰색 default (image-annotation-label-bg
   * 사이클의 svg-block-audit 의도 보존 — 사용자 이미지 위 가독성). 사용자가
   * 명시 선택 시만 schema에 저장.
   */
  const [calloutBgColor, setCalloutBgColor] = useState<string | undefined>(undefined)
  // 선택된 요소들 — Shift+클릭으로 다중 선택. 단일 선택 코드 경로 보존을 위해
  // primary (가장 최근에 더해진) id 를 selectedId 로 derive.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  // 마지막 클릭한 요소를 primary 로 — 핸들 표시·삭제 버튼 활성·우하단 리사이즈
  // 등 단일-요소 UI 는 이걸로. 다중 선택 시에도 핸들은 primary 에만 표시.
  const [primaryId, setPrimaryId] = useState<string | null>(null)
  const selectedId = primaryId  // 기존 코드와의 호환 별칭.

  // primary/selectedIds 동기화 — Set 에 없는 primary 는 정리.
  const setSelectionSingle = (id: string | null) => {
    if (id === null) {
      setSelectedIds(new Set())
      setPrimaryId(null)
    } else {
      setSelectedIds(new Set([id]))
      setPrimaryId(id)
    }
  }
  const toggleSelectionMulti = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
        // primary 가 빠진 경우 — 다른 요소를 새 primary 로.
        if (primaryId === id) {
          const remaining = Array.from(next)
          setPrimaryId(remaining[remaining.length - 1] ?? null)
        }
      } else {
        next.add(id)
        setPrimaryId(id)
      }
      return next
    })
  }
  const [error, setError] = useState<string | null>(null)
  const [savedOnce, setSavedOnce] = useState(false)
  const [rotateBusy, setRotateBusy] = useState(false)

  // Drafting state — while dragging an arrow / rect, we mount a preview
  // element with this synthetic id so it draws in real-time without entering
  // the persisted array.
  const draft = useRef<AnnotationElement | null>(null)
  const startNorm = useRef<[number, number] | null>(null)

  // Select-tool 의 드래그 상태. mode:
  //   'move'       — 선택된 요소(들) 평행이동. 다중 선택 시 originalEls 전부 같이.
  //   'resize'     — rect/textbox 우하단 핸들로 w/h 조정 (primary 1 개만).
  //   'arrow-from' — arrow from 끝점만 이동.
  //   'arrow-to'   — arrow to 끝점만 이동.
  // originalEls 는 드래그 시작 시점의 요소 스냅샷(들) — 매 프레임 그 원본 기준
  // 계산해야 누적 오차 없음. pointerStart 는 시작 시 마우스 정규화 좌표.
  const dragState = useRef<{
    mode: 'move' | 'resize' | 'arrow-from' | 'arrow-to'
    originalEls: Map<string, AnnotationElement>
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
    if (selectedIds.size === 0) return
    const next = annotations.filter((a) => !selectedIds.has(a.id))
    if (next.length === annotations.length) return
    setSelectionSingle(null)
    commit(next)
    // setSelectionSingle 은 컴포넌트 안 함수라 deps 누락 경고 가능 — 안정 참조라
    // 동작은 무관, 린트 무시.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotations, commit, selectedIds])

  // 키보드 단축키 — Backspace/Delete = 삭제, 방향키 = 미세 이동 (Shift = 큼).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 에디터 안에 포커스가 있을 때만 작동 — textarea/input 안 입력 가로채지
      // 않도록 활성 요소가 SVG 캔버스 본체 영역인 경우로 제한.
      if (!wrapperRef.current?.contains(document.activeElement)) return

      if ((e.key === 'Backspace' || e.key === 'Delete') && selectedId) {
        e.preventDefault()
        onDeleteSelected()
        return
      }

      // 방향키 미세 이동 — 정규화 좌표 [0..1] 에서 1단위 = 0.005 (대략 1%).
      // Shift = 5배 (0.025). 다중 선택 시 전부 같이 이동.
      // textarea 안에 포커스 있으면 이 핸들러 진입 조건 (contains activeElement)
      // 은 통과하지만 e.target 이 textarea 면 native 동작 우선.
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return
      }

      if (selectedIds.size === 0) return
      const isArrow =
        e.key === 'ArrowUp' || e.key === 'ArrowDown' ||
        e.key === 'ArrowLeft' || e.key === 'ArrowRight'
      if (!isArrow) return

      const step = e.shiftKey ? 0.025 : 0.005
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
      if (dx === 0 && dy === 0) return

      e.preventDefault()
      const next = annotations.map((a) =>
        selectedIds.has(a.id) ? moveAnnotation(a, dx, dy) : a,
      )
      commit(next)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onDeleteSelected, selectedId, selectedIds, annotations, commit])

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
      const HANDLE_R = 0.025  // 핸들 클릭 허용 반경 (정규화 좌표).
      // 1) 이미 선택된 요소의 핸들 위면 — kind 에 따라 resize / arrow-from /
      //    arrow-to 모드 진입. 핸들 hit 이 본체 hit 보다 우선해야 핸들 위에서
      //    드래그 시작 시 의도대로 동작 (그 위치는 본체 안이기도 하므로).
      if (selectedId) {
        const sel = annotations.find((a) => a.id === selectedId)
        if (sel) {
          if (isResizable(sel)) {
            const hx = sel.x + sel.w
            const hy = sel.y + sel.h
            if (Math.abs(pos[0] - hx) <= HANDLE_R && Math.abs(pos[1] - hy) <= HANDLE_R) {
              dragState.current = {
                mode: 'resize',
                originalEls: new Map([[sel.id, sel]]),
                pointerStart: pos,
              }
              return
            }
          }
          if (sel.kind === 'arrow') {
            // from 핸들 검사 — to 보다 먼저 (start point 가 보통 의미적 origin).
            if (Math.abs(pos[0] - sel.from.x) <= HANDLE_R && Math.abs(pos[1] - sel.from.y) <= HANDLE_R) {
              dragState.current = {
                mode: 'arrow-from',
                originalEls: new Map([[sel.id, sel]]),
                pointerStart: pos,
              }
              return
            }
            if (Math.abs(pos[0] - sel.to.x) <= HANDLE_R && Math.abs(pos[1] - sel.to.y) <= HANDLE_R) {
              dragState.current = {
                mode: 'arrow-to',
                originalEls: new Map([[sel.id, sel]]),
                pointerStart: pos,
              }
              return
            }
          }
        }
      }
      // 2) 요소 본체 위면 — Shift 면 다중 토글, 아니면 단일 선택. hit 이 있으면
      //    move 모드 시작.
      const hit = pickElement(annotations, pos[0], pos[1])

      // 다중 선택을 이어가야 하는 경우 — hit 이 이미 selectedIds 안에 있으면
      // 그 그룹 전체를 그대로 들고 이동. Shift+클릭은 토글 후 새 그룹으로 이동.
      let groupIds: string[]
      if (e.shiftKey && hit) {
        // Shift 토글 — 이미 있으면 빼고, 없으면 더하기. 토글 후 멤버십에 따라
        // 그룹 결정. 더해진 경우 → 새 그룹 전체로 즉시 드래그 가능.
        const alreadyIn = selectedIds.has(hit.id)
        toggleSelectionMulti(hit.id)
        if (alreadyIn) {
          // 빠진 경우 — drag 시작 안 함 (방금 deselect 한 것을 또 옮기는 건 어색).
          groupIds = []
        } else {
          // 추가된 경우 — 기존 + hit 으로 그룹 이동.
          groupIds = [...Array.from(selectedIds), hit.id]
        }
      } else if (hit && selectedIds.has(hit.id)) {
        // hit 가 기존 그룹 멤버 → 그룹 전체 이동.
        groupIds = Array.from(selectedIds)
      } else {
        // 새 요소 선택 (또는 빈 곳).
        setSelectionSingle(hit?.id ?? null)
        groupIds = hit ? [hit.id] : []
      }

      if (hit && groupIds.length > 0) {
        const originals = new Map<string, AnnotationElement>()
        for (const id of groupIds) {
          const el = annotations.find((a) => a.id === id)
          if (el) originals.set(id, el)
        }
        dragState.current = { mode: 'move', originalEls: originals, pointerStart: pos }
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

    // 선택-도구 드래그 (이동/리사이즈/끝점) — 원본 스냅샷 기준 좌표 갱신.
    if (dragState.current) {
      const ds = dragState.current
      const dx = pos[0] - ds.pointerStart[0]
      const dy = pos[1] - ds.pointerStart[1]
      const next = annotations.map((a) => {
        const orig = ds.originalEls.get(a.id)
        if (!orig) return a
        if (ds.mode === 'move') {
          return moveAnnotation(orig, dx, dy)
        }
        if (ds.mode === 'resize' && isResizable(orig)) {
          return resizeAnnotation(orig, pos[0], pos[1])
        }
        if ((ds.mode === 'arrow-from' || ds.mode === 'arrow-to') && orig.kind === 'arrow') {
          const which = ds.mode === 'arrow-from' ? 'from' : 'to'
          return moveArrowEndpoint(orig, which, pos[0], pos[1])
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
    // 변동 없는 클릭만 (어떤 요소도 새 객체가 아니면) commit skip — history 보호.
    if (dragState.current) {
      const ds = dragState.current
      dragState.current = null
      let changed = false
      for (const [id, orig] of ds.originalEls) {
        const cur = annotations.find((a) => a.id === id)
        if (cur && cur !== orig) { changed = true; break }
      }
      if (changed) commit(annotations)
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
      const el = buildCallout(calloutPos, txt, color, calloutBgColor)
      commit([...annotations, el])
    }
    setCalloutPos(null)
    setCalloutText('')
  }

  const onReplaceImage = () => dropzoneRef.current?.openFilePicker()

  /**
   * 90° CW rotate. Rotates the underlying bitmap (re-upload via
   * `rotateImageToBlob` + `uploadImage`) AND transforms every annotation's
   * normalized coords by the same angle — keeping them aligned with the
   * rotated image. Without this dual update the bitmap dimensions swap
   * (e.g. 800x600 → 600x800) and existing annotations silently misalign.
   */
  const onRotateClick = async () => {
    if (rotateBusy || !src) return
    setRotateBusy(true)
    setError(null)
    try {
      const el = await loadImageElement(src)
      const blob = await rotateImageToBlob(el, 90)
      const rec = await uploadImage(blob, { filename: `rot-${block.id}.png` })
      const nextAnns = rotateAnnotations(annotations, 90)
      // Local optimistic update so the canvas re-renders with the new coords
      // before the server PATCH round-trips.
      setAnnotations(nextAnns)
      await persist(nextAnns, rec.image_id)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setRotateBusy(false)
    }
  }

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

        {tool === 'callout' && (
          <>
            <span className="mx-1 h-5 w-px bg-gray-300" aria-hidden="true" />
            <div
              data-callout-bg-group
              className="flex items-center gap-1"
              role="radiogroup"
              aria-label={t('editor.ia.calloutBgGroup')}
            >
              <span className="text-[10px] text-gray-500">bg:</span>
              <CalloutBgSwatch
                value={undefined}
                current={calloutBgColor}
                onClick={setCalloutBgColor}
                swatchBg="#ffffff"
                title={t('editor.ia.calloutBgDefault')}
              />
              <CalloutBgSwatch
                value="#111827"
                current={calloutBgColor}
                onClick={setCalloutBgColor}
                swatchBg="#111827"
                title={t('editor.ia.calloutBgDark')}
              />
              <CalloutBgSwatch
                value="#fef3c7"
                current={calloutBgColor}
                onClick={setCalloutBgColor}
                swatchBg="#fef3c7"
                title={t('editor.ia.calloutBgYellow')}
              />
            </div>
          </>
        )}

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
          title={t('editor.ia.rotateTitle')}
          aria-label={t('editor.ia.rotateAria')}
          data-action="rotate"
          onClick={() => void onRotateClick()}
          disabled={rotateBusy}
          className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-40"
        >
          <span aria-hidden="true">{rotateBusy ? '…' : '↻'}</span>
        </button>
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
          {annotations.map((ann) => {
            const isSelected = selectedIds.has(ann.id)
            return (
              <g
                key={ann.id}
                opacity={isSelected ? 0.6 : 1}
                data-selected={isSelected ? '' : undefined}
              >
                <AnnotationElementView ann={ann} />
              </g>
            )
          })}
          {/* 선택된 요소의 편집 핸들. annotations.map 뒤에 그려야 위에 보임. */}
          {(() => {
            if (!selectedId) return null
            const sel = annotations.find((a) => a.id === selectedId)
            if (!sel) return null
            // rect/textbox — 우하단 리사이즈 핸들.
            if (isResizable(sel)) {
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
            }
            // arrow — from/to 양 끝점 핸들 (동그라미).
            if (sel.kind === 'arrow') {
              return (
                <g data-testid="ia-arrow-handles">
                  <circle
                    cx={sel.from.x}
                    cy={sel.from.y}
                    r={0.012}
                    fill="#fff"
                    stroke="#0ea5e9"
                    strokeWidth={0.004}
                    style={{ cursor: 'move' }}
                    data-testid="ia-arrow-handle-from"
                  />
                  <circle
                    cx={sel.to.x}
                    cy={sel.to.y}
                    r={0.012}
                    fill="#fff"
                    stroke="#0ea5e9"
                    strokeWidth={0.004}
                    style={{ cursor: 'move' }}
                    data-testid="ia-arrow-handle-to"
                  />
                </g>
              )
            }
            return null
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

/**
 * Callout 라벨 배경 swatch — `value=undefined` 가 흰색 default (svg-block-audit
 * 의도 보존), 그 외 색은 사용자 override. 시각적으로 default(undefined) 와
 * 명시적 흰색(`#ffffff`)을 구분하기 위해 default swatch는 회색 dashed border.
 */
function CalloutBgSwatch({
  value,
  current,
  onClick,
  swatchBg,
  title,
}: {
  value: string | undefined
  current: string | undefined
  onClick: (v: string | undefined) => void
  swatchBg: string
  title: string
}) {
  const active = value === current
  const isDefault = value === undefined
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      aria-label={title}
      title={title}
      onClick={() => onClick(value)}
      data-callout-bg={value ?? 'default'}
      className={`h-5 w-5 rounded border ${
        active ? 'border-black ring-2 ring-smsg-400' : isDefault ? 'border-dashed border-gray-400' : 'border-gray-400'
      }`}
      style={{ background: swatchBg }}
    />
  )
}
