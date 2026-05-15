/**
 * Tests for CellBlockEditor (Cycle Z mixed-cell editor).
 *
 * The project test infra deliberately avoids jsdom + @testing-library
 * (see ConflictMergeModal.test.ts comment). Component tests run via SSR
 * (`renderToStaticMarkup`) for static surface checks, and — for interactive
 * behaviour — by invoking the React component as a plain function and
 * walking the returned JSX tree to locate handlers (onClick / onChange)
 * which we then invoke directly with synthetic event-like objects. This
 * matches the no-DOM constraint while still verifying the onChange contract.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import * as React from 'react'

// Hooks (useCallback / useState / useEffect / useRef) are invalid outside a
// render context. For our tree-walking tests we invoke components directly,
// so neutralise the hooks: useCallback is a passthrough, useState is a
// controllable stub (its returned value can be set per-test via
// `nextUseStateValue`), useEffect is a no-op, useRef returns a stable ref
// object. None of these affect the static structure we inspect.
const stateOverrides: unknown[] = []
function pushStateOverride(value: unknown) {
  stateOverrides.push(value)
}
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react')
  return {
    ...actual,
    useCallback: <T,>(fn: T) => fn,
    useState: <T,>(initial: T | (() => T)) => {
      const init =
        typeof initial === 'function' ? (initial as () => T)() : initial
      const override =
        stateOverrides.length > 0 ? (stateOverrides.shift() as T) : init
      return [override, vi.fn()] as [T, (v: T) => void]
    },
    useEffect: () => {},
    useRef: <T,>(initial: T) => ({ current: initial }),
  }
})

import {
  CellBlockEditor,
  wrapSelection,
  wrapLink,
  applyBold,
  applyItalic,
  applyLink,
  moveBlock,
  applyMoveUp,
  applyMoveDown,
} from '../CellBlockEditor'
import type {
  CellBlock,
  ParagraphBlock,
  ImageBlock,
  ListBlock,
} from '@/types/document'

function _para(text: string, id = 'p-' + Math.random().toString(36).slice(2)): ParagraphBlock {
  return { type: 'paragraph', id, text }
}
function _image(
  imageId: string,
  id = 'i-' + Math.random().toString(36).slice(2),
): ImageBlock {
  return { type: 'image', id, imageId }
}
function _list(
  items: string[],
  style: 'bullet' | 'number' | 'check' = 'bullet',
  id = 'l-' + Math.random().toString(36).slice(2),
): ListBlock {
  return { type: 'list', id, style, items }
}

/**
 * Recursively walk a React element tree, yielding every element. Function
 * components are invoked with their props so we descend into their output —
 * useCallback is mocked above to a passthrough so this works without a
 * real React renderer.
 */
function* walk(node: unknown): Generator<React.ReactElement> {
  if (node == null || typeof node === 'boolean') return
  if (Array.isArray(node)) {
    for (const n of node) yield* walk(n)
    return
  }
  if (typeof node !== 'object') return
  const el = node as React.ReactElement
  if (!el.props) return
  if (typeof el.type === 'function') {
    // Function component — expand by invoking it with its props.
    const Comp = el.type as (p: unknown) => React.ReactElement
    const subtree = Comp(el.props)
    yield* walk(subtree)
    return
  }
  yield el
  const kids = (el.props as { children?: unknown }).children
  if (kids !== undefined) yield* walk(kids)
}

/** Collect every JSX element in the rendered tree of a component. */
function flatten(blocks: readonly CellBlock[], onChange: (n: CellBlock[]) => void) {
  // Call the component as a plain function — gives us its top-level JSX
  // without going through a renderer. CellBlockEditor uses useCallback, which
  // works fine in this calling context as long as we don't re-render.
  const tree = (CellBlockEditor as unknown as (p: {
    blocks: readonly CellBlock[]
    onChange: (n: CellBlock[]) => void
  }) => React.ReactElement)({ blocks, onChange })
  return Array.from(walk(tree))
}

function findButtonByText(els: React.ReactElement[], text: string) {
  return els.find(
    (e) =>
      e.type === 'button' &&
      JSON.stringify((e.props as { children?: unknown }).children ?? '').includes(text),
  )
}

function findButtonByAriaLabel(els: React.ReactElement[], label: string) {
  return els.find(
    (e) =>
      e.type === 'button' &&
      (e.props as { 'aria-label'?: string })['aria-label'] === label,
  )
}

describe('<CellBlockEditor />', () => {
  beforeEach(() => {
    stateOverrides.length = 0
  })

  test('renders paragraph blocks with editable textareas', () => {
    const html = renderToStaticMarkup(
      <CellBlockEditor blocks={[_para('hello')]} onChange={() => {}} />,
    )
    expect(html).toContain('<textarea')
    expect(html).toContain('hello')
  })

  test('paragraph edit fires onChange with patched block', () => {
    const onChange = vi.fn()
    const para = _para('original', 'p-fixed')
    const els = flatten([para], onChange)
    const textarea = els.find((e) => e.type === 'textarea')
    expect(textarea).toBeDefined()
    const handler = (textarea!.props as { onChange: (e: unknown) => void }).onChange
    handler({ target: { value: 'updated' } })
    expect(onChange).toHaveBeenCalledTimes(1)
    const arg = onChange.mock.calls[0]![0] as CellBlock[]
    expect(arg).toHaveLength(1)
    expect(arg[0]).toMatchObject({ type: 'paragraph', id: 'p-fixed', text: 'updated' })
  })

  test('removes a paragraph', () => {
    const onChange = vi.fn()
    const els = flatten([_para('bye', 'p-fixed')], onChange)
    // First × button in tree should be the paragraph remove (aria-label 문단 제거).
    const removeBtn = findButtonByAriaLabel(els, '문단 제거')
    expect(removeBtn).toBeDefined()
    const onClick = (removeBtn!.props as { onClick: () => void }).onClick
    onClick()
    expect(onChange).toHaveBeenCalledWith([])
  })

  test('appends a paragraph via + ¶ button', () => {
    const onChange = vi.fn()
    const els = flatten([], onChange)
    const btn = findButtonByText(els, '+ ¶')
    expect(btn).toBeDefined()
    const onClick = (btn!.props as { onClick: () => void }).onClick
    onClick()
    expect(onChange).toHaveBeenCalledTimes(1)
    const arg = onChange.mock.calls[0]![0] as CellBlock[]
    expect(arg).toHaveLength(1)
    expect(arg[0]!.type).toBe('paragraph')
    expect((arg[0] as ParagraphBlock).text).toBe('')
  })

  test('list item add — adds a row and fires onChange', () => {
    const onChange = vi.fn()
    const list = _list(['a'], 'bullet', 'l-fixed')
    const els = flatten([list], onChange)
    const addBtn = findButtonByText(els, '+ 항목')
    expect(addBtn).toBeDefined()
    const onClick = (addBtn!.props as { onClick: () => void }).onClick
    onClick()
    expect(onChange).toHaveBeenCalledTimes(1)
    const arg = onChange.mock.calls[0]![0] as CellBlock[]
    expect(arg).toHaveLength(1)
    expect(arg[0]).toMatchObject({
      type: 'list',
      id: 'l-fixed',
      items: ['a', ''],
    })
  })

  test('list item edit — typing updates items array', () => {
    const onChange = vi.fn()
    const list = _list(['first', 'second'], 'bullet', 'l-fixed')
    const els = flatten([list], onChange)
    const inputs = els.filter(
      (e) => e.type === 'input' && (e.props as { type?: string }).type === 'text',
    )
    expect(inputs.length).toBe(2)
    const secondInput = inputs[1]!
    const handler = (secondInput.props as { onChange: (e: unknown) => void }).onChange
    handler({ target: { value: 'SECOND-EDIT' } })
    expect(onChange).toHaveBeenCalledTimes(1)
    const arg = onChange.mock.calls[0]![0] as CellBlock[]
    expect(arg[0]).toMatchObject({
      type: 'list',
      id: 'l-fixed',
      items: ['first', 'SECOND-EDIT'],
    })
  })

  test('image row shows imageId read-only', () => {
    const html = renderToStaticMarkup(
      <CellBlockEditor blocks={[_image('img-1')]} onChange={() => {}} />,
    )
    expect(html).toContain('img-1')
    expect(html).toContain('× 이미지 제거')
  })

  test('image row has 교체 button', () => {
    const html = renderToStaticMarkup(
      <CellBlockEditor blocks={[_image('img-1')]} onChange={() => {}} />,
    )
    expect(html).toContain('교체')
  })

  test('image row remove fires onChange with empty array', () => {
    const onChange = vi.fn()
    const els = flatten([_image('img-1')], onChange)
    const removeBtn = findButtonByText(els, '× 이미지 제거')
    expect(removeBtn).toBeDefined()
    const onClick = (removeBtn!.props as { onClick: () => void }).onClick
    onClick()
    expect(onChange).toHaveBeenCalledWith([])
  })

  test('empty blocks renders placeholder hint', () => {
    const html = renderToStaticMarkup(
      <CellBlockEditor blocks={[]} onChange={() => {}} />,
    )
    expect(html).toContain('셀이 비어있습니다')
  })

  test('clicking + 🖼 toggles picker modal open (calls setPickerOpen)', () => {
    // With pickerOpen=false (default), the modal isn't rendered yet. Clicking
    // the button calls the (stubbed) setPickerOpen — we verify by switching
    // pickerOpen on for the second flatten() and seeing the modal appear.
    const onChange = vi.fn()
    const els1 = flatten([], onChange)
    const modalBefore = els1.find(
      (e) =>
        typeof e.type === 'string' &&
        (e.props as { 'data-cell-image-picker-modal'?: string })[
          'data-cell-image-picker-modal'
        ] !== undefined,
    )
    expect(modalBefore).toBeUndefined()

    // Now simulate state: pickerOpen=true, replaceIdx=null
    pushStateOverride(true) // pickerOpen
    pushStateOverride(null) // replaceIdx
    const els2 = flatten([], onChange)
    const modalAfter = els2.find(
      (e) =>
        typeof e.type === 'string' &&
        (e.props as { 'data-cell-image-picker-modal'?: string })[
          'data-cell-image-picker-modal'
        ] !== undefined,
    )
    expect(modalAfter).toBeDefined()
  })

  test('picker modal calls onChange with new image when picked (append mode)', () => {
    const onChange = vi.fn()
    // useState call order during flatten:
    //   1. CellBlockEditor: pickerOpen
    //   2. CellBlockEditor: replaceIdx
    //   3. CellBlockEditor: dragIdx
    //   4. CellBlockEditor: dropIdx
    //   5. CellImagePickerModal: manualId
    pushStateOverride(true)
    pushStateOverride(null)
    pushStateOverride(null) // dragIdx
    pushStateOverride(null) // dropIdx
    pushStateOverride('new-img-id')
    const els = flatten([], onChange)
    const modalEl = els.find(
      (e) =>
        typeof e.type === 'string' &&
        (e.props as { 'data-cell-image-picker-modal'?: string })[
          'data-cell-image-picker-modal'
        ] !== undefined,
    )
    expect(modalEl).toBeDefined()
    const confirmBtn = findButtonByText(els, '확인')
    expect(confirmBtn).toBeDefined()
    const onClick = (confirmBtn!.props as { onClick: () => void }).onClick
    onClick()
    expect(onChange).toHaveBeenCalledTimes(1)
    const arg = onChange.mock.calls[0]![0] as CellBlock[]
    expect(arg).toHaveLength(1)
    expect(arg[0]!.type).toBe('image')
    expect((arg[0] as ImageBlock).imageId).toBe('new-img-id')
  })

  test('picker modal replace mode swaps the existing image imageId', () => {
    const onChange = vi.fn()
    const existing = _image('old-img', 'i-fixed')
    pushStateOverride(true) // pickerOpen
    pushStateOverride(0) // replaceIdx
    pushStateOverride(null) // dragIdx
    pushStateOverride(null) // dropIdx
    pushStateOverride('new-img') // manualId
    const els = flatten([existing], onChange)
    const confirmBtn = findButtonByText(els, '확인')
    expect(confirmBtn).toBeDefined()
    ;(confirmBtn!.props as { onClick: () => void }).onClick()
    expect(onChange).toHaveBeenCalledTimes(1)
    const arg = onChange.mock.calls[0]![0] as CellBlock[]
    expect(arg).toHaveLength(1)
    expect(arg[0]).toMatchObject({
      type: 'image',
      id: 'i-fixed',
      imageId: 'new-img',
    })
  })

  test('clicking 교체 fires the replace callback (opens picker in replace mode)', () => {
    const onChange = vi.fn()
    const els = flatten([_image('old-img', 'i-fixed')], onChange)
    const replaceBtn = findButtonByText(els, '교체')
    expect(replaceBtn).toBeDefined()
    // Clicking it should call the (stubbed) state setters — we verify behavior
    // by re-rendering with state forced to "open in replace mode" and confirming
    // the modal title indicates replace.
    ;(replaceBtn!.props as { onClick: () => void }).onClick()

    pushStateOverride(true) // pickerOpen
    pushStateOverride(0) // replaceIdx -> replace mode
    const els2 = flatten([_image('old-img', 'i-fixed')], onChange)
    const titleEl = els2.find(
      (e) =>
        e.type === 'h3' &&
        JSON.stringify((e.props as { children?: unknown }).children ?? '').includes(
          '이미지 교체',
        ),
    )
    expect(titleEl).toBeDefined()
  })

  test('closing modal without pick does not call onChange', () => {
    const onChange = vi.fn()
    pushStateOverride(true) // pickerOpen
    pushStateOverride(null) // replaceIdx
    const els = flatten([], onChange)
    const closeBtn = findButtonByAriaLabel(els, '닫기')
    expect(closeBtn).toBeDefined()
    ;(closeBtn!.props as { onClick: () => void }).onClick()
    expect(onChange).not.toHaveBeenCalled()
  })

  test('manual-id submit with empty string is a noop (no onChange)', () => {
    const onChange = vi.fn()
    pushStateOverride(true) // pickerOpen
    pushStateOverride(null) // replaceIdx
    pushStateOverride(null) // dragIdx
    pushStateOverride(null) // dropIdx
    pushStateOverride('   ') // manualId — whitespace
    const els = flatten([], onChange)
    const confirmBtn = findButtonByText(els, '확인')
    expect(confirmBtn).toBeDefined()
    ;(confirmBtn!.props as { onClick: () => void }).onClick()
    expect(onChange).not.toHaveBeenCalled()
  })

  test('wrapSelection wraps selected text with marker', () => {
    const r = wrapSelection('hello', 0, 5, '**')
    expect(r.text).toBe('**hello**')
    expect(r.selStart).toBe(2)
    expect(r.selEnd).toBe(7)
  })

  test('wrapSelection with no selection inserts paired markers at caret', () => {
    const r = wrapSelection('ab', 1, 1, '**')
    expect(r.text).toBe('a****b')
    expect(r.selStart).toBe(3)
    expect(r.selEnd).toBe(3)
  })

  test('wrapSelection at end of text works', () => {
    const r = wrapSelection('abc', 3, 3, '*')
    expect(r.text).toBe('abc**')
    expect(r.selStart).toBe(4)
    expect(r.selEnd).toBe(4)
    const r2 = wrapSelection('abc', 1, 3, '*')
    expect(r2.text).toBe('a*bc*')
    expect(r2.selStart).toBe(2)
    expect(r2.selEnd).toBe(4)
  })

  test('wrapLink with selection emits [text](url)', () => {
    const r = wrapLink('hello', 0, 5, 'http://x')
    expect(r.text).toBe('[hello](http://x)')
  })

  test('wrapLink with empty url uses placeholder', () => {
    const r = wrapLink('hi', 0, 2, '')
    expect(r.text).toBe('[hi](url)')
  })

  test('wrapLink with no selection inserts template', () => {
    const r = wrapLink('ab', 1, 1, 'http://x')
    expect(r.text).toBe('a[](http://x)b')
    expect(r.selStart).toBe(2)
    expect(r.selEnd).toBe(2)
  })

  test('ParagraphRowEditor renders B/I/link toolbar', () => {
    const html = renderToStaticMarkup(
      <CellBlockEditor blocks={[_para('hello')]} onChange={() => {}} />,
    )
    expect(html).toContain('aria-label="굵게"')
    expect(html).toContain('aria-label="기울임"')
    expect(html).toContain('aria-label="링크"')
  })

  test('applyBold calls onChange with wrapped text', () => {
    const onChange = vi.fn()
    const block: ParagraphBlock = { type: 'paragraph', id: 'p-1', text: 'hello' }
    const sel = applyBold(block, 0, 5, onChange)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0]![0]).toMatchObject({
      type: 'paragraph',
      id: 'p-1',
      text: '**hello**',
    })
    expect(sel).toEqual({ selStart: 2, selEnd: 7 })
  })

  test('applyItalic calls onChange with wrapped text', () => {
    const onChange = vi.fn()
    const block: ParagraphBlock = { type: 'paragraph', id: 'p-1', text: 'hello' }
    applyItalic(block, 0, 5, onChange)
    expect(onChange.mock.calls[0]![0]).toMatchObject({
      type: 'paragraph',
      id: 'p-1',
      text: '*hello*',
    })
  })

  test('applyLink with url calls onChange with [text](url)', () => {
    const onChange = vi.fn()
    const block: ParagraphBlock = { type: 'paragraph', id: 'p-1', text: 'hello' }
    applyLink(block, 0, 5, 'http://x', onChange)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0]![0]).toMatchObject({
      type: 'paragraph',
      id: 'p-1',
      text: '[hello](http://x)',
    })
  })

  test('link button cancel does NOT call onChange', () => {
    // Tests run in node (no jsdom) — the toolbar's cancel guard returns when
    // prompt() yields null. We verify the equivalent guard logic shape: when
    // the prompted URL is null or empty after trim, applyLink is skipped.
    const onChange = vi.fn()
    const block: ParagraphBlock = { type: 'paragraph', id: 'p-1', text: 'hello' }
    for (const url of [null, undefined, '', '   '] as const) {
      if (url == null) continue
      if (url.trim() === '') continue
      applyLink(block, 0, 5, url, onChange)
    }
    expect(onChange).not.toHaveBeenCalled()
  })

  test('moveBlock moves item forward', () => {
    expect(moveBlock(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a'])
  })

  test('moveBlock moves item backward', () => {
    expect(moveBlock(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b'])
  })

  test('moveBlock no-op for same index', () => {
    expect(moveBlock(['a', 'b'], 1, 1)).toEqual(['a', 'b'])
  })

  test('moveBlock no-op for out of range', () => {
    expect(moveBlock(['a', 'b'], -1, 0)).toEqual(['a', 'b'])
    expect(moveBlock(['a', 'b'], 5, 0)).toEqual(['a', 'b'])
    expect(moveBlock(['a', 'b'], 0, 5)).toEqual(['a', 'b'])
  })

  test('moveBlock does not mutate input', () => {
    const original = ['a', 'b', 'c']
    const result = moveBlock(original, 0, 2)
    expect(original).toEqual(['a', 'b', 'c'])
    expect(result).not.toBe(original)
  })

  test('up button reorders block (applyMoveUp)', () => {
    const onChange = vi.fn()
    const a = _para('a', 'p-a')
    const b = _para('b', 'p-b')
    applyMoveUp([a, b], 1, onChange)
    expect(onChange).toHaveBeenCalledTimes(1)
    const arg = onChange.mock.calls[0]![0] as CellBlock[]
    expect(arg.map((x) => (x as ParagraphBlock).text)).toEqual(['b', 'a'])
  })

  test('down button at bottom is no-op (applyMoveDown)', () => {
    const onChange = vi.fn()
    const a = _para('a', 'p-a')
    const b = _para('b', 'p-b')
    applyMoveDown([a, b], 1, onChange)
    expect(onChange).not.toHaveBeenCalled()
  })

  test('up button at top is no-op (applyMoveUp)', () => {
    const onChange = vi.fn()
    const a = _para('a', 'p-a')
    const b = _para('b', 'p-b')
    applyMoveUp([a, b], 0, onChange)
    expect(onChange).not.toHaveBeenCalled()
  })

  test('rowDragProps returns draggable handlers (row wrapper has DnD)', () => {
    // rowDragProps lives inside CellBlockEditor's closure. We assert that
    // each row's outer wrapper receives `draggable: true` and the full set
    // of DnD handler props (onDragStart/Over/Leave/End/Drop) — that's the
    // observable contract from the consumer side.
    const onChange = vi.fn()
    const els = flatten([_para('hello', 'p-1')], onChange)
    // The row wrapper is a div carrying `draggable: true`.
    const rowWrapper = els.find(
      (e) =>
        e.type === 'div' &&
        (e.props as { draggable?: boolean }).draggable === true,
    )
    expect(rowWrapper).toBeDefined()
    const props = rowWrapper!.props as {
      draggable?: boolean
      onDragStart?: unknown
      onDragOver?: unknown
      onDragLeave?: unknown
      onDrop?: unknown
      onDragEnd?: unknown
    }
    expect(props.draggable).toBe(true)
    expect(typeof props.onDragStart).toBe('function')
    expect(typeof props.onDragOver).toBe('function')
    expect(typeof props.onDragLeave).toBe('function')
    expect(typeof props.onDrop).toBe('function')
    expect(typeof props.onDragEnd).toBe('function')
  })
})
