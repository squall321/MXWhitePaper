/**
 * SpreadsheetBlockEditor — 중간 삽입 버튼 / 멀티셀 paste / formula 자동완성
 * 키 시나리오 테스트.
 *
 * 프로젝트 테스트 인프라가 jsdom 을 의도적으로 회피하므로 (ChartBlockEditor
 * paste 테스트와 동일하게) 컴포넌트를 일반 함수로 호출해 JSX 트리에서
 * 핸들러를 찾아 가짜 이벤트로 호출한다. useState 는 호출 순서 기반 mock —
 * 컴포넌트의 useState 순서: [0]=local, [1]=error, [2]=focused, [3]=acIndex,
 * [4]=acDismissed, [5]=acPos. setters[0] (setLocal) 호출 인자가 schedule()
 * 로 전달된 next block 이므로 이를 관찰해 동작을 검증한다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as React from 'react'
import { SpreadsheetBlockEditor } from '../SpreadsheetBlockEditor'
import type { SpreadsheetBlock } from '@/types/document'

const h = vi.hoisted(() => ({
  stateOverrides: {} as Record<number, unknown>,
  setters: [] as Array<ReturnType<typeof vi.fn>>,
  idx: 0,
}))

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react')
  return {
    ...actual,
    useState: (initial: unknown) => {
      const i = h.idx++
      const init =
        typeof initial === 'function' ? (initial as () => unknown)() : initial
      const value = i in h.stateOverrides ? h.stateOverrides[i] : init
      const setter = vi.fn()
      h.setters[i] = setter
      return [value, setter]
    },
    useMemo: (fn: () => unknown) => fn(),
    useEffect: () => {},
    useLayoutEffect: () => {},
    useCallback: (fn: unknown) => fn,
    useRef: (initial: unknown) => ({ current: initial }),
  }
})

// zustand hook 은 render 컨텍스트가 필요 — selector 만 호출하는 fake.
vi.mock('@/features/editor/state', () => ({
  useEditorStore: <T,>(
    selector: (s: {
      etag: string
      applyServerSnapshot: () => void
      setConflict: () => void
    }) => T,
  ): T =>
    selector({
      etag: 'etag-test',
      applyServerSnapshot: vi.fn(),
      setConflict: vi.fn(),
    }),
}))

function makeBlock(overrides: Partial<SpreadsheetBlock> = {}): SpreadsheetBlock {
  return {
    type: 'spreadsheet',
    id: '01TESTBLOCK000000000000SS1',
    cols: 4,
    rows: 5,
    cells: {},
    ...overrides,
  } as SpreadsheetBlock
}

/** Host element (string type) 만 yield — function component 는 skip. */
function* walk(node: unknown): Generator<React.ReactElement> {
  if (node == null || typeof node === 'boolean') return
  if (Array.isArray(node)) {
    for (const n of node) yield* walk(n)
    return
  }
  if (typeof node !== 'object') return
  const el = node as React.ReactElement
  if (!el.props) return
  if (typeof el.type === 'function') return
  yield el
  const kids = (el.props as { children?: unknown }).children
  if (kids !== undefined) yield* walk(kids)
}

function renderTree(block: SpreadsheetBlock): React.ReactElement[] {
  const tree = (
    SpreadsheetBlockEditor as unknown as (p: {
      slug: string
      block: SpreadsheetBlock
    }) => React.ReactElement
  )({ slug: 'demo-doc', block })
  return Array.from(walk(tree))
}

function props(el: React.ReactElement): Record<string, unknown> {
  return el.props as Record<string, unknown>
}

function findByAriaLabel(
  els: React.ReactElement[],
  label: string,
): React.ReactElement {
  const el = els.find((e) => props(e)['aria-label'] === label)
  expect(el, `aria-label="${label}" not found`).toBeDefined()
  return el!
}

function findCellInput(
  els: React.ReactElement[],
  ref: string,
): React.ReactElement {
  const el = els.find((e) => props(e)['data-cell-ref'] === ref)
  expect(el, `data-cell-ref="${ref}" not found`).toBeDefined()
  return el!
}

function fakeKeyEvent(key: string, value = '') {
  return {
    key,
    shiftKey: false,
    preventDefault: vi.fn(),
    currentTarget: {
      value,
      selectionStart: value.length,
      selectionEnd: value.length,
    },
  } as unknown as React.KeyboardEvent<HTMLInputElement>
}

function fakeClipboardEvent(text: string) {
  return {
    clipboardData: { getData: (_: string) => text },
    preventDefault: vi.fn(),
  } as unknown as React.ClipboardEvent<HTMLInputElement>
}

/** setters[0] = setLocal — schedule() 이 넘긴 next block. */
function lastScheduled(): SpreadsheetBlock {
  const setLocal = h.setters[0]!
  expect(setLocal).toHaveBeenCalled()
  return setLocal.mock.calls.at(-1)![0] as SpreadsheetBlock
}

beforeEach(() => {
  h.idx = 0
  h.setters = []
  h.stateOverrides = {}
  // schedule() 의 debounce 가 window.setTimeout 을 쓴다 — node env stub.
  vi.stubGlobal('window', {
    setTimeout: vi.fn().mockReturnValue(1),
    clearTimeout: vi.fn(),
  })
})

/* ── 1. 중간 삽입 버튼 ──────────────────────────────────────────────── */

describe('row/col 중간 삽입 버튼', () => {
  it('"행 1 아래에 삽입" 은 insertRow(1) — cells 키와 formula 참조가 shift 된다', () => {
    const block = makeBlock({ cells: { A1: '1', A2: '2', B1: '=A2' } })
    const els = renderTree(block)
    const btn = findByAriaLabel(els, '행 1 아래에 삽입')
    ;(props(btn).onClick as () => void)()
    const next = lastScheduled()
    expect(next.rows).toBe(6)
    expect(next.cells).toEqual({ A1: '1', A3: '2', B1: '=A3' })
  })

  it('"행 2 위에 삽입" 도 insertRow(1) 과 동일한 결과', () => {
    const block = makeBlock({ cells: { A2: '2' } })
    const els = renderTree(block)
    const btn = findByAriaLabel(els, '행 2 위에 삽입')
    ;(props(btn).onClick as () => void)()
    expect(lastScheduled().cells).toEqual({ A3: '2' })
  })

  it('"열 A 왼쪽에 삽입" 은 insertCol(0) — A1 이 B1 으로 밀린다', () => {
    const block = makeBlock({ cells: { A1: '1', B1: '=A1' } })
    const els = renderTree(block)
    const btn = findByAriaLabel(els, '열 A 왼쪽에 삽입')
    ;(props(btn).onClick as () => void)()
    const next = lastScheduled()
    expect(next.cols).toBe(5)
    expect(next.cells).toEqual({ B1: '1', C1: '=B1' })
  })

  it('"열 A 오른쪽에 삽입" 은 insertCol(1) — A1 은 그대로, B 이후만 shift', () => {
    const block = makeBlock({ cells: { A1: '1', B1: '2' } })
    const els = renderTree(block)
    const btn = findByAriaLabel(els, '열 A 오른쪽에 삽입')
    ;(props(btn).onClick as () => void)()
    expect(lastScheduled().cells).toEqual({ A1: '1', C1: '2' })
  })
})

/* ── 2. 멀티셀 paste ───────────────────────────────────────────────── */

describe('멀티셀 paste', () => {
  it('TSV paste 는 preventDefault 후 anchor 셀부터 그리드를 채운다', () => {
    const els = renderTree(makeBlock())
    const input = findCellInput(els, 'B2')
    const e = fakeClipboardEvent('a\tb\nc\td')
    ;(props(input).onPaste as (ev: unknown) => void)(e)
    expect(e.preventDefault).toHaveBeenCalled()
    const next = lastScheduled()
    expect(next.cells).toEqual({ B2: 'a', C2: 'b', B3: 'c', C3: 'd' })
    // 4x5 그리드 안에 들어가므로 크기 불변.
    expect(next.cols).toBe(4)
    expect(next.rows).toBe(5)
  })

  it('경계 초과 paste 는 rows/cols 를 자동 확장한다 (cap 26x200 내)', () => {
    const els = renderTree(makeBlock())
    const input = findCellInput(els, 'D5')
    ;(props(input).onPaste as (ev: unknown) => void)(
      fakeClipboardEvent('a\tb\nc\td'),
    )
    const next = lastScheduled()
    expect(next.cols).toBe(5)
    expect(next.rows).toBe(6)
    expect(next.cells).toEqual({ D5: 'a', E5: 'b', D6: 'c', E6: 'd' })
  })

  it('단일 토큰 paste 는 기본 동작 유지 — preventDefault/schedule 호출 없음', () => {
    const els = renderTree(makeBlock())
    const input = findCellInput(els, 'A1')
    const e = fakeClipboardEvent('hello')
    ;(props(input).onPaste as (ev: unknown) => void)(e)
    expect(e.preventDefault).not.toHaveBeenCalled()
    expect(h.setters[0]).not.toHaveBeenCalled()
  })
})

/* ── 3. formula 자동완성 키 우선순위 ───────────────────────────────── */

describe('formula 자동완성', () => {
  it('dropdown 열림 상태에서 Enter 는 셀 이동 대신 후보를 선택한다', () => {
    h.stateOverrides[2] = 'A1' // focused
    const els = renderTree(makeBlock({ cells: { A1: '=SU' } }))
    const input = findCellInput(els, 'A1')
    const e = fakeKeyEvent('Enter', '=SU')
    ;(props(input).onKeyDown as (ev: unknown) => void)(e)
    expect(e.preventDefault).toHaveBeenCalled()
    // 'SU' prefix 의 첫 후보 SUM 이 '(' 와 함께 삽입됨.
    expect(lastScheduled().cells).toEqual({ A1: '=SUM(' })
  })

  it('Tab 도 후보 선택으로 가로챈다', () => {
    h.stateOverrides[2] = 'A1'
    const els = renderTree(makeBlock({ cells: { A1: '=CONC' } }))
    const input = findCellInput(els, 'A1')
    const e = fakeKeyEvent('Tab', '=CONC')
    ;(props(input).onKeyDown as (ev: unknown) => void)(e)
    expect(e.preventDefault).toHaveBeenCalled()
    expect(lastScheduled().cells).toEqual({ A1: '=CONCAT(' })
  })

  it('dropdown 닫힘 상태 (formula 아님) 에서 Enter 는 기존 셀 이동 그대로', () => {
    h.stateOverrides[2] = 'A1'
    const els = renderTree(makeBlock({ cells: { A1: '10' } }))
    const input = findCellInput(els, 'A1')
    const e = fakeKeyEvent('Enter', '10')
    ;(props(input).onKeyDown as (ev: unknown) => void)(e)
    // 셀 이동도 preventDefault 하지만 schedule (setLocal) 은 호출되지 않는다.
    expect(e.preventDefault).toHaveBeenCalled()
    expect(h.setters[0]).not.toHaveBeenCalled()
  })

  it('열림 상태 ArrowDown 은 후보 이동 (acIndex setter 호출)', () => {
    h.stateOverrides[2] = 'A1'
    const els = renderTree(makeBlock({ cells: { A1: '=S' } }))
    const input = findCellInput(els, 'A1')
    const e = fakeKeyEvent('ArrowDown', '=S')
    ;(props(input).onKeyDown as (ev: unknown) => void)(e)
    expect(e.preventDefault).toHaveBeenCalled()
    expect(h.setters[3]).toHaveBeenCalled() // acIndex
    expect(h.setters[0]).not.toHaveBeenCalled() // 셀 값 변경 없음
  })

  it('열림 상태 Escape 는 dropdown 을 닫는다 (acDismissed=true)', () => {
    h.stateOverrides[2] = 'A1'
    const els = renderTree(makeBlock({ cells: { A1: '=S' } }))
    const input = findCellInput(els, 'A1')
    const e = fakeKeyEvent('Escape', '=S')
    ;(props(input).onKeyDown as (ev: unknown) => void)(e)
    expect(e.preventDefault).toHaveBeenCalled()
    expect(h.setters[4]).toHaveBeenCalledWith(true) // acDismissed
  })

  it('Escape 로 닫힌 (acDismissed) 상태에선 Enter 가 다시 셀 이동으로 동작', () => {
    h.stateOverrides[2] = 'A1'
    h.stateOverrides[4] = true // acDismissed
    const els = renderTree(makeBlock({ cells: { A1: '=SU' } }))
    const input = findCellInput(els, 'A1')
    const e = fakeKeyEvent('Enter', '=SU')
    ;(props(input).onKeyDown as (ev: unknown) => void)(e)
    expect(h.setters[0]).not.toHaveBeenCalled()
  })
})
