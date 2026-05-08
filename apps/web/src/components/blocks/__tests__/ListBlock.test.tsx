import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ListBlockView } from '../ListBlock'
import type { ListBlock } from '@/types/document'

// Stub the glossary hook so SSR tests don't need a QueryClientProvider
// (Inline → GlossaryTooltip → useGlossary calls react-query under the hood).
vi.mock('@/features/glossary/useGlossary', () => ({
  useGlossary: () => ({
    terms: [],
    lookup: () => undefined,
    findEntry: () => undefined,
  }),
}))

const mkBlock = (style: ListBlock['style'], items: string[]): ListBlock => ({
  type: 'list',
  id: '01TESTBLOCK000000000000LB',
  style,
  items,
})

describe('<ListBlockView /> nesting', () => {
  it('renders a flat bullet list at depth 0', () => {
    const html = renderToStaticMarkup(
      <ListBlockView block={mkBlock('bullet', ['foo', 'bar'])} />,
    )
    // depth-0 marker is •
    expect(html).toContain('•')
    expect(html).toContain('foo')
    expect(html).toContain('bar')
    // depth-0 → padding-left:0rem (or 0 — either is acceptable from React).
    expect(/padding-left:\s*0(?:rem)?/.test(html)).toBe(true)
    expect(html).toContain('data-depth="0"')
  })

  it('strips leading 2-space pairs and applies depth-based padding', () => {
    const html = renderToStaticMarkup(
      <ListBlockView block={mkBlock('bullet', ['top', '  child', '    grand'])} />,
    )
    // Leading spaces stripped from displayed text.
    expect(html).toContain('top')
    expect(html).toContain('child')
    expect(html).toContain('grand')
    // depth-1 → 1.5rem, depth-2 → 3rem.
    expect(html).toContain('padding-left:1.5rem')
    expect(html).toContain('padding-left:3rem')
    // Marker glyphs change with depth.
    expect(html).toContain('◦') // depth 1
    expect(html).toContain('▪') // depth 2
    expect(html).toContain('data-depth="1"')
    expect(html).toContain('data-depth="2"')
  })

  it('numbers nested ordered lists with 1./a./i. by depth', () => {
    const html = renderToStaticMarkup(
      <ListBlockView
        block={mkBlock('number', ['one', 'two', '  alpha', '  beta', '    roman'])}
      />,
    )
    expect(html).toContain('1.')
    expect(html).toContain('2.')
    expect(html).toContain('a.')
    expect(html).toContain('b.')
    expect(html).toContain('i.')
  })

  it('renders check items honoring [x] and depth', () => {
    const html = renderToStaticMarkup(
      <ListBlockView block={mkBlock('check', ['[x] done', '  [ ] todo'])} />,
    )
    expect(html).toContain('done')
    expect(html).toContain('todo')
    expect(html).toContain('padding-left:1.5rem')
    expect(html).toContain('data-depth="1"')
  })

  it('caps depth at 4 (extra leading pairs collapse to depth 4)', () => {
    // 6 pairs of leading spaces (12 spaces) should still cap at depth 4.
    const html = renderToStaticMarkup(
      <ListBlockView block={mkBlock('bullet', ['            deepest'])} />,
    )
    expect(html).toContain('padding-left:6rem')
    expect(html).toContain('data-depth="4"')
    expect(html).toContain('deepest')
  })
})
