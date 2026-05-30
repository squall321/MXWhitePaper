/**
 * MathBlockEditorWrapper — verifies:
 *   1. SSR renders a marker (data-math-block-editor) anchor.
 *   2. Calling the inner onChange does NOT immediately call patchBlock
 *      (i.e. the API is debounced — keystrokes never hit the BE synchronously).
 *   3. Calling onChange multiple times in succession schedules a single
 *      pending timer (debounce coalesce — confirmed via vi.getTimerCount()).
 *
 * The wrapper uses window.setTimeout — node's vitest harness lacks `window`,
 * so a thin delegating polyfill is registered at module load.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import { useEditorStore } from '@/features/editor/state'
import type { MathBlock } from '@/types/document'

// SSR harness lacks window.* — delegate to globalThis so vi.useFakeTimers
// can intercept the wrapper's setTimeout call.
if (typeof (globalThis as unknown as { window?: unknown }).window === 'undefined') {
  ;(globalThis as unknown as { window: unknown }).window = {
    setTimeout: (cb: () => void, ms: number) =>
      (globalThis.setTimeout as (cb: () => void, ms: number) => number)(cb, ms),
    clearTimeout: (id: number) =>
      (globalThis.clearTimeout as (id: number) => void)(id),
  }
}

const patchSpy = vi.fn(
  async (..._args: unknown[]) => ({
    document: { id: 'doc1', slug: 'demo-doc', version: 2 },
    etag: 'etag-after',
  }),
)

vi.mock('@/features/editor/api', () => ({
  patchBlock: (...args: unknown[]) => patchSpy(...args),
  isPreconditionFailed: () => false,
}))

// Replace MathBlockEditor with a sentinel that captures the onChange the
// wrapper hands down. We test the wrapper's debounce, not KaTeX render.
const onChangeBox: { fn?: (n: MathBlock) => void } = {}
vi.mock('../MathBlockEditor', () => ({
  MathBlockEditor: (p: { block: MathBlock; onChange: (n: MathBlock) => void }) => {
    onChangeBox.fn = p.onChange
    return null
  },
}))

import { MathBlockEditorWrapper } from '../MathBlockEditorWrapper'

const SLUG = 'demo-doc'
const ID = '01EDITORBLOCK0000000000MA1'
const baseBlock: MathBlock = {
  type: 'math',
  id: ID,
  expression: 'a + b = c',
  display: 'block',
}

describe('<MathBlockEditorWrapper /> SSR surface', () => {
  beforeEach(() => {
    useEditorStore.getState().reset()
    useEditorStore.setState({ slug: SLUG, etag: 'etag-base' })
    patchSpy.mockClear()
  })

  it('exposes the data-math-block-editor anchor', () => {
    const html = renderToStaticMarkup(
      <MathBlockEditorWrapper slug={SLUG} block={baseBlock} />,
    )
    expect(html).toContain('data-math-block-editor')
  })
})

describe('<MathBlockEditorWrapper /> debounce', () => {
  beforeEach(() => {
    useEditorStore.getState().reset()
    useEditorStore.setState({ slug: SLUG, etag: 'etag-base' })
    patchSpy.mockClear()
    onChangeBox.fn = undefined
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not call patchBlock synchronously on each onChange', () => {
    renderToStaticMarkup(
      <MathBlockEditorWrapper slug={SLUG} block={baseBlock} />,
    )
    const onChange = onChangeBox.fn
    expect(typeof onChange).toBe('function')

    onChange!({ ...baseBlock, expression: 'a' })
    onChange!({ ...baseBlock, expression: 'ab' })
    onChange!({ ...baseBlock, expression: 'abc' })

    // 3 rapid edits, no PATCH yet — the API is deferred (debounced).
    expect(patchSpy).not.toHaveBeenCalled()
  })

  it('coalesces 3 rapid edits into a single pending timer', () => {
    renderToStaticMarkup(
      <MathBlockEditorWrapper slug={SLUG} block={baseBlock} />,
    )
    const onChange = onChangeBox.fn!
    onChange({ ...baseBlock, expression: 'a' })
    onChange({ ...baseBlock, expression: 'ab' })
    onChange({ ...baseBlock, expression: 'abc' })

    // Each onChange clears the previous timer + schedules a new one, so
    // exactly ONE timer should be pending after the burst — proving the
    // coalesce contract (CodeBlockEditor pattern).
    expect(vi.getTimerCount()).toBe(1)
  })

  it('does not fire the timer before the 500 ms window elapses', () => {
    renderToStaticMarkup(
      <MathBlockEditorWrapper slug={SLUG} block={baseBlock} />,
    )
    onChangeBox.fn!({ ...baseBlock, expression: 'a' })
    vi.advanceTimersByTime(499)
    expect(vi.getTimerCount()).toBe(1)
  })
})
