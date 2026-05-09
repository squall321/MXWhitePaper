/**
 * Render-time smoke test: every template, when materialised through
 * `templateToSections`, must mount through `<BlockRenderer />` without
 * triggering the BlockBoundary fallback ("이 블록을 표시할 수 없습니다").
 *
 * This is a stronger guarantee than the structural test in
 * `templates.test.ts` — it actually exercises every renderer's prop shape
 * for the seeded data, catching authoring mistakes (e.g. a `chart` with the
 * wrong `chartType`, an `accordion` item missing required `blocks`) at the
 * FE boundary instead of when the user clicks "+ 새 문서" in the browser.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BlockRenderer } from '@/components/blocks/BlockRenderer'
import { useEditorStore } from '@/features/editor/state'
import { TEMPLATES, templateToSections } from '../templates'

function harness(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  })
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>
  )
}

describe('TEMPLATES — every template mounts via BlockRenderer', () => {
  beforeEach(() => {
    useEditorStore.getState().reset()
  })

  for (const tpl of TEMPLATES) {
    it(`${tpl.id} renders all top-level blocks without throwing`, () => {
      const sections = templateToSections(tpl)
      // Concatenate all blocks from all sections and render each one.
      for (const sec of sections) {
        for (const b of sec.blocks) {
          const html = renderToStaticMarkup(harness(<BlockRenderer block={b} />))
          expect(
            html,
            `${tpl.id} :: block ${b.type} fell through to BlockBoundary fallback`,
          ).not.toContain('이 블록을 표시할 수 없습니다')
          expect(html.length).toBeGreaterThan(0)
        }
      }
    })
  }
})
