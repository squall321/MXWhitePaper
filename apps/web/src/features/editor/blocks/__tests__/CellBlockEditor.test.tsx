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
import { describe, expect, test, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import * as React from 'react'

// useCallback is invalid outside a render context. For our tree-walking
// tests we invoke the component function directly, so neutralise useCallback
// to a passthrough — its memoisation is irrelevant to a single-shot tree
// inspection.
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react')
  return {
    ...actual,
    useCallback: <T,>(fn: T) => fn,
  }
})

import { CellBlockEditor } from '../CellBlockEditor'
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

  /**
   * Vitest default env is `node` (no jsdom in this project). The component
   * calls `window.prompt`, so we stub `globalThis.window` for the duration
   * of the test.
   */
  function withPrompt(returnValue: string | null, body: (spy: ReturnType<typeof vi.fn>) => void) {
    const spy = vi.fn().mockReturnValue(returnValue)
    const had = 'window' in globalThis
    const prev = (globalThis as Record<string, unknown>).window
    ;(globalThis as Record<string, unknown>).window = { prompt: spy }
    try {
      body(spy)
    } finally {
      if (had) (globalThis as Record<string, unknown>).window = prev
      else delete (globalThis as Record<string, unknown>).window
    }
  }

  test('append image via + 🖼 prompts for imageId and appends', () => {
    const onChange = vi.fn()
    withPrompt('new-img-id', (promptSpy) => {
      const els = flatten([], onChange)
      const btn = els.find(
        (e) =>
          e.type === 'button' &&
          JSON.stringify((e.props as { children?: unknown }).children ?? '').includes('🖼'),
      )
      expect(btn).toBeDefined()
      const onClick = (btn!.props as { onClick: () => void }).onClick
      onClick()
      expect(promptSpy).toHaveBeenCalled()
      expect(onChange).toHaveBeenCalledTimes(1)
      const arg = onChange.mock.calls[0]![0] as CellBlock[]
      expect(arg).toHaveLength(1)
      expect(arg[0]!.type).toBe('image')
      expect((arg[0] as ImageBlock).imageId).toBe('new-img-id')
    })
  })

  test('append image with null prompt does nothing', () => {
    const onChange = vi.fn()
    withPrompt(null, (promptSpy) => {
      const els = flatten([], onChange)
      const btn = els.find(
        (e) =>
          e.type === 'button' &&
          JSON.stringify((e.props as { children?: unknown }).children ?? '').includes('🖼'),
      )
      const onClick = (btn!.props as { onClick: () => void }).onClick
      onClick()
      expect(promptSpy).toHaveBeenCalled()
      expect(onChange).not.toHaveBeenCalled()
    })
  })

  test('append image with empty/whitespace prompt does nothing', () => {
    const onChange = vi.fn()
    withPrompt('   ', () => {
      const els = flatten([], onChange)
      const btn = els.find(
        (e) =>
          e.type === 'button' &&
          JSON.stringify((e.props as { children?: unknown }).children ?? '').includes('🖼'),
      )
      const onClick = (btn!.props as { onClick: () => void }).onClick
      onClick()
      expect(onChange).not.toHaveBeenCalled()
    })
  })
})
