/**
 * Wiki Graph page (Tier 2C).
 *
 * Force-directed visualisation of inter-document wiki links.
 *
 *   - Lazy-loaded: this module imports `d3-force` / `d3-zoom`, which is a
 *     non-trivial bundle, so the route in `main.tsx` wraps it in `lazy()`.
 *   - Renders an 800×600 (responsive) SVG, panned + zoomed via `d3-zoom`.
 *   - Edge thickness scales with `count`; missing nodes are coloured red.
 *   - Limits the visible set to the top 50 nodes by degree to keep the
 *     simulation cheap and the layout legible.
 *   - A search box highlights matching nodes (slug or title contains query).
 *   - Clicking a node navigates to `/docs/<slug>` (only for non-missing).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force'
import { select } from 'd3-selection'
import { zoom, zoomIdentity, type ZoomBehavior } from 'd3-zoom'
import { fetchGraph, type GraphEdge, type GraphNode } from '@/features/graph/api'

interface SimNode extends SimulationNodeDatum {
  slug: string
  title: string
  status: string
  degree: number
  isMissing: boolean
}

type SimLink = SimulationLinkDatum<SimNode> & { count: number }

const WIDTH = 800
const HEIGHT = 600
const MAX_NODES = 50

function buildSim(
  rawNodes: GraphNode[],
  rawEdges: GraphEdge[],
): { nodes: SimNode[]; links: SimLink[] } {
  // Degree map across the full payload first.
  const deg = new Map<string, number>()
  for (const e of rawEdges) {
    deg.set(e.source, (deg.get(e.source) ?? 0) + e.count)
    deg.set(e.target, (deg.get(e.target) ?? 0) + e.count)
  }
  const sorted = [...rawNodes].sort(
    (a, b) => (deg.get(b.slug) ?? 0) - (deg.get(a.slug) ?? 0),
  )
  const top = sorted.slice(0, MAX_NODES)
  const keep = new Set(top.map((n) => n.slug))

  const nodes: SimNode[] = top.map((n) => ({
    slug: n.slug,
    title: n.title,
    status: n.status,
    degree: deg.get(n.slug) ?? 0,
    isMissing: n.status === 'missing',
  }))
  const links: SimLink[] = rawEdges
    .filter((e) => keep.has(e.source) && keep.has(e.target))
    .map((e) => ({ source: e.source, target: e.target, count: e.count }))
  return { nodes, links }
}

export interface GraphCanvasProps {
  nodes: GraphNode[]
  edges: GraphEdge[]
  highlight?: string
  /** BFS root slug — 별도 색 + 더 큰 노드로 강조. */
  rootSlug?: string | null
  onPickNode?: (slug: string) => void
}

/** Pure rendering layer — exported so unit tests can render it without
 *  the data-fetching layer. */
export function GraphCanvas({
  nodes: rawNodes,
  edges: rawEdges,
  highlight,
  rootSlug,
  onPickNode,
}: GraphCanvasProps) {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const gRef = useRef<SVGGElement | null>(null)
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null)

  const { nodes, links } = useMemo(
    () => buildSim(rawNodes, rawEdges),
    [rawNodes, rawEdges],
  )

  // Force simulation tick — updates SVG attributes directly via d3-selection
  // for performance; React only owns the static SVG/g scaffolding.
  useEffect(() => {
    if (!gRef.current) return
    const g = select(gRef.current)
    const sim = forceSimulation<SimNode>(nodes)
      .force(
        'link',
        forceLink<SimNode, SimLink>(links)
          .id((d) => d.slug)
          .distance(160)   // 80 → 160: 노드 사이 거리 ↑
          .strength(0.35), // 0.6 → 0.35: 링크 인력 약화 → 더 퍼짐
      )
      // -180 → -600: repulse 강화 → 글자 겹침 ↓
      .force('charge', forceManyBody<SimNode>().strength(-600).distanceMax(400))
      // collide: 노드 ellipse 가 안 겹치게. rx 와 일관 + 약간 buffer.
      // truncated label 의 가시 너비 기준 — 18 글자 cap.
      .force(
        'collide',
        forceCollide<SimNode>((d) => {
          const visibleLen = Math.min(d.title.length, 18)
          return Math.min(90, Math.max(32, visibleLen * 7 + 8)) + 8
        }).strength(0.9),
      )
      .force('center', forceCenter(WIDTH / 2, HEIGHT / 2))

    simRef.current = sim

    const linksG = g.select<SVGGElement>('g.links')
    linksG.selectAll('*').remove()
    const linkSel = linksG
      .selectAll<SVGLineElement, SimLink>('line')
      .data(links, (d) => `${(d.source as SimNode).slug ?? d.source}->${(d.target as SimNode).slug ?? d.target}`)
      .join('line')
      .attr('stroke', '#94a3b8')
      .attr('stroke-opacity', 0.7)
      .attr('stroke-width', (d) => 1 + Math.min(d.count, 5))

    // 노드 ellipse — 가시성:
    //  - rx (가로) 는 라벨 너비 기준
    //  - ry (세로) 는 18~28 사이로 rx/ry aspect ratio 가 너무 길쭉하지 않게
    //  - rx 자체도 최대 90 으로 cap — 그 이상은 라벨 truncate
    const MAX_LABEL_CHARS = 18    // 한글 18글자 정도면 충분
    const MIN_RX = 32
    const MAX_RX = 90
    const MIN_RY = 18
    const MAX_RY = 28

    const labelFor = (d: SimNode) => {
      if (d.title.length <= MAX_LABEL_CHARS) return d.title
      return d.title.slice(0, MAX_LABEL_CHARS - 1) + '…'
    }

    const radiusFor = (d: SimNode) => {
      const label = labelFor(d)
      const base = Math.max(MIN_RX, label.length * 7 + 8)
      const capped = Math.min(MAX_RX, base)
      return d.slug === rootSlug ? Math.min(MAX_RX, capped + 8) : capped
    }

    // ry: rx 의 1/3 ~ 1/2.5 비율 사이, MIN_RY~MAX_RY 안. 길쭉 방지.
    const ryFor = (d: SimNode) => {
      const rx = radiusFor(d)
      const desired = Math.max(MIN_RY, Math.min(MAX_RY, rx / 2.8))
      return d.slug === rootSlug ? Math.min(MAX_RY, desired + 4) : desired
    }

    // 색 결정: root → 주황, missing → 빨강, 일반 → 진청
    const fillFor = (d: SimNode) =>
      d.slug === rootSlug ? '#f59e0b'
      : d.isMissing ? '#dc2626'
      : '#0c4a6e'

    // 기존 노드 (stale circle 등) 모두 제거하고 fresh build — 데이터 / rootSlug 변경 시
    // ellipse + 내부 text 가 깨끗하게 다시 그려지게.
    const nodesG = g.select<SVGGElement>('g.nodes')
    nodesG.selectAll('*').remove()

    const nodeSel = nodesG
      .selectAll<SVGGElement, SimNode>('g.node')
      .data(nodes, (d) => d.slug)
      .join((enter) => {
        const ng = enter.append('g').attr('class', 'node').style('cursor', 'pointer')
        ng.append('ellipse')
          .attr('rx', (d) => radiusFor(d))
          .attr('ry', (d) => ryFor(d))
          .attr('fill', fillFor)
          .attr('stroke', '#fff')
          .attr('stroke-width', 2)
        ng.append('title').text((d) => `${d.title} (${d.slug})`)  // 풀 title 은 hover tooltip
        ng.append('text')
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'middle')
          .attr('dy', 1)
          .attr('font-size', 12)
          .attr('font-weight', (d) => (d.slug === rootSlug ? 700 : 500))
          .attr('fill', '#ffffff')
          .attr('pointer-events', 'none')
          .text(labelFor)
        return ng
      })

    nodeSel.on('click', (_, d) => {
      if (!d.isMissing && onPickNode) onPickNode(d.slug)
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

  // Highlight effect — overlay opacity instead of restarting the simulation.
  useEffect(() => {
    if (!gRef.current) return
    const g = select(gRef.current)
    const q = (highlight ?? '').trim().toLowerCase()
    g.selectAll<SVGGElement, SimNode>('g.node')
      .style('opacity', (d) =>
        !q || d.slug.toLowerCase().includes(q) || d.title.toLowerCase().includes(q)
          ? 1
          : 0.2,
      )
  }, [highlight, nodes])

  // Pan + zoom.
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
      data-testid="graph-svg"
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

export function GraphPage() {
  const { slug } = useParams<{ slug?: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')

  // BFS depth — URL ?depth=N 로 공유 가능, 1~4 (BE 가 강제). default 2.
  const rawDepth = parseInt(searchParams.get('depth') ?? '2', 10)
  const depth = Number.isFinite(rawDepth) && rawDepth >= 1 && rawDepth <= 4 ? rawDepth : 2

  const setDepth = (d: number) => {
    const next = new URLSearchParams(searchParams)
    next.set('depth', String(d))
    setSearchParams(next, { replace: true })
  }

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['graph', slug ?? '__global__', depth],
    queryFn: () => fetchGraph(slug ?? null, depth),
    staleTime: 30_000,
  })

  return (
    <div className="space-y-3" data-testid="graph-page">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-smsg-900">위키 그래프</h1>
          <p className="text-xs text-gray-500">
            {slug ? `루트: ${slug} · 깊이 ${depth}` : '전역 그래프 (degree 상위 50)'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {slug && (
            <label className="flex items-center gap-1 text-xs text-gray-600">
              깊이
              <select
                value={depth}
                onChange={(e) => setDepth(parseInt(e.target.value, 10))}
                aria-label="그래프 깊이"
                data-testid="graph-depth"
                className="rounded border border-gray-200 bg-white px-1 py-1 text-sm focus:border-smsg-500 focus:outline-none"
              >
                <option value={1}>1</option>
                <option value={2}>2</option>
                <option value={3}>3</option>
                <option value={4}>4</option>
              </select>
            </label>
          )}
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="노드 검색…"
            aria-label="노드 검색"
            data-testid="graph-search"
            className="w-48 rounded border border-gray-200 bg-white px-2 py-1 text-sm focus:border-smsg-500 focus:outline-none"
          />
        </div>
      </header>

      {isPending ? (
        <p className="text-sm text-gray-500">불러오는 중…</p>
      ) : isError ? (
        <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          그래프를 불러오지 못했습니다: {(error as Error).message}
        </p>
      ) : !data ? (
        <p className="text-sm text-gray-500">데이터 없음.</p>
      ) : data.nodes.length === 0 ? (
        <p className="text-sm text-gray-500">표시할 노드가 없습니다.</p>
      ) : (
        <GraphCanvas
          nodes={data.nodes}
          edges={data.edges}
          highlight={query}
          rootSlug={slug ?? null}
          onPickNode={(s) => navigate(`/docs/${encodeURIComponent(s)}`)}
        />
      )}

      <p className="text-[11px] text-gray-500">
        스크롤로 줌, 드래그로 이동, 노드 클릭으로 문서 열기. 빨간 노드는 아직 작성되지 않은
        링크입니다.
      </p>
    </div>
  )
}

export default GraphPage
