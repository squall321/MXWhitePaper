import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TabsBlockView } from '../TabsBlock'
import type { TabsBlock } from '@/types/document'

function harness(node: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  })
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>
  )
}

const ID = '01TESTBLOCK00000000000TABS'

const FIXTURE: TabsBlock = {
  type: 'tabs',
  id: ID,
  tabs: [
    {
      label: 'First',
      blocks: [
        { type: 'paragraph', id: '01PARAGRAPH00000000000001', text: 'one' },
      ],
    },
    {
      label: 'Second',
      blocks: [
        { type: 'paragraph', id: '01PARAGRAPH00000000000002', text: 'two' },
      ],
    },
  ],
}

describe('TabsBlockView a11y', () => {
  it('emits a tablist with id and individual tabs that aria-control the panel', () => {
    const html = renderToStaticMarkup(harness(<TabsBlockView block={FIXTURE} />))
    expect(html).toContain('role="tablist"')
    expect(html).toContain(`id="tabs-${ID}"`)
    // each tab has its own id + aria-controls pointing at the shared panel
    expect(html).toContain(`id="tabs-${ID}-tab-0"`)
    expect(html).toContain(`id="tabs-${ID}-tab-1"`)
    expect(html).toContain(`aria-controls="tabs-${ID}-panel"`)
  })

  it('emits exactly one tabpanel labelled by the active tab', () => {
    const html = renderToStaticMarkup(harness(<TabsBlockView block={FIXTURE} />))
    expect(html).toContain('role="tabpanel"')
    expect(html).toContain(`id="tabs-${ID}-panel"`)
    expect(html).toContain(`aria-labelledby="tabs-${ID}-tab-0"`)
  })

  it('roving tabindex: active tab tabIndex=0, inactive tabIndex=-1', () => {
    const html = renderToStaticMarkup(harness(<TabsBlockView block={FIXTURE} />))
    // crude but reliable: first tab block has tabIndex=0, second is -1
    const firstButton = html.indexOf('id="tabs-01TESTBLOCK00000000000TABS-tab-0"')
    const secondButton = html.indexOf('id="tabs-01TESTBLOCK00000000000TABS-tab-1"')
    expect(firstButton).toBeGreaterThan(-1)
    expect(secondButton).toBeGreaterThan(firstButton)
    const firstSlice = html.slice(firstButton, secondButton)
    const secondSlice = html.slice(secondButton)
    expect(firstSlice).toContain('tabindex="0"')
    expect(secondSlice).toContain('tabindex="-1"')
  })

  it('falls back gracefully when tabs is empty', () => {
    // tabs is a non-empty tuple type at the schema layer; the editor
    // guards against zero tabs. We test the runtime branch by casting.
    const html = renderToStaticMarkup(
      harness(<TabsBlockView block={{ ...FIXTURE, tabs: [] as unknown as TabsBlock['tabs'] }} />),
    )
    expect(html).toContain('role="tablist"')
    expect(html).toContain('role="tabpanel"')
    // no aria-labelledby when there is no tab to label by
    expect(html).not.toContain('aria-labelledby')
  })
})
