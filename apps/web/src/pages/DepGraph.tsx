/**
 * Doc Dependency Graph page (Cycle 7).
 *
 *   /dep-graph?root=<slug>
 *
 * Force-directed visualisation of inter-document wiki-link dependency. Differs
 * from the older `/graph` page in that:
 *   - Reuses the `dep-graph` BE which walks `content_json` directly (so newly
 *     added [[slug]] links show up even if the `links` table hasn't been
 *     resynced).
 *   - Adds a sidebar — depth slider 1-4, "고아 문서 보기" toggle.
 *   - Hover shows tooltip (title + slug + count_in/out); click navigates to
 *     `/docs/<slug>`.
 *
 * Layout note: the mandate asked for cytoscape + cose-bilkent (transitively
 * pulled in by `mermaid`). pnpm strict resolution doesn't expose those to
 * `apps/web` without declaring them as direct deps, so we fall back to
 * `d3-force` (already a direct dep, and the same module the older `/graph`
 * page uses). See the report for the cose-bilkent flag.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  forceCenter,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force'
import { select } from 'd3-selection'
import { zoom, zoomIdentity, type ZoomBehavior } from 'd3-zoom'
import {
  fetchDepGraph,
  fetchOrphans,
  type DepGraphEdge,
  type DepGraphNode,
} from '@/features/dep-graph/api'

const WIDTH = 800
const HEIGHT = 600

interface SimNode extends SimulationNodeDatum {
  slug: string
  title: string
  countIn: number
  countOut: number
  isRoot: boolean
}

type SimLink = SimulationLinkDatum<SimNode> & { count: number }

export interface DepGraphCanvasProps {
  nodes: DepGraphNode[]
  edges: DepGraphEdge[]
  rootSlug: string
  onPickNode?: (slug: string) => void
}

/** Pure rendering layer — exported so vitest can render without the data
 *  fetch path. Mirrors the SSR pattern used by `/graph`'s `GraphCanvas`. */
export function DepGraphCanvas({
  nodes: rawNodes,
  edges: rawEdges,
  rootSlug,
  onPickNode,
}: DepGraphCanvasProps) {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const gRef = useRef<SVGGElement | null>(null)
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null)

  const { nodes, links } = useMemo<{ nodes: SimNode[]; links: SimLink[] }>(
    () => ({
      nodes: rawNodes.map((n) => ({
        slug: n.slug,
        title: n.title,
        countIn: n.count_in,
        countOut: n.count_out,
        isRoot: n.slug === rootSlug,
      })),
      links: rawEdges.map((e) => ({
        source: e.from,
        target: e.to,
        count: e.count,
      })),
    }),
    [rawNodes, rawEdges, rootSlug],
  )

  useEffect(() => {
    if (!gRef.current) return
    const g = select(gRef.current)
    const sim = forceSimulation<SimNode>(nodes)
      .force(
        'link',
        forceLink<SimNode, SimLink>(links)
          .id((d) => d.slug)
          .distance(90)
          .strength(0.5),
      )
      .force('charge', forceManyBody<SimNode>().strength(-200))
      .force('center', forceCenter(WIDTH / 2, HEIGHT / 2))

    simRef.current = sim

    const linkSel = g
      .select<SVGGElement>('g.links')
      .selectAll<SVGLineElement, SimLink>('line')
      .data(
        links,
        (d) =>
          `${(d.source as SimNode).slug ?? d.source}->${(d.target as SimNode).slug ?? d.target}`,
      )
      .join('line')
      .attr('stroke', '#94a3b8')
      .attr('stroke-opacity', 0.7)
      .attr('stroke-width', (d) => 1 + Math.min(d.count, 4))

    const nodeSel = g
      .select<SVGGElement>('g.nodes')
      .selectAll<SVGGElement, SimNode>('g.node')
      .data(nodes, (d) => d.slug)
      .join((enter) => {
        const ng = enter
          .append('g')
          .attr('class', 'node')
          .attr('data-slug', (d) => d.slug)
          .style('cursor', 'pointer')
        ng.append('circle')
          .attr('r', (d) => 6 + Math.min(d.countIn, 8))
          .attr('fill', (d) => (d.isRoot ? '#0c4a6e' : '#0ea5e9'))
          .attr('stroke', '#fff')
          .attr('stroke-width', 1.5)
        ng.append('title').text(
          (d) =>
            `${d.title} (${d.slug}) — in:${d.countIn} out:${d.countOut}`,
        )
        ng.append('text')
          .attr('dx', 11)
          .attr('dy', 4)
          .attr('font-size', 11)
          .attr('fill', '#1f2937')
          .text((d) => d.title)
        return ng
      })

    nodeSel.on('click', (_, d) => {
      if (onPickNode) onPickNode(d.slug)
    })

    sim.on('tick', () => {
      linkSel
        .attr('x1', (d) => (d.source as SimNode).x ?? 0)
        .attr('y1', (d) => (d.source as SimNode).y ?? 0)
        .attr('x2', (d) => (d.target as SimNode).x ?? 0)
        .attr('y2', (d) => (d.target as SimNode).y ?? 0)
      nodeSel.attr('transform', (d) => `translate(${d.x ?? 0},${d.y ?? 0})`)
    })

    return () => {
      sim.stop()
      simRef.current = null
    }
  }, [nodes, links, onPickNode])

  // Pan + zoom (cytoscape would give this for free; with d3 we wire it
  // explicitly).
  useEffect(() => {
    if (!svgRef.current || !gRef.current) return
    const svg = select<SVGSVGElement, unknown>(svgRef.current)
    const inner = select<SVGGElement, unknown>(gRef.current)
    const z: ZoomBehavior<SVGSVGElement, unknown> = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 4])
      .on('zoom', (event) => {
        inner.attr('transform', event.transform.toString())
      })
    svg.call(z)
    svg.call(z.transform, zoomIdentity)
    return () => {
      svg.on('.zoom', null)
    }
  }, [])

  return (
    <svg
      ref={svgRef}
      data-testid="dep-graph-svg"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="xMidYMid meet"
      className="h-[600px] w-full rounded border border-gray-200 bg-white"
    >
      <g ref={gRef}>
        <g className="links" />
        <g className="nodes" />
      </g>
    </svg>
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
  const [depth, setDepth] = useState(2)
  const [showOrphans, setShowOrphans] = useState(false)
  // Search input — only used when no root is in the URL.
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
          스크롤로 줌, 드래그로 이동, 노드 클릭으로 문서 열기. 노드 라벨에
          마우스를 올리면 in/out 카운트가 보입니다.
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
