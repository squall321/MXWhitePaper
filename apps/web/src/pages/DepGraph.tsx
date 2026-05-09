/**
 * Doc Dependency Graph page.
 *
 *   /dep-graph?root=<slug>
 *
 * Force-directed visualisation of inter-document wiki-link dependency.
 *
 *   - Reuses the `dep-graph` BE which walks `content_json` directly so newly
 *     added [[slug]] links show up even if the `links` table hasn't been
 *     resynced.
 *   - Sidebar — depth slider 1-4, "고아 문서 보기" toggle.
 *   - Hover shows tooltip (title + slug + count_in/out); click navigates to
 *     `/docs/<slug>`.
 *
 * Layout / renderer
 * -----------------
 * Cycle 16 used d3-force because pnpm strict resolution did not expose
 * cytoscape (transitively in mermaid) to apps/web. Cycle 20 promotes
 * cytoscape + cytoscape-cose-bilkent to direct deps so we can use the
 * higher-quality cose-bilkent layout with built-in pan/zoom.
 *
 * The renderer dynamically imports cytoscape (it pulls a 600k chunk so
 * we keep it off the critical path). If the dynamic import fails — e.g.
 * a future strict CSP blocks the chunk, or the deps go missing in some
 * exotic build — we silently fall back to the legacy d3-force SVG path.
 * The `<svg data-testid="dep-graph-svg">` element is always rendered so
 * SSR/vitest snapshots stay stable; cytoscape paints into a sibling
 * `<div>` and we hide the SVG once it boots.
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
  const cyHostRef = useRef<HTMLDivElement | null>(null)
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null)
  // True once cytoscape has successfully mounted; we then hide the SVG
  // fallback. Stays false in SSR / when the dynamic import fails.
  const [usingCytoscape, setUsingCytoscape] = useState(false)

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

  // ── Cytoscape path ─────────────────────────────────────────────────────
  // Tries the cose-bilkent layout first; if either dependency fails to
  // import we leave `usingCytoscape` false and the d3-force effect below
  // takes over. Both deps are dynamic-imported so the chunk loads only
  // when /dep-graph is visited.
  useEffect(() => {
    if (!cyHostRef.current) return
    let cancelled = false
    let cy: {
      destroy: () => void
      on: (ev: string, sel: string, cb: (evt: { target: { id: () => string } }) => void) => void
    } | null = null
    void (async () => {
      try {
        const cytoscapeMod = await import('cytoscape')
        const cytoscape =
          (cytoscapeMod as { default?: unknown }).default ?? cytoscapeMod
        try {
          // cose-bilkent ships no .d.ts; suppress the implicit-any warning.
          // @ts-expect-error — package has no type declarations
          const cb = await import('cytoscape-cose-bilkent')
          const reg = (cb as { default?: unknown }).default ?? cb
          // Idempotent — registering the same name twice is a no-op in
          // cytoscape's plugin registry. Catch swallows any mismatch.
          ;(cytoscape as (t: string, n: string, r: unknown) => unknown)(
            'layout',
            'cose-bilkent',
            reg,
          )
        } catch {
          /* layout fallback handled below */
        }
        if (cancelled || !cyHostRef.current) return
        const elements = [
          ...rawNodes.map((n) => ({
            data: {
              id: n.slug,
              label: n.title,
              countIn: n.count_in,
              countOut: n.count_out,
              isRoot: n.slug === rootSlug,
            },
          })),
          ...rawEdges.map((e) => ({
            data: { id: `${e.from}->${e.to}`, source: e.from, target: e.to, count: e.count },
          })),
        ]
        const factory = cytoscape as (opts: unknown) => {
          destroy: () => void
          on: (ev: string, sel: string, cb: (evt: { target: { id: () => string } }) => void) => void
        }
        cy = factory({
          container: cyHostRef.current,
          elements,
          layout: { name: 'cose-bilkent', animate: false, randomize: true },
          style: [
            {
              selector: 'node',
              style: {
                'background-color': 'data(isRoot) ? "#0c4a6e" : "#0ea5e9"',
                label: 'data(label)',
                'font-size': 11,
                color: '#1f2937',
                'text-margin-y': -8,
                width: 'mapData(countIn, 0, 8, 12, 28)',
                height: 'mapData(countIn, 0, 8, 12, 28)',
                'border-width': 1.5,
                'border-color': '#fff',
              },
            },
            {
              selector: 'edge',
              style: {
                width: 'mapData(count, 1, 4, 1, 5)',
                'line-color': '#94a3b8',
                'curve-style': 'bezier',
                'target-arrow-shape': 'triangle',
                'target-arrow-color': '#94a3b8',
                opacity: 0.7,
              },
            },
          ],
        })
        cy.on('tap', 'node', (evt) => {
          if (onPickNode) onPickNode(evt.target.id())
        })
        if (!cancelled) setUsingCytoscape(true)
      } catch {
        // Either cytoscape itself or cose-bilkent failed — leave fallback.
        if (!cancelled) setUsingCytoscape(false)
      }
    })()
    return () => {
      cancelled = true
      if (cy) {
        try {
          cy.destroy()
        } catch {
          /* ignore — cy already torn down */
        }
      }
      setUsingCytoscape(false)
    }
  }, [rawNodes, rawEdges, rootSlug, onPickNode])

  // ── d3-force fallback path ─────────────────────────────────────────────
  // Skipped while cytoscape is driving the canvas; if cytoscape fails to
  // boot or unmounts we re-attach to the SVG.
  useEffect(() => {
    if (usingCytoscape) return
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
  }, [nodes, links, onPickNode, usingCytoscape])

  // Pan + zoom for the d3-force fallback. Cytoscape ships its own.
  useEffect(() => {
    if (usingCytoscape) return
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
  }, [usingCytoscape])

  return (
    <div className="relative">
      <div
        ref={cyHostRef}
        data-testid="dep-graph-cy-host"
        className={`h-[600px] w-full rounded border border-gray-200 bg-white ${
          usingCytoscape ? '' : 'hidden'
        }`}
      />
      <svg
        ref={svgRef}
        data-testid="dep-graph-svg"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        className={`h-[600px] w-full rounded border border-gray-200 bg-white ${
          usingCytoscape ? 'hidden' : ''
        }`}
      >
        <g ref={gRef}>
          <g className="links" />
          <g className="nodes" />
        </g>
      </svg>
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
