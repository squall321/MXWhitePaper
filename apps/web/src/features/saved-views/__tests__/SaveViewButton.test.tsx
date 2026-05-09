import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('@/features/saved-views/api', async () => {
  const mod = await vi.importActual<typeof import('../api')>('../api')
  return {
    ...mod,
    createSavedView: vi.fn(async () => ({
      id: 'sv-1',
      user_id: 'u-1',
      name: 'view',
      icon: '📂',
      filters: { tag: '결산' },
      ordering: 0,
      created_at: null,
      updated_at: null,
    })),
    listSavedViews: vi.fn(async () => []),
    patchSavedView: vi.fn(),
    deleteSavedView: vi.fn(),
    getSavedViewResults: vi.fn(async () => ({
      items: [],
      total: 0,
      count: 0,
      limit: 1,
      offset: 0,
      name: '',
      filters: {},
    })),
  }
})

import { SaveViewButton } from '../SaveViewButton'

function render(node: React.ReactNode): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>{node}</QueryClientProvider>,
  )
}

describe('<SaveViewButton />', () => {
  it('renders nothing when filters are empty', () => {
    const html = render(<SaveViewButton filters={{}} />)
    expect(html).toBe('')
  })

  it('renders nothing when only blank-string filters are passed', () => {
    const html = render(
      <SaveViewButton filters={{ part: '', tag: '   ', q: '' }} />,
    )
    expect(html).toBe('')
  })

  it('renders the toggle when at least one filter is non-empty', () => {
    const html = render(<SaveViewButton filters={{ tag: '결산' }} />)
    expect(html).toContain('data-testid="save-view-button"')
    expect(html).toContain('data-testid="save-view-toggle"')
    expect(html).toContain('뷰로 저장')
    // The dialog is closed by default.
    expect(html).not.toContain('data-testid="save-view-dialog"')
  })

  it('toggle exposes aria-haspopup="dialog"', () => {
    const html = render(<SaveViewButton filters={{ part: 'closing' }} />)
    expect(html).toContain('aria-haspopup="dialog"')
    expect(html).toContain('aria-expanded="false"')
  })
})
