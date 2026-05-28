import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Mock the api module BEFORE importing the hook so the hook's queryFn closes
 * over the spies (not the real axios stack).
 */
const listGlossarySpy = vi.fn()
const listDomainsSpy = vi.fn()

vi.mock('../api', () => ({
  listGlossary: (...args: unknown[]) => listGlossarySpy(...args),
  listDomains: (...args: unknown[]) => listDomainsSpy(...args),
}))

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { useGlossarySearch } from '../useGlossarySearch'

/**
 * Tiny harness component: invokes the hook and renders a serialisable
 * snapshot of what shape it returned. SSR runs the function bodies but
 * skips useEffect — that's fine, we only want to verify the surface.
 */
function Probe({ q, domain, page }: { q?: string; domain?: string | null; page?: number }) {
  const r = useGlossarySearch({ q, domain, page })
  return (
    <div data-testid="probe">
      <span data-testid="list-pending">{String(r.list.isPending)}</span>
      <span data-testid="domains-pending">{String(r.domains.isPending)}</span>
      <span data-testid="is-empty">{String(r.isEmpty)}</span>
    </div>
  )
}

function renderProbe(props: { q?: string; domain?: string | null; page?: number }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <Probe {...props} />
    </QueryClientProvider>,
  )
}

describe('useGlossarySearch (smoke)', () => {
  beforeEach(() => {
    listGlossarySpy.mockReset()
    listDomainsSpy.mockReset()
    listGlossarySpy.mockResolvedValue({ items: [], total: 0, page: 1, size: 20 })
    listDomainsSpy.mockResolvedValue([])
  })

  it('renders without throwing and exposes list+domains queries', () => {
    const html = renderProbe({})
    expect(html).toContain('data-testid="probe"')
    expect(html).toContain('data-testid="list-pending"')
    expect(html).toContain('data-testid="domains-pending"')
    expect(html).toContain('data-testid="is-empty"')
    // Pending while SSR — neither query has resolved yet.
    expect(html).toContain('>true</span>')
  })

  it('does not crash when q/domain/page are all undefined (default args)', () => {
    expect(() => renderProbe({})).not.toThrow()
  })

  it('accepts a trimmed q + explicit domain + page without throwing', () => {
    expect(() => renderProbe({ q: ' kernel ', domain: 'ml', page: 2 })).not.toThrow()
  })

  it('treats blank q as no-filter (whitespace gets normalised)', () => {
    // Just exercising the hook with various q shapes — should never throw.
    expect(() => renderProbe({ q: '   ' })).not.toThrow()
    expect(() => renderProbe({ q: '' })).not.toThrow()
  })
})
