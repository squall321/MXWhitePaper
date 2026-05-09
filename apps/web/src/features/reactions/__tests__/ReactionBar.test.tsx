import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { MyReactions, ReactionAggregate } from '../api'

// Stub the network so the SSR snapshot is fully deterministic.
const state = {
  agg: { doc: {}, blocks: {} } as ReactionAggregate,
  me: { doc: [], blocks: {} } as MyReactions,
}

vi.mock('@/features/reactions/api', async () => {
  const real = (await vi.importActual<typeof import('../api')>(
    '@/features/reactions/api',
  ))
  return {
    ...real,
    getReactionAggregate: vi.fn(async () => state.agg),
    getMyReactions: vi.fn(async () => state.me),
    toggleReaction: vi.fn(async () => ({
      removed: false,
      id: 'r1',
      document_id: 'd1',
      block_id: null,
      emoji: 'thumbs-up' as const,
    })),
  }
})

import { ReactionBar } from '../ReactionBar'
import { reactionAggKey, reactionMeKey } from '../hooks'

function render(node: React.ReactNode): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  // Pre-populate caches so SSR doesn't trigger the loading branch.
  qc.setQueryData(reactionAggKey('alpha'), state.agg)
  qc.setQueryData(reactionMeKey('alpha'), state.me)
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>{node}</QueryClientProvider>,
  )
}

describe('<ReactionBar />', () => {
  beforeEach(() => {
    state.agg = { doc: {}, blocks: {} }
    state.me = { doc: [], blocks: {} }
  })

  it('renders all five emoji buttons by default', () => {
    const html = render(<ReactionBar slug="alpha" documentId="d1" />)
    expect(html).toContain('data-testid="reaction-bar-doc"')
    expect(html).toContain('data-testid="reaction-thumbs-up"')
    expect(html).toContain('data-testid="reaction-heart"')
    expect(html).toContain('data-testid="reaction-thinking"')
    expect(html).toContain('data-testid="reaction-pray"')
    expect(html).toContain('data-testid="reaction-tada"')
  })

  it('shows count badges only when count > 0', () => {
    state.agg = { doc: { 'thumbs-up': 3 }, blocks: {} }
    const html = render(<ReactionBar slug="alpha" documentId="d1" />)
    expect(html).toContain('data-testid="reaction-count-thumbs-up"')
    expect(html).toMatch(/data-testid="reaction-count-thumbs-up"[^>]*>3</)
    // Other emojis have no count badge.
    expect(html).not.toContain('data-testid="reaction-count-heart"')
  })

  it('marks the user-reacted button as aria-pressed=true', () => {
    state.me = { doc: ['heart'], blocks: {} }
    const html = render(<ReactionBar slug="alpha" documentId="d1" />)
    // Heart should be highlighted (data-reacted="true"); others false.
    expect(html).toMatch(
      /data-testid="reaction-heart"[^>]*data-reacted="true"/,
    )
    expect(html).toMatch(
      /data-testid="reaction-thumbs-up"[^>]*data-reacted="false"/,
    )
  })

  it('emits a per-block bar when blockId is provided', () => {
    state.agg = { doc: {}, blocks: { 'b-1': { tada: 2 } } }
    const html = render(
      <ReactionBar slug="alpha" documentId="d1" blockId="b-1" />,
    )
    expect(html).toContain('data-testid="reaction-bar-block-b-1"')
    expect(html).toMatch(/data-testid="reaction-count-tada"[^>]*>2</)
  })

  it('hides untouched buttons in collapseEmpty mode', () => {
    state.agg = { doc: { heart: 1 }, blocks: {} }
    state.me = { doc: [], blocks: {} }
    const html = render(
      <ReactionBar slug="alpha" documentId="d1" collapseEmpty />,
    )
    // Only the heart (count > 0) should be rendered.
    expect(html).toContain('data-testid="reaction-heart"')
    expect(html).not.toContain('data-testid="reaction-thumbs-up"')
    expect(html).not.toContain('data-testid="reaction-tada"')
  })
})
