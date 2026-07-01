// 한 문서의 의미 관계(triple)를 나가는/들어오는 방향으로 묶어 주는 query 훅
import { useQuery } from '@tanstack/react-query'
import { fetchTriples, type Triple } from './triplesApi'
import type { Slug } from '@/types/document'

export interface DocRelationships {
  /** 이 문서가 subject 인 엣지 (이 문서 → 상대). predicate 로 설명. */
  outgoing: Triple[]
  /** 이 문서가 object 인 엣지 (상대 → 이 문서). inverse_predicate 로 설명. */
  incoming: Triple[]
}

/**
 * 문서의 양방향 관계를 한 번에 가져온다. BE 의 `/triples?subject=` (나가는) 와
 * `/triples?object=` (들어오는) 를 병렬 호출해 합친다. best-effort — 실패 시
 * 빈 목록으로 degrade (관계 패널이 문서 보기를 막지 않게).
 */
export function useRelationships(slug: Slug | undefined) {
  return useQuery<DocRelationships>({
    queryKey: ['relationships', slug],
    enabled: !!slug,
    queryFn: async () => {
      if (!slug) return { outgoing: [], incoming: [] }
      const [outgoing, incoming] = await Promise.all([
        fetchTriples({ subject: slug }).catch(() => [] as Triple[]),
        fetchTriples({ object: slug }).catch(() => [] as Triple[]),
      ])
      return { outgoing, incoming }
    },
  })
}
