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

/** fetchTriples 시그니처 — 테스트에서 주입 가능하게 최소 타입만. */
type FetchTriplesFn = (p: { subject?: string; object?: string }) => Promise<Triple[]>

/**
 * subject=(나가는)/object=(들어오는) 를 병렬 조회해 합친다. 한쪽 fetch 가
 * 실패해도 다른 방향은 살리는 best-effort degrade (관계 패널이 문서 보기를
 * 막지 않게). 순수 async — 훅과 분리해 방향분리/degrade 를 직접 테스트한다.
 */
export async function loadRelationships(
  slug: string,
  fetch: FetchTriplesFn = fetchTriples,
): Promise<DocRelationships> {
  const [outgoing, incoming] = await Promise.all([
    fetch({ subject: slug }).catch(() => [] as Triple[]),
    fetch({ object: slug }).catch(() => [] as Triple[]),
  ])
  return { outgoing, incoming }
}

/**
 * 문서의 양방향 관계를 한 번에 가져오는 query 훅. 데이터 로딩은
 * {@link loadRelationships} 에 위임.
 */
export function useRelationships(slug: Slug | undefined) {
  return useQuery<DocRelationships>({
    queryKey: ['relationships', slug],
    enabled: !!slug,
    queryFn: () => loadRelationships(slug as string),
  })
}
