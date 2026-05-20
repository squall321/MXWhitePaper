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
import { useNavigate, useOutletContext, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import type { AppOutletContext } from '@/App'
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
  /** BFS depth from rootSlug. 0 = root, 1+ = 자식 단계. root 없으면 모두 0. */
  depth: number
}

type SimLink = SimulationLinkDatum<SimNode> & { count: number }

const WIDTH = 800
const HEIGHT = 600
const MAX_NODES = 50

function buildSim(
  rawNodes: GraphNode[],
  rawEdges: GraphEdge[],
  rootSlug?: string | null,
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

  // BFS depth from rootSlug. root 없으면 모두 0.
  const depthMap = new Map<string, number>()
  if (rootSlug && keep.has(rootSlug)) {
    // 인접 리스트 (무방향)
    const adj = new Map<string, Set<string>>()
    for (const e of rawEdges) {
      if (!keep.has(e.source) || !keep.has(e.target)) continue
      if (!adj.has(e.source)) adj.set(e.source, new Set())
      if (!adj.has(e.target)) adj.set(e.target, new Set())
      adj.get(e.source)!.add(e.target)
      adj.get(e.target)!.add(e.source)
    }
    depthMap.set(rootSlug, 0)
    let frontier = [rootSlug]
    let d = 1
    while (frontier.length > 0) {
      const next: string[] = []
      for (const cur of frontier) {
        for (const nb of adj.get(cur) ?? []) {
          if (!depthMap.has(nb)) {
            depthMap.set(nb, d)
            next.push(nb)
          }
        }
      }
      frontier = next
      d++
    }
  }

  const nodes: SimNode[] = top.map((n) => ({
    slug: n.slug,
    title: n.title,
    status: n.status,
    degree: deg.get(n.slug) ?? 0,
    isMissing: n.status === 'missing',
    // root 모르면 0, root 있어도 연결 안 됐으면 99 (max depth+1)
    depth: depthMap.get(n.slug) ?? (rootSlug ? 99 : 0),
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
  /** false 면 root 와 연결되지 않은 (depth=99) 노드 숨김. rootSlug 가 없으면 무시. */
  showOrphans?: boolean
  onPickNode?: (slug: string) => void
  onContextMenu?: (slug: string, x: number, y: number) => void
}

/** Pure rendering layer — exported so unit tests can render it without
 *  the data-fetching layer. */
export function GraphCanvas({
  nodes: rawNodes,
  edges: rawEdges,
  highlight,
  rootSlug,
  showOrphans = true,
  onPickNode,
  onContextMenu,
}: GraphCanvasProps) {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const gRef = useRef<SVGGElement | null>(null)
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null)

  const { nodes, links } = useMemo(() => {
    const built = buildSim(rawNodes, rawEdges, rootSlug)
    if (rootSlug && !showOrphans) {
      // depth=99 (root 와 연결 안 됨) 노드 제거 + 해당 노드를 참조하는 link 도 제거.
      const kept = new Set(built.nodes.filter((n) => n.depth !== 99).map((n) => n.slug))
      return {
        nodes: built.nodes.filter((n) => kept.has(n.slug)),
        links: built.links.filter((l) => {
          const s = typeof l.source === 'string' ? l.source : (l.source as SimNode).slug
          const t = typeof l.target === 'string' ? l.target : (l.target as SimNode).slug
          return kept.has(s) && kept.has(t)
        }),
      }
    }
    return built
  }, [rawNodes, rawEdges, rootSlug, showOrphans])

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
      // collide: 노드 ellipse 가 안 겹치게. depth 기반 rx + 약간 buffer.
      // (SIZE_BY_DEPTH 와 일관 — 본 force 블록은 sizeFor 정의 *전* 이라 const literal 직접 사용)
      .force(
        'collide',
        forceCollide<SimNode>((d) => {
          if (!rootSlug) return 55 + 12  // depth 2 사이즈 기본
          const rx = ({ 0: 90, 1: 70, 2: 55, 3: 45 } as Record<number, number>)[d.depth] ?? 45
          return rx + 12
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

    // 노드 ellipse 크기 = depth 기반:
    //   depth 0 (root)    rx 90 / ry 40 / font 14
    //   depth 1           rx 70 / ry 32 / font 12
    //   depth 2           rx 55 / ry 26 / font 11
    //   depth 3+ (또는 root 없음) rx 45 / ry 22 / font 10
    // label 은 각 단계의 최대 너비에 맞춰 truncate (글자가 *항상 노드 안에*).
    type Sz = { rx: number; ry: number; fontSize: number; maxChars: number }
    const SIZE_BY_DEPTH: Record<number, Sz> = {
      0: { rx: 90, ry: 40, fontSize: 14, maxChars: 22 },
      1: { rx: 70, ry: 32, fontSize: 12, maxChars: 17 },
      2: { rx: 55, ry: 26, fontSize: 11, maxChars: 13 },
      3: { rx: 45, ry: 22, fontSize: 10, maxChars: 10 },
    }
    const DEFAULT_SZ: Sz = SIZE_BY_DEPTH[3]!

    const sizeFor = (d: SimNode): Sz => {
      // rootSlug 없으면 모두 depth 0 처럼 균일 — DEFAULT 보다 살짝 크게 (depth 2 사이즈).
      if (!rootSlug) return SIZE_BY_DEPTH[2]!
      return SIZE_BY_DEPTH[d.depth] ?? DEFAULT_SZ
    }

    const labelFor = (d: SimNode) => {
      const sz = sizeFor(d)
      if (d.title.length <= sz.maxChars) return d.title
      return d.title.slice(0, sz.maxChars - 1) + '…'
    }

    const radiusFor = (d: SimNode) => sizeFor(d).rx
    const ryFor = (d: SimNode) => sizeFor(d).ry
    const fontFor = (d: SimNode) => sizeFor(d).fontSize

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
        // SVG <text> 의 default baseline = alphabetic (글자 *아래쪽*이 y).
        // 우리는 글자가 ellipse 의 정확한 중앙에 오기를 원하므로:
        //  - text-anchor: middle → 가로 중앙
        //  - dominant-baseline: central → 세로 중앙 (모든 브라우저 지원, 'middle' 보다 신뢰성 ↑)
        //  - dy: 글자 자체의 visual centerline 보정 — alphabetic baseline 기준 약 fontSize/3 만큼 아래로
        // 추가 안전망: y 도 0 으로 명시 (기본 0 이지만 어떤 변형도 무력화).
        ng.append('text')
          .attr('x', 0)
          .attr('y', 0)
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'central')
          .attr('font-size', fontFor)
          .attr('font-weight', (d) => (d.slug === rootSlug ? 700 : 500))
          .attr('fill', '#ffffff')
          .attr('pointer-events', 'none')
          .text(labelFor)
        return ng
      })

    nodeSel.on('click', (_, d) => {
      if (!d.isMissing && onPickNode) onPickNode(d.slug)
    })

    nodeSel.on('contextmenu', (event: MouseEvent, d) => {
      if (d.isMissing || !onContextMenu) return
      event.preventDefault()
      onContextMenu(d.slug, event.clientX, event.clientY)
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
  }, [nodes, links, onPickNode, onContextMenu, rootSlug])

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

/** 우클릭 컨텍스트 메뉴 상태. */
interface NodeMenu {
  slug: string
  x: number
  y: number
}

export function GraphPage() {
  const { slug } = useParams<{ slug?: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [showOrphans, setShowOrphans] = useState(true)
  const [menu, setMenu] = useState<NodeMenu | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  // BFS depth — URL ?depth=N 로 공유 가능, 1~4 (BE 가 강제). default 2.
  const rawDepth = parseInt(searchParams.get('depth') ?? '2', 10)
  const depth = Number.isFinite(rawDepth) && rawDepth >= 1 && rawDepth <= 4 ? rawDepth : 2

  const setDepth = (d: number) => {
    const next = new URLSearchParams(searchParams)
    next.set('depth', String(d))
    setSearchParams(next, { replace: true })
  }

  // 그래프 페이지에서는 좌측 조직도 column 자체를 숨겨 본문이 화면을 풍부히 사용.
  // (사용자는 TopBar 햄버거 → MobileNavDrawer 로 여전히 조직도 접근 가능.)
  const ctx = useOutletContext<AppOutletContext | undefined>()
  useEffect(() => {
    if (!ctx) return
    ctx.setLeftRail(null)
    return () => ctx.setLeftRail(undefined)
  }, [ctx])

  // F11 키 = 그래프만 보이는 fullscreen 토글 (브라우저 기본 F11 가로채기).
  // 브라우저 fullscreen API 대신 자체 fixed overlay — 다른 브라우저 UI 가 사라지지 않도록
  // 의도 (사용자가 익숙한 키만 빌려쓰는 패턴).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 입력 중에는 가로채지 않음
      const target = e.target as HTMLElement | null
      const tag = target?.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'textarea' || target?.isContentEditable) return
      if (e.key === 'F11') {
        e.preventDefault()
        setFullscreen((v) => !v)
      } else if (e.key === 'Escape' && fullscreen) {
        e.preventDefault()
        setFullscreen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fullscreen])

  // 컨텍스트 메뉴: 바깥 클릭 / Esc 로 닫기.
  useEffect(() => {
    if (!menu) return
    const onClick = () => setMenu(null)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null)
    }
    window.addEventListener('click', onClick)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', onClick)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['graph', slug ?? '__global__', depth],
    queryFn: () => fetchGraph(slug ?? null, depth),
    staleTime: 30_000,
  })

  // fullscreen 모드: position fixed overlay 로 화면 전체 차지.
  const rootCls = fullscreen
    ? 'fixed inset-0 z-modal flex flex-col bg-white p-3 dark:bg-gray-950'
    : 'flex flex-col gap-3'

  return (
    <div ref={containerRef} className={rootCls} data-testid="graph-page">
      {/* 컨트롤 바 — 가로 한 줄. depth / orphan / fullscreen / search. */}
      <header className="flex flex-wrap items-center gap-3 border-b border-gray-200 pb-2 dark:border-gray-800">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold text-smsg-900 dark:text-gray-100">위키 그래프</h1>
          <p className="text-xs text-gray-500">
            {slug ? `루트: ${slug} · 깊이 ${depth}` : '전역 그래프 (degree 상위 50)'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {slug && (
            <label className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-300">
              깊이
              <select
                value={depth}
                onChange={(e) => setDepth(parseInt(e.target.value, 10))}
                aria-label="그래프 깊이"
                data-testid="graph-depth"
                className="rounded border border-gray-200 bg-white px-1 py-1 text-sm focus:border-smsg-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800"
              >
                <option value={1}>1</option>
                <option value={2}>2</option>
                <option value={3}>3</option>
                <option value={4}>4</option>
              </select>
            </label>
          )}
          {slug && (
            <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
              <input
                type="checkbox"
                checked={showOrphans}
                onChange={(e) => setShowOrphans(e.target.checked)}
                aria-label="고아 노드 표시"
                data-testid="graph-orphan-toggle"
                className="h-3.5 w-3.5"
              />
              고아 표시
            </label>
          )}
          <button
            type="button"
            onClick={() => setFullscreen((v) => !v)}
            aria-label={fullscreen ? '전체화면 해제' : '전체화면'}
            title="F11"
            data-testid="graph-fullscreen-toggle"
            className="rounded border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
          >
            {fullscreen ? '⤡ 해제' : '⛶ F11'}
          </button>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="노드 검색…"
            aria-label="노드 검색"
            data-testid="graph-search"
            className="w-48 rounded border border-gray-200 bg-white px-2 py-1 text-sm focus:border-smsg-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800"
          />
        </div>
      </header>

      <div className={fullscreen ? 'min-h-0 flex-1' : ''}>
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
            showOrphans={showOrphans}
            onPickNode={(s) => navigate(`/docs/${encodeURIComponent(s)}`)}
            onContextMenu={(s, x, y) => setMenu({ slug: s, x, y })}
          />
        )}
      </div>

      <p className="text-[11px] text-gray-500">
        스크롤로 줌, 드래그로 이동, 좌클릭 = 문서, 우클릭 = 메뉴. F11 = 전체화면. 빨간 노드는 아직 작성되지 않은 링크입니다.
      </p>

      {/* 우클릭 컨텍스트 메뉴: 문서 열기 vs 그래프 루트로 이동. */}
      {menu && (
        <div
          role="menu"
          aria-label="노드 메뉴"
          data-testid="graph-context-menu"
          style={{ position: 'fixed', left: menu.x, top: menu.y, zIndex: 9999 }}
          onClick={(e) => e.stopPropagation()}
          className="min-w-[180px] rounded border border-gray-200 bg-white py-1 text-sm shadow-lg dark:border-gray-700 dark:bg-gray-800"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              navigate(`/docs/${encodeURIComponent(menu.slug)}`)
              setMenu(null)
            }}
            className="block w-full px-3 py-1.5 text-left text-gray-700 hover:bg-smsg-50 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            📄 문서 열기
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              navigate(`/graph/${encodeURIComponent(menu.slug)}?depth=${depth}`)
              setMenu(null)
            }}
            className="block w-full px-3 py-1.5 text-left text-gray-700 hover:bg-smsg-50 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            🕸 이 노드를 루트로
          </button>
        </div>
      )}
    </div>
  )
}

export default GraphPage
