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
import { Link, useNavigate, useOutletContext, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import type { AppOutletContext } from '@/App'
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force'
import { select } from 'd3-selection'
import { zoom, zoomIdentity, type ZoomBehavior } from 'd3-zoom'
import { fetchGraph, type GraphEdge, type GraphNode, type GraphNodeDoc, type GraphNodeTag } from '@/features/graph/api'
import { KnowledgeGraph } from '@/features/graph/components/KnowledgeGraph'

/**
 * Unified sim node — doc + tag 둘 다 표현.
 * - kind='doc' (default): 기존 동작 (원/타원, depth 기반 크기)
 * - kind='tag': 둥근 사각형, super-domain 색, doc_count 기반 크기
 */
interface SimNode extends SimulationNodeDatum {
  kind: 'doc' | 'tag'
  slug: string          // doc.slug 또는 'tag:<name>'
  title: string         // 표시 이름 (tag 의 경우 '#<name>')
  // doc 전용
  status?: string
  degree?: number
  isMissing?: boolean
  /** BFS depth from rootSlug. doc only. tag 는 항상 1 (super-domain hub). */
  depth?: number
  // tag 전용
  docCount?: number
  superDomain?: string  // 'mobile' | 'software' | 'hardware' | 'telecom'
}

/** Edge kind 정보 보존 — 렌더 시 분기. */
type SimLink = SimulationLinkDatum<SimNode> & {
  kind: 'wiki' | 'doc_tag' | 'tag_cooc'
  weight: number  // wiki=count, doc_tag=1, tag_cooc=weight
}

const WIDTH = 800
const HEIGHT = 600
const MAX_NODES = 50

function buildSim(
  rawNodes: GraphNode[],
  rawEdges: GraphEdge[],
  rootSlug?: string | null,
): { nodes: SimNode[]; links: SimLink[] } {
  // doc 과 tag 를 분리. tag 는 *전부 유지* (개수 적음). doc 은 degree 상위 MAX_NODES 만.
  const docNodes = rawNodes.filter((n) => (n.kind ?? 'doc') === 'doc')
  const tagNodes = rawNodes.filter((n) => n.kind === 'tag')

  // wiki edge 만 degree 계산 (doc-doc 연결도).
  const deg = new Map<string, number>()
  for (const e of rawEdges) {
    if ((e.kind ?? 'wiki') !== 'wiki') continue
    const c = e.count ?? 1
    deg.set(e.source, (deg.get(e.source) ?? 0) + c)
    deg.set(e.target, (deg.get(e.target) ?? 0) + c)
  }

  const sortedDocs = [...docNodes].sort(
    (a, b) => (deg.get(b.slug) ?? 0) - (deg.get(a.slug) ?? 0),
  )
  const topDocs = sortedDocs.slice(0, MAX_NODES)
  const keepDoc = new Set(topDocs.map((n) => n.slug))
  const keepTag = new Set(tagNodes.map((n) => n.slug))  // tag slug = 'tag:<name>'
  const keep = new Set([...keepDoc, ...keepTag])

  // BFS depth from rootSlug — doc 끼리의 wiki link 만 사용.
  const depthMap = new Map<string, number>()
  if (rootSlug && keepDoc.has(rootSlug)) {
    const adj = new Map<string, Set<string>>()
    for (const e of rawEdges) {
      if ((e.kind ?? 'wiki') !== 'wiki') continue
      if (!keepDoc.has(e.source) || !keepDoc.has(e.target)) continue
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

  const docSim: SimNode[] = topDocs.map((raw) => {
    const n = raw as GraphNodeDoc
    return {
      kind: 'doc' as const,
      slug: n.slug,
      title: n.title,
      status: n.status,
      degree: deg.get(n.slug) ?? 0,
      isMissing: n.status === 'missing',
      depth: depthMap.get(n.slug) ?? (rootSlug ? 99 : 0),
    }
  })
  const tagSim: SimNode[] = tagNodes.map((n) => {
    const t = n as GraphNodeTag
    return {
      kind: 'tag' as const,
      slug: t.slug,
      title: `#${t.name}`,
      docCount: t.doc_count,
      superDomain: t.super_domain,
    }
  })

  const links: SimLink[] = rawEdges
    .filter((e) => keep.has(e.source) && keep.has(e.target))
    .map((e) => {
      const kind = (e.kind ?? 'wiki') as 'wiki' | 'doc_tag' | 'tag_cooc'
      const weight = kind === 'wiki' ? (e.count ?? 1)
                   : kind === 'tag_cooc' ? (e.weight ?? 1)
                   : 1
      return { source: e.source, target: e.target, kind, weight }
    })

  return { nodes: [...docSim, ...tagSim], links }
}

export interface GraphCanvasProps {
  nodes: GraphNode[]
  edges: GraphEdge[]
  highlight?: string
  /** BFS root slug — 별도 색 + 더 큰 노드로 강조. */
  rootSlug?: string | null
  /** false 면 root 와 연결되지 않은 (depth=99) 노드 숨김. rootSlug 가 없으면 무시. */
  showOrphans?: boolean
  /** 표시할 edge 종류. plan v0.3 §10: wiki+doc_tag default, tag_cooc OFF. */
  edgeKinds?: Set<'wiki' | 'doc_tag' | 'tag_cooc'>
  /** S4: 최소 연결도 (wiki degree). 이 값 미만의 doc 노드는 fade out. tag 는 무시. */
  minDegree?: number
  /** S4: tag click 시 그 tag 와 같은 cluster 의 doc 들을 자석으로 끌어당기는 강도. 0 = off. */
  clusterStrength?: number
  /** S4: 현재 focus 된 tag slug — 이 tag 가 cluster centroid 역할. null 이면 cluster off. */
  focusedTag?: string | null
  onPickNode?: (slug: string) => void
  onPickTag?: (slug: string) => void
  onContextMenu?: (slug: string, x: number, y: number) => void
}

/** Pure rendering layer — exported so unit tests can render it without
 *  the data-fetching layer. */
const DEFAULT_EDGE_KINDS = new Set<'wiki' | 'doc_tag' | 'tag_cooc'>(['wiki', 'doc_tag'])

export function GraphCanvas({
  nodes: rawNodes,
  edges: rawEdges,
  highlight,
  rootSlug,
  showOrphans = true,
  edgeKinds = DEFAULT_EDGE_KINDS,
  minDegree = 0,
  clusterStrength = 0.15,
  focusedTag = null,
  onPickNode,
  onPickTag,
  onContextMenu,
}: GraphCanvasProps) {
  // S4: hover focus state — null 이면 모든 노드 평소 opacity.
  const [hoverSlug, setHoverSlug] = useState<string | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const gRef = useRef<SVGGElement | null>(null)
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null)

  const { nodes, links } = useMemo(() => {
    const built = buildSim(rawNodes, rawEdges, rootSlug)
    let filteredNodes = built.nodes
    let filteredLinks = built.links

    if (rootSlug && !showOrphans) {
      // depth=99 (root 와 연결 안 됨) doc 노드만 숨김. tag 노드는 *항상* 유지.
      const kept = new Set(
        built.nodes
          .filter((n) => n.kind === 'tag' || n.depth !== 99)
          .map((n) => n.slug),
      )
      filteredNodes = built.nodes.filter((n) => kept.has(n.slug))
      filteredLinks = built.links.filter((l) => {
        const s = typeof l.source === 'string' ? l.source : (l.source as SimNode).slug
        const t = typeof l.target === 'string' ? l.target : (l.target as SimNode).slug
        return kept.has(s) && kept.has(t)
      })
    }

    // S3: edge type chip 필터 — 활성화된 종류만 유지.
    filteredLinks = filteredLinks.filter((l) => edgeKinds.has(l.kind))

    return { nodes: filteredNodes, links: filteredLinks }
  }, [rawNodes, rawEdges, rootSlug, showOrphans, edgeKinds])

  // S4: adjacency map — focus hover 시 1-hop + cluster force 에 모두 활용. 무방향.
  const adjacency = useMemo(() => {
    const adj = new Map<string, Set<string>>()
    for (const l of links) {
      const s = typeof l.source === 'string' ? l.source : (l.source as SimNode).slug
      const t = typeof l.target === 'string' ? l.target : (l.target as SimNode).slug
      if (!adj.has(s)) adj.set(s, new Set())
      if (!adj.has(t)) adj.set(t, new Set())
      adj.get(s)!.add(t)
      adj.get(t)!.add(s)
    }
    return adj
  }, [links])

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
      // collide: doc 은 depth 기반 rx, tag 는 docCount 기반 rx.
      .force(
        'collide',
        forceCollide<SimNode>((d) => {
          if (d.kind === 'tag') {
            // tag rect 크기 ≈ √docCount × 6 + 30 → 그 절반 + buffer
            return Math.sqrt(d.docCount ?? 1) * 3 + 28
          }
          if (!rootSlug) return 55 + 12
          const rx = ({ 0: 90, 1: 70, 2: 55, 3: 45 } as Record<number, number>)[d.depth ?? 99] ?? 45
          return rx + 12
        }).strength(0.9),
      )
      .force('center', forceCenter(WIDTH / 2, HEIGHT / 2))
      // S5: 빠른 수렴 — default 0.0228 (≈300 ticks) → 0.05 (≈90 ticks). 70+ 노드에서 fps 부담 ↓.
      .alphaDecay(0.05)
      .velocityDecay(0.4)  // default 0.4. 명시 — 진동 더 빠르게 가라앉음

    // S4: soft cluster — focusedTag 가 있으면 그 tag 의 super_domain doc 들을 tag centroid 로 끌어당김.
    // d3 forceX/forceY 를 selective strength 로 적용. wiki link force 보다 약하게 (clusterStrength<<link.strength).
    if (focusedTag && clusterStrength > 0) {
      const tagNode = nodes.find((n) => n.kind === 'tag' && n.slug === focusedTag)
      const targetDomain = tagNode?.superDomain
      const cx = WIDTH / 2, cy = HEIGHT / 2
      // tag 자체는 가운데로 더 강하게, 같은 domain doc 은 약하게.
      sim.force(
        'cluster-x',
        forceX<SimNode>((d) => {
          if (d.slug === focusedTag) return cx
          // tag 의 doc_tag 엣지로 연결된 doc 도 cluster 대상으로 포함
          // (super_domain 미보유 doc 이라도 doc_tag 로 묶이면 cluster)
          if (d.kind === 'doc' && (adjacency.get(focusedTag)?.has(d.slug) || (targetDomain && d.kind === 'doc'))) {
            return cx
          }
          return d.x ?? cx
        }).strength((d) => {
          if (d.slug === focusedTag) return clusterStrength * 2
          if (d.kind === 'doc' && adjacency.get(focusedTag)?.has(d.slug)) return clusterStrength
          return 0
        }),
      )
      sim.force(
        'cluster-y',
        forceY<SimNode>((d) => {
          if (d.slug === focusedTag) return cy
          if (d.kind === 'doc' && adjacency.get(focusedTag)?.has(d.slug)) return cy
          return d.y ?? cy
        }).strength((d) => {
          if (d.slug === focusedTag) return clusterStrength * 2
          if (d.kind === 'doc' && adjacency.get(focusedTag)?.has(d.slug)) return clusterStrength
          return 0
        }),
      )
      sim.alpha(0.5).restart()  // re-energize so the pull takes effect immediately
    }

    simRef.current = sim

    // ── EDGES ──────────────────────────────────────────────────────────
    // 3 종 분기 — wiki (실선, 굵기 count), doc_tag (점선), tag_cooc (실선, super-domain 색)
    const linksG = g.select<SVGGElement>('g.links')
    linksG.selectAll('*').remove()

    // super-domain 색 헬퍼 (tag_cooc edge 색용)
    const DOMAIN_COLOR: Record<string, string> = {
      mobile:   '#3b82f6',
      software: '#10b981',
      hardware: '#f59e0b',
      telecom:  '#ec4899',
    }
    const edgeColorFor = (l: SimLink): string => {
      if (l.kind === 'tag_cooc') {
        // 두 tag 의 super_domain 색을 *source* 기준으로 (gradient 는 비용 큼)
        const src = l.source as SimNode
        return DOMAIN_COLOR[src.superDomain ?? ''] ?? '#a78bfa'
      }
      return '#94a3b8'
    }

    const linkSel = linksG
      .selectAll<SVGLineElement, SimLink>('line')
      .data(links, (d) => {
        const s = (d.source as SimNode).slug ?? d.source
        const t = (d.target as SimNode).slug ?? d.target
        return `${d.kind}:${s}->${t}`
      })
      .join('line')
      .attr('stroke', edgeColorFor)
      .attr('stroke-opacity', (d) =>
        d.kind === 'wiki' ? 0.7 : d.kind === 'tag_cooc' ? 0.5 : 0.3,
      )
      .attr('stroke-width', (d) =>
        d.kind === 'wiki' ? 1 + Math.min(d.weight, 5)
        : d.kind === 'tag_cooc' ? Math.max(1, d.weight / 5)
        : 1,
      )
      .attr('stroke-dasharray', (d) => (d.kind === 'doc_tag' ? '2 3' : 'none'))

    // ── NODES ──────────────────────────────────────────────────────────
    // doc: ellipse (depth 기반 크기). tag: rounded rect (docCount 기반).
    type DocSz = { rx: number; ry: number; fontSize: number; maxChars: number }
    const SIZE_BY_DEPTH: Record<number, DocSz> = {
      0: { rx: 90, ry: 40, fontSize: 14, maxChars: 22 },
      1: { rx: 70, ry: 32, fontSize: 12, maxChars: 17 },
      2: { rx: 55, ry: 26, fontSize: 11, maxChars: 13 },
      3: { rx: 45, ry: 22, fontSize: 10, maxChars: 10 },
    }
    const DEFAULT_SZ: DocSz = SIZE_BY_DEPTH[3]!

    const docSizeFor = (d: SimNode): DocSz => {
      if (!rootSlug) return SIZE_BY_DEPTH[2]!
      return SIZE_BY_DEPTH[d.depth ?? 99] ?? DEFAULT_SZ
    }

    // tag rect: width = √docCount × 12 + 60, height = 28, font 12
    const tagSizeFor = (d: SimNode) => {
      const w = Math.sqrt(d.docCount ?? 1) * 12 + 60
      return { w, h: 28, fontSize: 12, maxChars: Math.max(8, Math.floor(w / 9)) }
    }

    const labelFor = (d: SimNode) => {
      const maxChars = d.kind === 'tag' ? tagSizeFor(d).maxChars : docSizeFor(d).maxChars
      if (d.title.length <= maxChars) return d.title
      return d.title.slice(0, maxChars - 1) + '…'
    }

    const fontFor = (d: SimNode) =>
      d.kind === 'tag' ? tagSizeFor(d).fontSize : docSizeFor(d).fontSize

    // 색 결정 — doc: root 주황, missing 빨강, 일반 진청. tag: super-domain 팔레트.
    const fillFor = (d: SimNode): string => {
      if (d.kind === 'tag') {
        return DOMAIN_COLOR[d.superDomain ?? ''] ?? '#a78bfa'
      }
      if (d.slug === rootSlug) return '#f59e0b'
      if (d.isMissing) return '#dc2626'
      return '#0c4a6e'
    }

    const nodesG = g.select<SVGGElement>('g.nodes')
    nodesG.selectAll('*').remove()

    const nodeSel = nodesG
      .selectAll<SVGGElement, SimNode>('g.node')
      .data(nodes, (d) => d.slug)
      .join((enter) => {
        const ng = enter.append('g')
          .attr('class', (d) => `node node-${d.kind}`)
          .style('cursor', 'pointer')

        // doc → ellipse
        ng.filter((d) => d.kind === 'doc')
          .append('ellipse')
          .attr('rx', (d) => docSizeFor(d).rx)
          .attr('ry', (d) => docSizeFor(d).ry)
          .attr('fill', fillFor)
          .attr('stroke', '#fff')
          .attr('stroke-width', 2)

        // tag → rounded rect
        ng.filter((d) => d.kind === 'tag')
          .append('rect')
          .attr('x', (d) => -tagSizeFor(d).w / 2)
          .attr('y', (d) => -tagSizeFor(d).h / 2)
          .attr('width', (d) => tagSizeFor(d).w)
          .attr('height', (d) => tagSizeFor(d).h)
          .attr('rx', 6)
          .attr('ry', 6)
          .attr('fill', fillFor)
          .attr('stroke', '#fff')
          .attr('stroke-width', 2)

        ng.append('title').text((d) =>
          d.kind === 'tag' ? `${d.title} — ${d.docCount} docs` : `${d.title} (${d.slug})`,
        )

        ng.append('text')
          .attr('x', 0)
          .attr('y', 0)
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'central')
          .attr('font-size', fontFor)
          .attr('font-weight', (d) => (d.slug === rootSlug ? 700 : d.kind === 'tag' ? 600 : 500))
          .attr('fill', '#ffffff')
          .attr('pointer-events', 'none')
          .text(labelFor)
        return ng
      })

    nodeSel.on('click', (_, d) => {
      // tag 좌클릭 → onPickTag (cluster 토글). doc 좌클릭 → onPickNode (페이지 이동).
      if (d.kind === 'tag') {
        if (onPickTag) onPickTag(d.slug)
        return
      }
      if (!d.isMissing && onPickNode) onPickNode(d.slug)
    })

    nodeSel.on('contextmenu', (event: MouseEvent, d) => {
      if (d.kind === 'doc' && d.isMissing) return
      if (!onContextMenu) return
      event.preventDefault()
      onContextMenu(d.slug, event.clientX, event.clientY)
    })

    // S4: hover focus — mouseenter/leave 로 1-hop 강조.
    nodeSel.on('mouseenter', (_, d) => setHoverSlug(d.slug))
    nodeSel.on('mouseleave', () => setHoverSlug(null))

    sim.on('tick', () => {
      linkSel
        .attr('x1', (d) => (d.source as SimNode).x ?? 0)
        .attr('y1', (d) => (d.source as SimNode).y ?? 0)
        .attr('x2', (d) => (d.target as SimNode).x ?? 0)
        .attr('y2', (d) => (d.target as SimNode).y ?? 0)
      nodeSel.attr('transform', (d) => `translate(${d.x ?? 0},${d.y ?? 0})`)
    })

    // S5: Obsidian 식 — 3초 후 simulation 정지 (계속 ticking 시 모바일 fps 부담).
    // 데이터/cluster 변경 시 useEffect 가 재실행되어 새 sim 이 다시 돔.
    const stopTimer = window.setTimeout(() => {
      sim.stop()
    }, 3000)

    return () => {
      window.clearTimeout(stopTimer)
      sim.stop()
      simRef.current = null
    }
  }, [nodes, links, onPickNode, onPickTag, onContextMenu, rootSlug, focusedTag, clusterStrength, adjacency])

  // Highlight + focus + degree-filter effect.
  // 세 가지가 결합되어 *최종 opacity* 결정. 모두 별도 useEffect 하면 깜빡임 — 합쳐서 한 번에.
  useEffect(() => {
    if (!gRef.current) return
    const g = select(gRef.current)
    const q = (highlight ?? '').trim().toLowerCase()

    // hover focus 우선 — set 이 있으면 그 외 모두 fade.
    const focusSet = hoverSlug
      ? new Set([hoverSlug, ...(adjacency.get(hoverSlug) ?? [])])
      : null

    const isVisibleByDegree = (d: SimNode) =>
      d.kind === 'tag' || (d.degree ?? 0) >= minDegree

    const computeNodeOpacity = (d: SimNode): number => {
      if (!isVisibleByDegree(d)) return 0.1
      if (focusSet && !focusSet.has(d.slug)) return 0.15
      if (q && !d.slug.toLowerCase().includes(q) && !d.title.toLowerCase().includes(q)) {
        return 0.2
      }
      return 1
    }

    g.selectAll<SVGGElement, SimNode>('g.node').style('opacity', computeNodeOpacity)

    // edge opacity — 양끝 노드가 다 visible 일 때만 켜짐.
    g.selectAll<SVGLineElement, SimLink>('line').style('opacity', (l) => {
      const s = l.source as SimNode
      const t = l.target as SimNode
      const sOpa = computeNodeOpacity(s)
      const tOpa = computeNodeOpacity(t)
      return Math.min(sOpa, tOpa)
    })
  }, [highlight, nodes, hoverSlug, adjacency, minDegree])

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

/**
 * S5: 모바일/태블릿 list fallback — d3-force 가 작은 화면에선 무거우니
 * 같은 데이터를 *목록* 으로 보여준다. tag 그룹 별로 그 tag 의 doc 들을 묶어 표시.
 */
function GraphListFallback({
  nodes,
  edges: _edges,
  query,
  onPickDoc,
}: {
  nodes: GraphNode[]
  edges: GraphEdge[]
  query: string
  onPickDoc: (slug: string) => void
}) {
  const q = query.trim().toLowerCase()
  const docs = nodes.filter((n) => (n.kind ?? 'doc') === 'doc') as GraphNodeDoc[]
  const tags = nodes.filter((n) => n.kind === 'tag') as GraphNodeTag[]

  const visible = docs.filter(
    (d) => !q || d.slug.toLowerCase().includes(q) || d.title.toLowerCase().includes(q),
  )

  return (
    <div className="space-y-3" data-testid="graph-list-fallback">
      {tags.length > 0 && (
        <div className="rounded border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">태그</h2>
          <ul className="flex flex-wrap gap-2">
            {tags.map((t) => (
              <li
                key={t.slug}
                className="rounded-full bg-smsg-100 px-2 py-1 text-xs text-smsg-900 dark:bg-smsg-900 dark:text-smsg-100"
              >
                #{t.name} <span className="text-gray-500">· {t.doc_count}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <ul className="divide-y divide-gray-200 rounded border border-gray-200 bg-white dark:divide-gray-700 dark:border-gray-700 dark:bg-gray-900">
        {visible.length === 0 ? (
          <li className="px-3 py-2 text-sm text-gray-500">표시할 문서가 없습니다.</li>
        ) : (
          visible.map((d) => (
            <li key={d.slug}>
              <button
                type="button"
                onClick={() => onPickDoc(d.slug)}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-smsg-50 dark:hover:bg-gray-800"
              >
                <span className="font-medium text-smsg-900 dark:text-gray-100">{d.title}</span>
                <span className="ml-2 font-mono text-[11px] text-gray-500">{d.slug}</span>
              </button>
            </li>
          ))
        )}
      </ul>
      <p className="text-[11px] text-gray-500">
        그래프 시각화는 큰 화면 (≥1024px) 에서 보입니다. 검색은 위 입력창으로.
      </p>
    </div>
  )
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

  // S3: ?domain=X — 도메인 진입. tag 노드 + (옵션) doc_tag/tag_cooc edge 포함.
  const domain = searchParams.get('domain') || null

  // S3: edge type chip — wiki+doc_tag default ON, tag_cooc default OFF (plan §10).
  const [edgeKinds, setEdgeKinds] = useState<Set<'wiki' | 'doc_tag' | 'tag_cooc'>>(
    () => new Set(['wiki', 'doc_tag']),
  )
  // S4: 최소 연결도 slider — 0 = 모두 표시, N = N+ 만.
  const [minDegree, setMinDegree] = useState(0)
  // S4: focused tag — null 이면 cluster off. tag 좌클릭 시 토글.
  const [focusedTag, setFocusedTag] = useState<string | null>(null)
  const onPickTag = (s: string) => setFocusedTag((cur) => (cur === s ? null : s))
  const toggleEdgeKind = (k: 'wiki' | 'doc_tag' | 'tag_cooc') => {
    setEdgeKinds((prev) => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k); else next.add(k)
      return next
    })
  }

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
    queryKey: ['graph', { root: slug ?? null, depth, domain, edgeKinds: [...edgeKinds].sort() }],
    queryFn: () => fetchGraph({
      root: slug ?? null,
      depth,
      ...(domain ? { domain } : {}),
      include_tags: !!domain,                     // domain 진입 시 tag 노드 받기
      include_doc_tag_edges: edgeKinds.has('doc_tag'),
      include_tag_cooc: edgeKinds.has('tag_cooc'),
    }),
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
            {domain
              ? `도메인: ${domain}${slug ? ` · 루트: ${slug}` : ''}`
              : slug
              ? `루트: ${slug} · 깊이 ${depth}`
              : '전역 그래프 (degree 상위 50)'}
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
          {/* S4: degree slider — 최소 연결도 N+ 만 표시 (fade 만, simulation 재시작 X) */}
          <label className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-300" title="최소 연결도">
            연결≥
            <input
              type="range"
              min={0}
              max={10}
              value={minDegree}
              onChange={(e) => setMinDegree(parseInt(e.target.value, 10))}
              aria-label="최소 연결도"
              data-testid="graph-min-degree"
              className="w-20"
            />
            <span className="w-4 tabular-nums">{minDegree}</span>
          </label>
          {/* S4: focused tag indicator + 해제 버튼 */}
          {focusedTag && (
            <button
              type="button"
              onClick={() => setFocusedTag(null)}
              aria-label="cluster 해제"
              data-testid="graph-cluster-clear"
              className="rounded border border-purple-300 bg-purple-50 px-2 py-1 text-xs text-purple-700 hover:bg-purple-100 dark:border-purple-700 dark:bg-purple-900 dark:text-purple-100"
              title="이 tag 의 cluster 해제"
            >
              🧲 {focusedTag.replace(/^tag:/, '#')} ✕
            </button>
          )}
          {/* S3: Edge type chip — wiki/doc_tag/tag_cooc 각각 토글 */}
          {domain && (
            <div className="flex items-center gap-1 text-xs" role="group" aria-label="엣지 종류 필터">
              {(['wiki', 'doc_tag', 'tag_cooc'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => toggleEdgeKind(k)}
                  aria-pressed={edgeKinds.has(k)}
                  data-testid={`edge-chip-${k}`}
                  className={`rounded border px-2 py-1 transition-colors ${
                    edgeKinds.has(k)
                      ? 'border-smsg-500 bg-smsg-50 text-smsg-900 dark:bg-smsg-900 dark:text-smsg-100'
                      : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800'
                  }`}
                  title={k === 'wiki' ? '위키 링크' : k === 'doc_tag' ? '태그 소속' : '태그 공동출현'}
                >
                  {k === 'wiki' ? '🔗' : k === 'doc_tag' ? '🏷' : '↔'} {k}
                </button>
              ))}
            </div>
          )}
          <Link
            to="/graph/all"
            data-testid="graph-all-link"
            title="전체 지식그래프 보기"
            className="rounded border border-smsg-200 bg-smsg-50 px-2 py-1 text-xs text-smsg-800 hover:bg-smsg-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
          >
            🌐 전체 보기
          </Link>
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
          <>
            {/* 데스크탑: 그래프 렌더 (lg+). 모바일/태블릿: 아래 list fallback */}
            <div className="hidden lg:block">
              <KnowledgeGraph
                nodes={data.nodes}
                edges={data.edges}
                highlight={query}
                rootSlug={slug ?? null}
                showOrphans={showOrphans}
                edgeKinds={edgeKinds}
                minDegree={minDegree}
                focusedTag={focusedTag}
                clusterStrength={0.15}
                onPickNode={(s) => navigate(`/docs/${encodeURIComponent(s)}`)}
                onPickTag={onPickTag}
                onContextMenu={(s, x, y) => setMenu({ slug: s, x, y })}
              />
            </div>
            <div className="lg:hidden">
              <GraphListFallback
                nodes={data.nodes}
                edges={data.edges}
                query={query}
                onPickDoc={(s) => navigate(`/docs/${encodeURIComponent(s)}`)}
              />
            </div>
          </>
        )}
      </div>

      <p className="text-[11px] text-gray-500">
        스크롤로 줌, 드래그로 이동, 좌클릭 = 문서, 우클릭 = 메뉴. F11 = 전체화면. 빨간 노드는 아직 작성되지 않은 링크입니다.
      </p>

      {/* 우클릭 컨텍스트 메뉴 — kind 별 분기 (S5). */}
      {menu && (
        <div
          role="menu"
          aria-label="노드 메뉴"
          data-testid="graph-context-menu"
          style={{ position: 'fixed', left: menu.x, top: menu.y, zIndex: 9999 }}
          onClick={(e) => e.stopPropagation()}
          className="min-w-[180px] rounded border border-gray-200 bg-white py-1 text-sm shadow-lg dark:border-gray-700 dark:bg-gray-800"
        >
          {menu.slug.startsWith('tag:') ? (
            // tag 노드 메뉴 — cluster 토글 + 도메인 이동 + 검색.
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onPickTag(menu.slug)  // cluster 토글 (현재가 같으면 OFF)
                  setMenu(null)
                }}
                className="block w-full px-3 py-1.5 text-left text-gray-700 hover:bg-smsg-50 dark:text-gray-200 dark:hover:bg-gray-700"
              >
                {focusedTag === menu.slug ? '🧲 cluster 해제' : '🧲 cluster 켜기'}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  // tag 이름으로 검색 query 채움 — 같은 tag 의 문서를 filter.
                  setQuery(menu.slug.replace(/^tag:/, ''))
                  setMenu(null)
                }}
                className="block w-full px-3 py-1.5 text-left text-gray-700 hover:bg-smsg-50 dark:text-gray-200 dark:hover:bg-gray-700"
              >
                🔍 이 tag 로 노드 검색
              </button>
            </>
          ) : (
            // doc 노드 메뉴 — 기존 (문서 열기, 그래프 루트로).
            <>
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
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default GraphPage
