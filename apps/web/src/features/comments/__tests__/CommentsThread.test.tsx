import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// Stub the comments API so the SSR render walks against a deterministic
// thread tree (1 parent + 2 replies + 1 soft-deleted) without touching the
// network. We import the module after the mock is registered.
const FIXTURE_ITEMS = [
  {
    id: 'c1',
    document_id: 'doc1',
    anchor_kind: 'section',
    anchor_id: '1',
    body_md: '첫번째 댓글입니다 @Bob',
    author_id: 'u1',
    parent_id: null,
    status: 'visible',
    created_at: '2026-05-08T00:00:00Z',
    updated_at: '2026-05-08T00:00:00Z',
    mention_user_ids: ['u2'],
    author_name: 'Alice',
    author_email: 'alice@mx.local',
  },
  {
    id: 'c2',
    document_id: 'doc1',
    anchor_kind: 'section',
    anchor_id: '1',
    body_md: '답글 하나',
    author_id: 'u2',
    parent_id: 'c1',
    status: 'visible',
    created_at: '2026-05-08T00:01:00Z',
    updated_at: '2026-05-08T00:01:00Z',
    mention_user_ids: [],
    author_name: 'Bob',
    author_email: 'bob@mx.local',
  },
  {
    id: 'c3',
    document_id: 'doc1',
    anchor_kind: 'section',
    anchor_id: '1',
    body_md: '답글 둘',
    author_id: 'u3',
    parent_id: 'c1',
    status: 'visible',
    created_at: '2026-05-08T00:02:00Z',
    updated_at: '2026-05-08T00:02:00Z',
    mention_user_ids: [],
    author_name: 'Charlie',
    author_email: 'charlie@mx.local',
  },
  {
    id: 'c4',
    document_id: 'doc1',
    anchor_kind: 'section',
    anchor_id: '1',
    body_md: '비밀',
    author_id: 'u4',
    parent_id: null,
    status: 'deleted',
    created_at: '2026-05-08T00:03:00Z',
    updated_at: '2026-05-08T00:03:00Z',
    mention_user_ids: [],
    author_name: 'Dave',
    author_email: 'dave@mx.local',
  },
] as const

// Build a server-style tree with depth ≤ 3. c5 is depth 2 (a reply to c2)
// to exercise the depth cap. c6 would be depth 3 (a reply to c5) → BE
// flattens it under c5 still (within cap), so it should be shown.
const FIXTURE_TREE = [
  {
    ...FIXTURE_ITEMS[0],
    replies: [
      { ...FIXTURE_ITEMS[1], replies: [] },
      { ...FIXTURE_ITEMS[2], replies: [] },
    ],
  },
  // deleted root — non-admin filter drops it.
  { ...FIXTURE_ITEMS[3], replies: [] },
]

vi.mock('@/features/comments/api', () => ({
  listComments: () =>
    Promise.resolve({
      items: FIXTURE_ITEMS,
      tree: FIXTURE_TREE,
      by_anchor: {},
    }),
  createComment: () => Promise.resolve({}),
  patchComment: () => Promise.resolve({}),
  deleteComment: () => Promise.resolve(undefined),
  resolveThread: () => Promise.resolve({}),
  searchMentionUsers: () => Promise.resolve([]),
}))

vi.mock('@/features/auth/store', () => ({
  useAuthStore: Object.assign(
    (selector: (s: { user: { id: string; role: string } | null }) => unknown) =>
      selector({ user: { id: 'u1', role: 'editor' } }),
    {
      getState: () => ({ user: { id: 'u1', role: 'editor' } }),
      setState: () => {},
    },
  ),
}))

import { CommentsThread } from '../components/CommentsThread'

function render(node: React.ReactNode): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  // Pre-populate the cache so the SSR render has the data without going
  // through useQuery's async loading path.
  qc.setQueryData(['comments', 'doc-foo'], {
    items: FIXTURE_ITEMS,
    tree: FIXTURE_TREE,
    by_anchor: {},
  })
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('<CommentsThread />', () => {
  it('renders parent + replies and hides soft-deleted comments for non-admins', () => {
    const html = render(<CommentsThread slug="doc-foo" />)
    expect(html).toContain('첫번째 댓글입니다')
    expect(html).toContain('답글 하나')
    expect(html).toContain('답글 둘')
    expect(html).not.toContain('비밀') // deleted body hidden
    expect(html).toContain('댓글')
  })

  it('shows the comments count badge based on visible items', () => {
    const html = render(<CommentsThread slug="doc-foo" />)
    // 3 visible (parent + 2 replies); deleted excluded.
    expect(html).toMatch(/data-testid="comments-count"[^>]*>3</)
  })

  it('renders @-mentions in the body as a chip', () => {
    const html = render(<CommentsThread slug="doc-foo" />)
    expect(html).toContain('data-testid="mention-chip"')
    expect(html).toContain('@Bob')
  })

  it('exposes a thread-level resolve button on root comments only', () => {
    const html = render(<CommentsThread slug="doc-foo" />)
    // exactly one root → exactly one resolve button visible (the deleted
    // root is filtered out for non-admins).
    const matches = html.match(/data-testid="comment-resolve"/g) ?? []
    expect(matches.length).toBe(1)
  })

  it('marks reply rows with depth attribute and indents them', () => {
    const html = render(<CommentsThread slug="doc-foo" />)
    expect(html).toContain('data-depth="0"')
    expect(html).toContain('data-depth="1"')
  })
})
