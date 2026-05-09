import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { DocumentJSONV10 } from '@/types/document'

const SEC = '01XSECCROSSDOC0000000000001' as const
const BLK_L = '01XBLKCROSSDOCLEFT00000001A' as const
const BLK_R = '01XBLKCROSSDOCRIGHT0000001B' as const

function doc(slug: string, title: string, text: string, blockId: string): DocumentJSONV10 {
  return {
    schema_version: '1.0',
    id: `01XROOT-${slug}`,
    slug,
    title,
    metadata: {
      division: 'MX',
      team: slug === 'right' ? 'TeamB' : 'TeamA',
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
  } as unknown as DocumentJSONV10
}

const leftDoc = doc('left', 'Left Title', 'hello world', BLK_L)
const rightDoc = doc('right', 'Right Title', 'hello brave world', BLK_R)

vi.mock('@/features/cross-doc-diff/api', async () => {
  const real = await vi.importActual<typeof import('@/features/cross-doc-diff/api')>(
    '@/features/cross-doc-diff/api',
  )
  return {
    ...real,
    compareDocs: vi.fn(async () => {
      const left = {
        document: leftDoc,
        row: {
          id: 'l',
          slug: 'left',
          title: 'Left Title',
          updated_at: '2026-05-08T10:00:00Z',
          content: leftDoc,
        },
        meta: { etag: 'W/"l-1"', updated_at: '2026-05-08T10:00:00Z' },
      }
      const right = {
        document: rightDoc,
        row: {
          id: 'r',
          slug: 'right',
          title: 'Right Title',
          updated_at: '2026-05-09T10:00:00Z',
          content: rightDoc,
        },
        meta: { etag: 'W/"r-1"', updated_at: '2026-05-09T10:00:00Z' },
      }
      const { diffDocument } = await import('@/features/editor/diff/document-diff')
      return {
        left,
        right,
        leftDoc,
        rightDoc,
        diff: diffDocument(leftDoc, rightDoc),
      }
    }),
  }
})

vi.mock('@/features/document/api', async () => {
  const real = await vi.importActual<typeof import('@/features/document/api')>(
    '@/features/document/api',
  )
  return {
    ...real,
    listDocuments: vi.fn(async () => [
      { id: 'l', slug: 'left', title: 'Left Title' },
      { id: 'r', slug: 'right', title: 'Right Title' },
    ]),
  }
})

// WikiArticle pulls in editor stores, favorites, bookmarks, etc. Stub it so the
// page test stays focused on the compare-page composition.
vi.mock('@/components/WikiArticle', () => ({
  WikiArticle: ({ document }: { document: DocumentJSONV10 }) => (
    <div data-testid={`wiki-${document.slug}`}>{document.title}</div>
  ),
}))

import { CrossDocComparePage } from '../CrossDocCompare'

function render(path: string): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/compare" element={<CrossDocComparePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => vi.clearAllMocks())

describe('<CrossDocComparePage />', () => {
  it('renders the empty hint when one slug is missing', () => {
    const html = render('/compare?left=left')
    expect(html).toContain('cross-doc-compare-empty')
    expect(html).toContain('두 슬러그를 모두 선택해 주세요')
  })

  it('renders the slug pickers with current values', () => {
    const html = render('/compare?left=left&right=right')
    expect(html).toContain('cross-doc-picker-left')
    expect(html).toContain('cross-doc-picker-right')
    // Values inserted into inputs.
    expect(html).toMatch(/value="left"/)
    expect(html).toMatch(/value="right"/)
  })

  it('shows the loading banner before the async fetch resolves', () => {
    const html = render('/compare?left=left&right=right')
    // SSR snapshot is taken before async query settles, so we expect the loading text
    expect(html).toContain('cross-doc-compare-loading')
  })

  it('exposes a swap-versions control', () => {
    const html = render('/compare?left=left&right=right')
    expect(html).toContain('data-testid="cross-doc-swap"')
    expect(html).toContain('좌우 바꾸기')
  })
})
