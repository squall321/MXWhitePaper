import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { DocumentJSONV10 } from '@/types/document'

const SEC = '01TESTSECVDFFFFFFFFFFFFFFF1' as const
const BLK_OLD = '01TESTBLKVDOLD0000000000001' as const
const BLK_NEW = '01TESTBLKVDNEW0000000000002' as const

function doc(title: string, text: string, blockId: string): DocumentJSONV10 {
  return {
    schema_version: '1.0',
    id: '01ROOTROOTROOTROOTROOTROOT',
    slug: 'foo',
    title,
    metadata: {
      division: 'MX',
      owners: ['a'],
      tags: [],
      confidentiality: 'internal',
    },
    sections: [
      {
        id: SEC,
        level: 1,
        title: 'Section',
        blocks: [{ type: 'paragraph', id: blockId, text }],
        subsections: [],
      },
    ],
  }
}

const v1 = doc('T', 'hello world', BLK_OLD)
const v2 = doc('T', 'hello brave world', BLK_NEW)

vi.mock('@/features/editor/api', () => ({
  listVersions: () =>
    Promise.resolve([
      {
        version: 2,
        edited_at: '2026-05-08T12:00:00Z',
        edited_by_name: 'Bob',
        change_log: 'edit',
      },
      {
        version: 1,
        edited_at: '2026-05-08T11:00:00Z',
        edited_by_name: 'Alice',
        change_log: 'init',
      },
    ]),
  getVersion: (_slug: string, n: number) => {
    if (n === 1)
      return Promise.resolve({
        version: 1,
        edited_at: '2026-05-08T11:00:00Z',
        edited_by_name: 'Alice',
        change_log: 'init',
        content: v1,
      })
    if (n === 2)
      return Promise.resolve({
        version: 2,
        edited_at: '2026-05-08T12:00:00Z',
        edited_by_name: 'Bob',
        change_log: 'edit',
        content: v2,
      })
    return Promise.resolve(null)
  },
  restoreVersion: () => Promise.resolve({ document: v1, etag: 'W/"x-2"' }),
  isPreconditionFailed: () => false,
}))

// Auth store stub — admin user can restore.
const authState = {
  current: null as null | { id: string; email: string; role: string },
}
vi.mock('@/features/auth/store', () => ({
  useAuthStore: Object.assign(
    (selector: (s: { user: typeof authState.current }) => unknown) =>
      selector({ user: authState.current }),
    {
      getState: () => ({ user: authState.current }),
      setState: () => {},
    },
  ),
}))

// Editor store stub — supplies an `etag` head value for restore.
vi.mock('@/features/editor/state', () => ({
  useEditorStore: (selector: (s: { etag: string | null }) => unknown) =>
    selector({ etag: 'W/"x-2"' }),
  editorSelectors: {},
}))

import { VersionDiffPage } from '../VersionDiff'

function render(path: string): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/docs/:slug/versions/:from/diff/:to" element={<VersionDiffPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('<VersionDiffPage />', () => {
  beforeEach(() => {
    authState.current = { id: 'u1', email: 'a@b', role: 'admin' }
  })

  it('renders the v1 → v2 header and three view tabs', () => {
    const html = render('/docs/foo/versions/1/diff/2')
    expect(html).toContain('v1')
    expect(html).toContain('v2')
    expect(html).toContain('나란히')
    expect(html).toContain('인라인')
    expect(html).toContain('JSON')
  })

  it('renders the change-summary panel headings', () => {
    const html = render('/docs/foo/versions/1/diff/2')
    expect(html).toContain('변경 요약')
    expect(html).toContain('영향받은 섹션')
  })

  it('disables the restore button for non-editor users', () => {
    authState.current = { id: 'u2', email: 'r@b', role: 'reader' }
    const html = render('/docs/foo/versions/1/diff/2')
    // The button is rendered but carries `disabled` because role lacks editor+
    expect(html).toContain('이전 버전으로 되돌리기')
    expect(html).toContain('disabled=""')
  })

  it('exposes a swap-versions control', () => {
    const html = render('/docs/foo/versions/1/diff/2')
    expect(html).toContain('data-testid="swap-versions"')
    expect(html).toContain('좌우 바꾸기')
  })

  it('shows the restore button enabled for admin role', () => {
    const html = render('/docs/foo/versions/1/diff/2')
    expect(html).toContain('data-testid="restore-button"')
    // No `disabled=""` attribute when admin (the className still includes a
    // `disabled:opacity-40` Tailwind variant — that's a class, not the attr).
    const m = html.match(/data-testid="restore-button"[^>]*>/)
    expect(m).not.toBeNull()
    expect(m?.[0]).not.toContain('disabled=""')
  })
})
