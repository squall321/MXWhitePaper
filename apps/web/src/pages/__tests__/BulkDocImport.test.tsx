import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'

vi.mock('@/features/import/api', () => ({
  importBulkCsv: vi.fn(async () => ({ created: 0, skipped: 0, errors: [] })),
}))

const authState = {
  current: { user: null as null | { id: string; email: string; role: string } },
}
vi.mock('@/features/auth/store', () => ({
  useAuthStore: Object.assign(
    (selector: (s: { user: typeof authState.current.user }) => unknown) =>
      selector({ user: authState.current.user }),
    {
      getState: () => ({ user: authState.current.user }),
      setState: () => {},
    },
  ),
}))

import { BulkDocImportPage } from '../BulkDocImport'

function render(node: React.ReactNode): string {
  return renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>)
}

describe('<BulkDocImportPage />', () => {
  beforeEach(() => {
    authState.current = { user: null }
  })

  it('returns null markup when no user is loaded', () => {
    const html = render(<BulkDocImportPage />)
    expect(html.length).toBeLessThan(40)
  })

  it('redirects non-admin users (no page chrome rendered)', () => {
    authState.current = {
      user: { id: 'u1', email: 'r@mx.local', role: 'reader' },
    }
    const html = render(<BulkDocImportPage />)
    expect(html).not.toContain('CSV 일괄 가져오기')
  })

  it('renders the dropzone, import button, and column hint for admin', () => {
    authState.current = {
      user: { id: 'u1', email: 'admin@mx.local', role: 'admin' },
    }
    const html = render(<BulkDocImportPage />)
    expect(html).toContain('data-testid="bulk-doc-import-page"')
    expect(html).toContain('data-testid="csv-dropzone"')
    expect(html).toContain('data-testid="csv-import-btn"')
    expect(html).toContain('CSV 일괄 가져오기')
    // column list teaser visible to set expectation
    expect(html).toContain('confidentiality')
    expect(html).toContain('owners')
  })
})
