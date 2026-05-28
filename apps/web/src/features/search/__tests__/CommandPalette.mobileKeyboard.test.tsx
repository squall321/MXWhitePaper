import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CommandPalette } from '../components/CommandPalette'

vi.mock('../api', () => ({
  searchDocuments: vi.fn(async () => []),
  listWidgets: vi.fn(async () => []),
  searchSuggest: vi.fn(async () => ({
    tags: [],
    authors: [],
    parts: [],
    documents: [],
  })),
}))

function withProviders(node: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>
  )
}

/**
 * Mobile audit L15 — On a phone, the soft-keyboard pops up after focus and
 * shrinks the visual viewport without changing the layout viewport. The
 * bottom-pinned palette (sm: `items-end`) plus a `max-h-80` results list
 * + footer hints can push the input above the keyboard, sometimes covering
 * it entirely. Fix: a `visualViewport` listener that caps the list height
 * to (vv.height - chrome) on mobile.
 *
 * We can't drive the visual viewport from SSR — the effect runs only in
 * the browser. The structural guard below just asserts the testid exists
 * so a future refactor doesn't silently strip the hook by removing the
 * wrapping `<div>` (which would orphan the style override).
 */
describe('CommandPalette — L15 mobile keyboard guard', () => {
  it('renders the results container with `data-testid="palette-results"`', () => {
    const html = renderToStaticMarkup(
      withProviders(<CommandPalette open onClose={() => {}} />),
    )
    expect(html).toContain('data-testid="palette-results"')
    // SSR fallback: the results wrapper keeps the `max-h-80` Tailwind
    // class — the visual-viewport hook only adds an inline maxHeight in
    // the browser when window width < 640px (sm).
    expect(html).toMatch(
      /class="max-h-80 overflow-y-auto p-2" data-testid="palette-results"/,
    )
  })
})
