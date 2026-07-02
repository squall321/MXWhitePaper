// loadRelationships 순수 로직 테스트 — 방향분리(subject=나가는/object=들어오는) + degrade
import { describe, it, expect, vi } from 'vitest'
import { loadRelationships } from '../useRelationships'
import type { Triple } from '../triplesApi'

function mk(p: Partial<Triple>): Triple {
  return {
    id: Math.random().toString(36).slice(2),
    subject_slug: 'a', predicate: 'p', object_slug: 'b',
    source: 'manual', confidence: null, created_by: null, created_at: null,
    inverse_predicate: null, ...p,
  }
}

describe('loadRelationships', () => {
  it('subject= 는 outgoing, object= 는 incoming 으로 분리한다', async () => {
    const out = [mk({ subject_slug: 'me', object_slug: 'x', predicate: '인용한다' })]
    const inc = [mk({ subject_slug: 'y', object_slug: 'me', inverse_predicate: '에 인용된다' })]
    const fetch = vi.fn(async (q: { subject?: string; object?: string }) =>
      q.subject ? out : q.object ? inc : [],
    )
    const r = await loadRelationships('me', fetch)
    expect(r.outgoing).toEqual(out)
    expect(r.incoming).toEqual(inc)
    expect(fetch).toHaveBeenCalledWith({ subject: 'me' })
    expect(fetch).toHaveBeenCalledWith({ object: 'me' })
  })

  it('한쪽 fetch 가 실패해도 다른 방향은 degrade 로 살린다', async () => {
    const inc = [mk({ subject_slug: 'y', object_slug: 'me' })]
    const fetch = vi.fn(async (q: { subject?: string; object?: string }) => {
      if (q.subject) throw new Error('boom')
      return inc
    })
    const r = await loadRelationships('me', fetch)
    expect(r.outgoing).toEqual([]) // 실패 방향은 빈 목록
    expect(r.incoming).toEqual(inc) // 성공 방향은 유지
  })

  it('양쪽 모두 실패하면 빈 관계', async () => {
    const fetch = vi.fn(async () => { throw new Error('down') })
    const r = await loadRelationships('me', fetch)
    expect(r).toEqual({ outgoing: [], incoming: [] })
  })
})
