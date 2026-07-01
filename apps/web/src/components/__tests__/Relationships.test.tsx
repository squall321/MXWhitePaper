// 관계 패널 렌더 테스트 — 나가는(predicate)/들어오는(inverse fallback)/빈 상태 숨김
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Triple } from '@/features/graph/triplesApi'

// fetchTriples 를 subject/object 필터에 따라 다른 목록을 돌려주도록 stub.
const rels = {
  current: { outgoing: [] as Triple[], incoming: [] as Triple[] },
}
vi.mock('@/features/graph/triplesApi', () => ({
  fetchTriples: vi.fn(async (p: { subject?: string; object?: string } = {}) => {
    if (p.subject) return rels.current.outgoing
    if (p.object) return rels.current.incoming
    return []
  }),
}))

import { Relationships } from '../Relationships'

function mk(partial: Partial<Triple>): Triple {
  return {
    id: Math.random().toString(36).slice(2),
    subject_slug: 'a', predicate: 'p', object_slug: 'b',
    source: 'manual', confidence: null, created_by: null, created_at: null,
    inverse_predicate: null, ...partial,
  }
}

async function render(): Promise<string> {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  // useQuery 를 즉시 resolve 시키려고 prefetch.
  await qc.prefetchQuery({
    queryKey: ['relationships', 'doc-x'],
    queryFn: async () => rels.current,
  })
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Relationships slug={'doc-x' as never} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  rels.current = { outgoing: [], incoming: [] }
})

describe('Relationships 패널', () => {
  it('관계가 없으면 패널을 숨긴다', async () => {
    const html = await render()
    expect(html).not.toContain('관계')
  })

  it('나가는 관계는 predicate 로 표시한다', async () => {
    rels.current.outgoing = [mk({ subject_slug: 'doc-x', object_slug: 'target', predicate: '인용한다' })]
    const html = await render()
    expect(html).toContain('→ 나가는 관계')
    expect(html).toContain('인용한다')
    expect(html).toContain('target')
  })

  it('들어오는 관계는 inverse_predicate 로 표시한다', async () => {
    rels.current.incoming = [mk({ subject_slug: 'src', object_slug: 'doc-x', predicate: '인용한다', inverse_predicate: '에 인용된다' })]
    const html = await render()
    expect(html).toContain('← 들어오는 관계')
    expect(html).toContain('에 인용된다')
    expect(html).toContain('src')
  })

  it('inverse 가 없으면 generic fallback 을 쓴다', async () => {
    rels.current.incoming = [mk({ subject_slug: 'src2', object_slug: 'doc-x', inverse_predicate: null })]
    const html = await render()
    expect(html).toContain('의 관련 문서')
  })
})
