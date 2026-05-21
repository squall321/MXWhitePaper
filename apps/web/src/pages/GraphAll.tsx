/**
 * 전체 지식그래프 페이지 — `/graph/all`.
 *
 * 모든 wiki 노드/엣지를 한 번에 펼쳐서 도메인 간 군집 구조를 멀리서도 볼 수
 * 있게 한다. degree 가 큰 노드일수록 원이 크게 그려지고, KnowledgeGraph 의
 * `hugeSpread` 모드로 캔버스 끝까지 시원하게 흩뜨림.
 *
 * BE 의 `/api/v1/links/graph?limit=N` 호출 — 전역 경로는 degree 상위 N 개
 * doc 노드 + 그 사이 wiki 엣지를 반환한다 (root/domain 미지정 시).
 */
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { KnowledgeGraph } from '@/features/graph/components/KnowledgeGraph'
import { fetchGraph } from '@/features/graph/api'

const ALL_LIMIT = 5000

export function GraphAllPage() {
  const navigate = useNavigate()
  const { data, isPending, isError, error } = useQuery({
    queryKey: ['graph-all', ALL_LIMIT],
    queryFn: () => fetchGraph({ limit: ALL_LIMIT }),
    staleTime: 60_000,
  })

  return (
    <div className="space-y-3 p-3" data-testid="graph-all-page">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-smsg-900">
            전체 지식그래프
          </h1>
          <p className="text-xs text-gray-500">
            {data
              ? `노드 ${data.nodes.length} · 엣지 ${data.edges.length} — degree 상위 ${ALL_LIMIT} 까지 로드`
              : '전체 wiki 의존성 양상 — degree 가 클수록 원이 큼.'}
          </p>
        </div>
      </header>

      {isPending ? (
        <p className="text-sm text-gray-500">전체 그래프 불러오는 중…</p>
      ) : isError ? (
        <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          그래프를 불러오지 못했습니다: {(error as Error).message}
        </p>
      ) : !data || data.nodes.length === 0 ? (
        <p className="text-sm text-gray-500">표시할 노드가 없습니다.</p>
      ) : (
        <KnowledgeGraph
          nodes={data.nodes}
          edges={data.edges}
          height={Math.max(640, window.innerHeight - 200)}
          hugeSpread
          onPickNode={(s) => navigate(`/docs/${encodeURIComponent(s)}`)}
        />
      )}

      <p className="text-[11px] text-gray-500">
        스크롤로 줌, 드래그로 이동. 노드 호버 시 1-hop 이웃만 색칠.
        멀리서 봤을 때 군집/허브 구조가 보이도록 척력을 강하게 줬다.
      </p>
    </div>
  )
}

export default GraphAllPage
