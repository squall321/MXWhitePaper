/**
 * Doc Dependency Graph page.
 *
 *   /dep-graph?root=<slug>
 *
 * Wiki-link 의존성 시각화. 이전 cycle (16/20) 은 d3-force + cytoscape 였으나
 * cycle 21 에서 sigma.js 기반 `KnowledgeGraph` 로 통일했다 — 메인 `/graph`
 * 및 `TodayHero` 와 동일 렌더러를 쓰면서 시각/인터랙션 (드래그 chase, 1-hop
 * hover, push-away 물리) 을 공유.
 *
 *   - BE 는 `/dep-graph?root_slug=...&depth=N` 그대로 사용 (content_json 직접
 *     walk → links 테이블 sync 와 무관하게 즉시 반영).
 *   - Sidebar — depth slider 1-4, "고아 문서 보기" toggle.
 *   - 노드 클릭 → `/docs/<slug>` 로 이동.
 *
 * 데이터 형태 차이 어댑터
 * -----------------------
 * `DepGraphNode` 는 `{ slug, title, count_in, count_out }`, `DepGraphEdge` 는
 * `{ from, to, count }` 인 반면 `KnowledgeGraph` 는 `GraphNode/GraphEdge` —
 * 후자에 맞게 변환만 한다. `count_in/out` 은 시각화에 안 쓰니 drop.
 */
import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { KnowledgeGraph } from '@/features/graph/components/KnowledgeGraph'
import type { GraphEdge, GraphNode } from '@/features/graph/api'
import {
  fetchDepGraph,
  fetchOrphans,
  type DepGraphEdge,
  type DepGraphNode,
} from '@/features/dep-graph/api'

export interface DepGraphCanvasProps {
  nodes: DepGraphNode[]
  edges: DepGraphEdge[]
  rootSlug: string
  onPickNode?: (slug: string) => void
}

/** Pure rendering layer — `DepGraphNode/Edge` → `GraphNode/GraphEdge` 어댑팅 후
 *  공용 `KnowledgeGraph` 에 위임. test 가 의존하는 `dep-graph-svg` marker 를
 *  외곽 div 에 그대로 보존 (SSR snapshot 호환). */
export function DepGraphCanvas({
  nodes: rawNodes,
  edges: rawEdges,
  rootSlug,
  onPickNode,
}: DepGraphCanvasProps) {
  const { nodes, edges } = useMemo<{ nodes: GraphNode[]; edges: GraphEdge[] }>(
    () => ({
      nodes: rawNodes.map<GraphNode>((n) => ({
        kind: 'doc',
        slug: n.slug,
        title: n.title,
        status: 'active',
        group: null,
      })),
      edges: rawEdges.map<GraphEdge>((e) => ({
        kind: 'wiki',
        source: e.from,
        target: e.to,
        count: e.count,
      })),
    }),
    [rawNodes, rawEdges],
  )

  return (
    <div className="relative" data-testid="dep-graph-svg">
      <KnowledgeGraph
        nodes={nodes}
        edges={edges}
        rootSlug={rootSlug}
        height={760}
        onPickNode={onPickNode}
      />
    </div>
  )
}

/** Sidebar — depth slider + 고아 문서 viewer. Pulled out so it can render
 *  while the canvas is loading. */
function DepGraphSidebar({
  depth,
  onDepthChange,
  showOrphans,
  onToggleOrphans,
}: {
  depth: number
  onDepthChange: (d: number) => void
  showOrphans: boolean
  onToggleOrphans: () => void
}) {
  return (
    <aside
      className="space-y-4 rounded border border-gray-200 bg-white p-3 text-sm"
      data-testid="dep-graph-sidebar"
    >
      <div>
        <label
          className="block text-xs font-medium text-gray-600"
          htmlFor="dep-graph-depth"
        >
          깊이: {depth}
        </label>
        <input
          id="dep-graph-depth"
          type="range"
          min={1}
          max={4}
          step={1}
          value={depth}
          onChange={(e) => onDepthChange(Number(e.target.value))}
          className="mt-1 w-full"
          data-testid="dep-graph-depth-slider"
        />
      </div>
      <button
        type="button"
        onClick={onToggleOrphans}
        className="w-full rounded border border-gray-300 bg-gray-50 px-2 py-1 text-xs text-gray-700 hover:bg-gray-100"
        data-testid="dep-graph-orphans-toggle"
      >
        {showOrphans ? '그래프로 돌아가기' : '고아 문서 보기'}
      </button>
    </aside>
  )
}

function OrphansList() {
  const { data, isPending, isError, error } = useQuery({
    queryKey: ['dep-graph-orphans'],
    queryFn: fetchOrphans,
    staleTime: 60_000,
  })
  if (isPending) return <p className="text-sm text-gray-500">불러오는 중…</p>
  if (isError)
    return (
      <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
        고아 문서 목록을 불러오지 못했습니다: {(error as Error).message}
      </p>
    )
  if (!data || data.length === 0)
    return (
      <p className="text-sm text-gray-500">고아 문서가 없습니다 (모두 참조됨).</p>
    )
  return (
    <ul className="divide-y divide-gray-100 rounded border border-gray-200 bg-white">
      {data.map((row) => (
        <li
          key={row.slug}
          className="px-3 py-2 text-sm"
          data-testid={`dep-graph-orphan-${row.slug}`}
        >
          <Link
            to={`/docs/${encodeURIComponent(row.slug)}`}
            className="text-smsg-700 hover:underline"
          >
            {row.title}
          </Link>
          <span className="ml-2 font-mono text-[11px] text-gray-400">
            /{row.slug}
          </span>
        </li>
      ))}
    </ul>
  )
}

export function DepGraphPage() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const root = params.get('root') ?? ''
  const [depth, setDepth] = useState(1)
  const [showOrphans, setShowOrphans] = useState(false)
  const [draftRoot, setDraftRoot] = useState('')

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['dep-graph', root, depth],
    queryFn: () => fetchDepGraph(root, depth),
    staleTime: 30_000,
    enabled: !!root && !showOrphans,
  })

  return (
    <div
      className="grid gap-4 lg:grid-cols-[1fr_240px]"
      data-testid="dep-graph-page"
    >
      <main className="space-y-3">
        <header className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-lg font-semibold text-smsg-900">
              문서 의존성 그래프
            </h1>
            <p className="text-xs text-gray-500">
              {root
                ? `루트: ${root} · 깊이 ${depth}`
                : '루트 슬러그를 입력해 그래프를 시작하세요.'}
            </p>
          </div>
          {/* triple 표시 토글 — /dep-graph endpoint 는 아직 의미 엣지를 반환하지
              않는다 (content_json wiki link 만 walk). BE 가 include_triples 를
              지원하면 활성화. 그때까지 disabled 로 노출만 유지 (/graph 와 일관성). */}
          <label
            className="flex items-center gap-1.5 text-xs text-gray-400"
            title="의존성 그래프 endpoint 는 아직 triple 을 지원하지 않습니다"
          >
            <input
              type="checkbox"
              checked={false}
              disabled
              readOnly
              aria-label="triple 표시 (지원 예정)"
              data-testid="dep-graph-triple-toggle"
              className="h-3.5 w-3.5"
            />
            🔗 triple
          </label>
          <Link
            to="/graph/all"
            data-testid="dep-graph-all-link"
            title="전체 지식그래프 보기"
            className="rounded border border-smsg-200 bg-smsg-50 px-2 py-1 text-xs text-smsg-800 hover:bg-smsg-100"
          >
            🌐 전체 보기
          </Link>
          {!root && (
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                if (draftRoot.trim()) {
                  setParams({ root: draftRoot.trim() })
                }
              }}
            >
              <input
                type="search"
                value={draftRoot}
                onChange={(e) => setDraftRoot(e.target.value)}
                placeholder="문서 슬러그…"
                aria-label="루트 슬러그"
                data-testid="dep-graph-root-input"
                className="w-56 rounded border border-gray-200 bg-white px-2 py-1 text-sm focus:border-smsg-500 focus:outline-none"
              />
              <button
                type="submit"
                className="rounded bg-smsg-700 px-3 py-1 text-xs text-white hover:bg-smsg-800"
              >
                그래프 보기
              </button>
            </form>
          )}
        </header>

        {showOrphans ? (
          <OrphansList />
        ) : !root ? (
          <p className="rounded border border-gray-200 bg-gray-50 px-3 py-6 text-center text-sm text-gray-500">
            루트 슬러그를 입력하면 양방향 BFS 로 의존성 그래프를 그립니다.
          </p>
        ) : isPending ? (
          <p className="text-sm text-gray-500">불러오는 중…</p>
        ) : isError ? (
          <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            그래프를 불러오지 못했습니다: {(error as Error).message}
          </p>
        ) : !data || data.nodes.length === 0 ? (
          <p className="text-sm text-gray-500">표시할 노드가 없습니다.</p>
        ) : (
          <DepGraphCanvas
            nodes={data.nodes}
            edges={data.edges}
            rootSlug={root}
            onPickNode={(s) => navigate(`/docs/${encodeURIComponent(s)}`)}
          />
        )}

        <p className="text-[11px] text-gray-500">
          스크롤로 줌, 드래그로 이동, 노드 클릭으로 문서 열기. 호버 시 직결된
          이웃이 강조됩니다.
        </p>
      </main>

      <DepGraphSidebar
        depth={depth}
        onDepthChange={setDepth}
        showOrphans={showOrphans}
        onToggleOrphans={() => setShowOrphans((v) => !v)}
      />
    </div>
  )
}

export default DepGraphPage
