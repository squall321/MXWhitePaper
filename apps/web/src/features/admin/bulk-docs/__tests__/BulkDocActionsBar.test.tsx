import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('@/features/admin/bulk-docs/api', () => ({
  postBulkDocs: vi.fn(async () => ({ ok: 0, failed: 0, errors: [] })),
}))

vi.mock('@/features/org/hooks/useOrgTree', () => ({
  useOrgTree: () => ({
    data: [],
    isPending: false,
    isError: false,
  }),
}))

vi.mock('@/features/tags/api', () => ({
  listTags: vi.fn(async () => []),
}))

// Stub the store so we don't depend on zustand's useSyncExternalStore
// behavior under react-dom/server (which can be flaky for selectors that
// return non-primitive references like a Set).
const storeState = { selected: new Set<string>(), cleared: 0 }
vi.mock('../bulkDocStore', () => ({
  useBulkDocStore: Object.assign(
    (selector: (s: typeof storeState & { clear: () => void }) => unknown) =>
      selector({
        ...storeState,
        clear: () => {
          storeState.cleared++
          storeState.selected = new Set()
        },
      }),
    {
      setState: (patch: Partial<typeof storeState>) =>
        Object.assign(storeState, patch),
      getState: () => storeState,
    },
  ),
}))

import { BulkDocActionsBar } from '../BulkDocActionsBar'

function render(node: React.ReactNode): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('<BulkDocActionsBar />', () => {
  beforeEach(() => {
    storeState.selected = new Set<string>()
    storeState.cleared = 0
    vi.clearAllMocks()
  })

  it('renders nothing when selection is empty', () => {
    const html = render(<BulkDocActionsBar />)
    expect(html).not.toContain('data-testid="bulk-doc-actions-bar"')
  })

  it('renders the floating bar with all 5 actions when ≥1 slug selected', () => {
    storeState.selected = new Set(['doc-a', 'doc-b'])
    const html = render(<BulkDocActionsBar />)
    expect(html).toContain('data-testid="bulk-doc-actions-bar"')
    expect(html).toContain('2개 선택됨')
    expect(html).toContain('data-testid="bulk-doc-action-move"')
    expect(html).toContain('data-testid="bulk-doc-action-add-tag"')
    expect(html).toContain('data-testid="bulk-doc-action-remove-tag"')
    expect(html).toContain('data-testid="bulk-doc-action-transition"')
    expect(html).toContain('data-testid="bulk-doc-action-delete"')
  })

  it('selection count matches store size', () => {
    storeState.selected = new Set(['a', 'b', 'c', 'd'])
    const html = render(<BulkDocActionsBar />)
    expect(html).toContain('4개 선택됨')
  })
})
