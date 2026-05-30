/**
 * CalloutBlock dark-mode variants — every variant carries a `dark:bg-*`
 * + `dark:text-*` + `dark:border-*` class on its top-level `<aside>` so
 * the dark theme has explicit, non-derived contrast.
 */
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { CalloutBlockView } from '../CalloutBlock'
import type { CalloutBlock } from '@/types/document'

// Glossary tooltip path uses react-query — stub it so SSR doesn't need a
// QueryClientProvider for this very small surface.
vi.mock('@/features/glossary/useGlossary', () => ({
  useGlossary: () => ({
    terms: [],
    lookup: () => undefined,
    findEntry: () => undefined,
  }),
}))

function mk(variant: CalloutBlock['variant']): CalloutBlock {
  return {
    type: 'callout',
    id: '01TESTBLOCK00000000000CL01',
    variant,
    text: 'darkmode sample',
  }
}

describe('<CalloutBlockView /> dark mode variants', () => {
  it('info — emits dark:bg-smsg-950/30 + dark:border-smsg-400', () => {
    const html = renderToStaticMarkup(<CalloutBlockView block={mk('info')} />)
    expect(html).toContain('dark:bg-smsg-950/30')
    expect(html).toContain('dark:border-smsg-400')
    expect(html).toContain('dark:text-smsg-200')
  })

  it('warn — emits dark:bg-amber-950/30 + dark:text-amber-200', () => {
    const html = renderToStaticMarkup(<CalloutBlockView block={mk('warn')} />)
    expect(html).toContain('dark:bg-amber-950/30')
    expect(html).toContain('dark:text-amber-200')
    expect(html).toContain('dark:border-amber-500')
  })

  it('danger — emits dark:bg-red-950/30 + dark:text-red-200', () => {
    const html = renderToStaticMarkup(<CalloutBlockView block={mk('danger')} />)
    expect(html).toContain('dark:bg-red-950/30')
    expect(html).toContain('dark:text-red-200')
    expect(html).toContain('dark:border-red-500')
  })

  it('tip — emits dark:bg-emerald-950/30 + dark:text-emerald-200', () => {
    const html = renderToStaticMarkup(<CalloutBlockView block={mk('tip')} />)
    expect(html).toContain('dark:bg-emerald-950/30')
    expect(html).toContain('dark:text-emerald-200')
    expect(html).toContain('dark:border-emerald-500')
  })

  it('body text also has dark variant', () => {
    const html = renderToStaticMarkup(<CalloutBlockView block={mk('info')} />)
    expect(html).toContain('dark:text-gray-100')
  })
})
