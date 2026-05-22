/**
 * KnowledgeGraph — sigma.js 기반 지식그래프 재사용 컴포넌트.
 *
 * SigmaDemo.tsx 의 모든 시각/UX 를 props 인터페이스로 감싼 것.
 * 데이터 페치는 포함하지 않음 — nodes/edges 를 props 로 받음.
 *
 * 시각 특성:
 *  - border 있는 원 노드 (createNodeBorderProgram)
 *  - 라벨 노드 내부 중앙 렌더 (drawInnerLabel)
 *  - FA2 supervisor — drag 중 주변 밀려남
 *  - hover: 자신=amber, 1-hop=pink, 나머지=fade
 *  - drag: chase loop (lerp 0.15) + FA2 재개
 *  - 클릭: doc→onPickNode, tag→onPickTag
 *  - 우클릭: onContextMenu
 */
import { useEffect, useRef } from 'react'
import Graph from 'graphology'
import forceAtlas2 from 'graphology-layout-forceatlas2'
import FA2LayoutSupervisor from 'graphology-layout-forceatlas2/worker'
import noverlap from 'graphology-layout-noverlap'
import { Sigma } from 'sigma'
import { createNodeBorderProgram } from '@sigma/node-border'
import type { Settings } from 'sigma/settings'
import type { GraphNode, GraphNodeDoc, GraphNodeTag, GraphEdge } from '@/features/graph/api'

// ── Domain palette ────────────────────────────────────────────────────────────
const DOMAIN_COLOR: Record<string, string> = {
  mobile:   '#3b82f6',
  software: '#10b981',
  hardware: '#f59e0b',
  telecom:  '#ec4899',
}
const DOC_COLOR = '#6366f1'

// hover 색상
const HOVER_SELF_COLOR     = '#f59e0b'
const HOVER_NEIGHBOR_COLOR = '#ec4899'

// root 노드 강조 색
const ROOT_COLOR = '#f59e0b'

// highlight 매치 노드 색
const HIGHLIGHT_COLOR = '#22d3ee'  // cyan-400

// triple(술어) 엣지 색 — wiki(회색)/tag(도메인색)/highlight(cyan) 와 구분되는 보라 톤
const TRIPLE_COLOR = '#c084fc'  // purple-400

/**
 * triple 엣지 — BE 가 include_triples 켜졌을 때 보내는 술어 엣지.
 * api.ts 의 GraphEdge 타입에는 아직 'triple' kind 가 없어서 (다른 에이전트 담당),
 * 여기서 로컬로 정의하고 buildGraph 가 런타임 필드로 분기한다.
 */
interface GraphEdgeTriple {
  kind: 'triple'
  source: string
  target: string
  predicate: string
  triple_source: 'llm' | 'manual'
  confidence: number | null
}

export interface KnowledgeGraphProps {
  nodes: GraphNode[]
  edges: GraphEdge[]
  rootSlug?: string | null
  highlight?: string
  height?: number
  edgeKinds?: Set<'wiki' | 'doc_tag' | 'tag_cooc'>
  showOrphans?: boolean
  minDegree?: number
  focusedTag?: string | null
  clusterStrength?: number
  /**
   * 전체 그래프 (/graph/all) 모드. size cap 풀어서 degree 큰 노드를 정말 크게
   * 그리고, 척력을 강하게 줘서 캔버스 끝까지 시원하게 흩뜨림.
   */
  hugeSpread?: boolean
  onPickNode?: (slug: string) => void
  onPickTag?: (slug: string) => void
  onContextMenu?: (slug: string, x: number, y: number) => void
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function lightenHex(hex: string, amount = 40): string {
  const m = hex.replace('#', '')
  if (m.length !== 6) return hex
  const r = Math.min(255, parseInt(m.slice(0, 2), 16) + amount)
  const g = Math.min(255, parseInt(m.slice(2, 4), 16) + amount)
  const b = Math.min(255, parseInt(m.slice(4, 6), 16) + amount)
  return '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')
}

function wrapLabel(label: string, maxChars: number, maxLines: number = 3): string[] {
  if (label.length <= maxChars) return [label]

  const breakRegex = /(\s+|(?=[\[\(\{])|(?<=[\)\]\}])|(?=[\.\/])|(?<=[\.\/]))/
  const tokens = label.split(breakRegex).filter((t) => t.length > 0)
  const lines: string[] = []
  let current = ''

  for (const tok of tokens) {
    const candidate = current + tok
    if (candidate.length <= maxChars) {
      current = candidate
    } else {
      if (current.trim()) lines.push(current.trim())
      if (tok.length > maxChars) {
        let remaining = tok
        while (remaining.length > maxChars) {
          lines.push(remaining.slice(0, maxChars))
          remaining = remaining.slice(maxChars)
        }
        current = remaining
      } else {
        current = tok.trimStart()
      }
    }
    if (lines.length >= maxLines) break
  }
  if (current.trim() && lines.length < maxLines) lines.push(current.trim())

  if (lines.length === maxLines) {
    const total = lines.join(' ').length
    const orig = label.length
    if (total < orig) {
      const last = lines[maxLines - 1]!
      lines[maxLines - 1] = last.length > maxChars - 1
        ? last.slice(0, maxChars - 1) + '…'
        : last + '…'
    }
  }

  return lines
}

const drawInnerLabel: Settings['defaultDrawNodeLabel'] = (context, data, _settings) => {
  if (!data.label) return

  const size = data.size
  const fontSize = Math.max(9, Math.min(13, size * 0.42))
  const charWidth = fontSize * 0.65
  const innerWidth = size * 2 * 0.85
  const maxChars = Math.max(3, Math.floor(innerWidth / charWidth))
  const maxLines = size >= 30 ? 3 : size >= 18 ? 2 : 1
  const lines = wrapLabel(data.label, maxChars, maxLines)

  context.font = `600 ${fontSize}px Inter, "Apple SD Gothic Neo", system-ui, sans-serif`
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillStyle = '#ffffff'
  context.shadowColor = 'rgba(0,0,0,0.7)'
  context.shadowBlur = 3

  const lineHeight = fontSize * 1.15
  const totalHeight = (lines.length - 1) * lineHeight
  const startY = data.y - totalHeight / 2

  lines.forEach((line, i) => {
    context.fillText(line, data.x, startY + i * lineHeight)
  })

  context.shadowBlur = 0
  context.shadowColor = 'transparent'
}

// ── BFS depth 계산 ────────────────────────────────────────────────────────────
function computeDepths(
  nodes: GraphNode[],
  edges: GraphEdge[],
  rootSlug: string,
): Map<string, number> {
  const docSlugs = new Set(
    nodes.filter((n) => (n.kind ?? 'doc') === 'doc').map((n) => n.slug),
  )
  const adj = new Map<string, Set<string>>()
  for (const e of edges) {
    if ((e.kind ?? 'wiki') !== 'wiki') continue
    if (!docSlugs.has(e.source) || !docSlugs.has(e.target)) continue
    if (!adj.has(e.source)) adj.set(e.source, new Set())
    if (!adj.has(e.target)) adj.set(e.target, new Set())
    adj.get(e.source)!.add(e.target)
    adj.get(e.target)!.add(e.source)
  }

  const depthMap = new Map<string, number>()
  if (!docSlugs.has(rootSlug)) return depthMap
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
  return depthMap
}

// ── Graph builder ─────────────────────────────────────────────────────────────
function buildGraph(
  nodes: GraphNode[],
  edges: GraphEdge[],
  opts: {
    rootSlug?: string | null
    edgeKinds: Set<'wiki' | 'doc_tag' | 'tag_cooc'>
    showOrphans: boolean
    minDegree: number
    highlight: string
    hugeSpread: boolean
  },
): Graph {
  const { rootSlug, edgeKinds, showOrphans, minDegree, highlight, hugeSpread } = opts

  const depthMap = rootSlug ? computeDepths(nodes, edges, rootSlug) : new Map<string, number>()
  const q = highlight.trim().toLowerCase()

  // wiki degree 계산
  const deg = new Map<string, number>()
  for (const e of edges) {
    if ((e.kind ?? 'wiki') !== 'wiki') continue
    const c = e.count ?? 1
    deg.set(e.source, (deg.get(e.source) ?? 0) + c)
    deg.set(e.target, (deg.get(e.target) ?? 0) + c)
  }

  const g = new Graph({ multi: false, type: 'undirected' })

  // showOrphans=false && rootSlug 있을 때 — root 와 미연결 doc 노드 제외
  const skipSlug = new Set<string>()
  if (rootSlug && !showOrphans) {
    for (const node of nodes) {
      if ((node.kind ?? 'doc') === 'doc' && !depthMap.has(node.slug)) {
        skipSlug.add(node.slug)
      }
    }
  }

  for (const node of nodes) {
    if (skipSlug.has(node.slug)) continue

    if (node.kind === 'tag') {
      const t = node as GraphNodeTag
      const color = DOMAIN_COLOR[t.super_domain] ?? '#a78bfa'
      const size = Math.min(50, Math.max(24, Math.sqrt(t.doc_count ?? 1) * 4 + 18))
      const isHighlighted = q && (
        t.slug.toLowerCase().includes(q) || t.name.toLowerCase().includes(q)
      )
      const finalColor = isHighlighted ? HIGHLIGHT_COLOR : color
      g.addNode(t.slug, {
        label: t.name,
        type: 'circle',
        size: isHighlighted ? size * 1.2 : size,
        color: finalColor,
        borderColor: lightenHex(finalColor, 60),
        _baseColor: finalColor,
        kind: 'tag',
        docCount: t.doc_count,
        superDomain: t.super_domain,
        x: Math.random(),
        y: Math.random(),
      })
    } else {
      const d = node as GraphNodeDoc
      const isMissing = d.status === 'missing'
      const docDeg = deg.get(d.slug) ?? 0
      const isRoot = d.slug === rootSlug
      const isHighlighted = q && (
        d.slug.toLowerCase().includes(q) || d.title.toLowerCase().includes(q)
      )

      let color: string
      if (isRoot) color = ROOT_COLOR
      else if (isHighlighted) color = HIGHLIGHT_COLOR
      else if (isMissing) color = '#ef4444'
      else color = DOC_COLOR

      // 전체 보기에선 size cap 풀고 degree 강조 (큰 노드는 정말 크게).
      const baseSize = hugeSpread
        ? Math.max(10, 10 + Math.sqrt(docDeg) * 5)
        : Math.min(32, Math.max(16, 16 + Math.sqrt(docDeg) * 3))
      const finalSize = isHighlighted ? baseSize * 1.2 : baseSize

      // minDegree 미만 노드는 fade (opacity attribute 대신 색을 어둡게 — sigma 는 opacity 직접 X)
      const opacity = (!isMissing && !isRoot && docDeg < minDegree) ? 0.15 : 1
      const appliedColor = opacity < 1 ? '#1e293b' : color

      g.addNode(d.slug, {
        label: d.title,
        type: 'circle',
        size: finalSize,
        color: appliedColor,
        borderColor: opacity < 1 ? '#1e293b' : lightenHex(color, 50),
        _baseColor: appliedColor,
        kind: 'doc',
        isMissing,
        isRoot,
        x: Math.random(),
        y: Math.random(),
      })
    }
  }

  let edgeId = 0
  for (const e of edges) {
    // kind 를 string 으로 받아 'triple' 비교를 허용 — api.ts 의 GraphEdge 타입에는
    // 아직 'triple' 이 없어서(다른 에이전트 담당) 런타임 값으로 분기한다.
    const kind: string = (e as { kind?: string }).kind ?? 'wiki'
    // triple 엣지는 edgeKinds(wiki/doc_tag/tag_cooc) 필터 대상이 아니다 —
    // include_triples 토글이 별도로 BE fetch 단계에서 결정한다.
    const isTriple = kind === 'triple'
    if (!isTriple && !edgeKinds.has(kind as 'wiki' | 'doc_tag' | 'tag_cooc')) continue
    if (!g.hasNode(e.source) || !g.hasNode(e.target)) continue
    if (e.source === e.target) continue
    let color: string
    let size: number
    let label: string | undefined
    if (kind === 'wiki') {
      color = 'rgba(148,163,184,0.35)'
      size = 1 + Math.min(e.count ?? 1, 5) * 0.25
    } else if (kind === 'tag_cooc') {
      const srcDomain = g.getNodeAttribute(e.source, 'superDomain') as string | undefined
      const base = DOMAIN_COLOR[srcDomain ?? ''] ?? '#a78bfa'
      color = base + '66'
      size = Math.max(0.8, (e.weight ?? 1) / 5)
    } else if (isTriple) {
      const t = e as unknown as GraphEdgeTriple
      // llm 추출은 흐리게(alpha 낮춤), manual 입력은 진하게 — 출처 시각 구분.
      color = TRIPLE_COLOR + (t.triple_source === 'llm' ? '66' : 'ee')
      size = 1.2
      // predicate 라벨 — 30자 초과 시 잘라서 … 붙임 (sigma 도 자르지만 과도하게 길면 미리 정리)
      const p = t.predicate ?? ''
      label = p.length > 30 ? p.slice(0, 30) + '…' : p
    } else {
      color = 'rgba(203,213,225,0.2)'
      size = 0.5
    }
    try {
      // label 은 triple 엣지에만 부여 — sigma 는 label 있는 엣지만 라벨을 그리므로
      // renderEdgeLabels:true 여도 wiki/tag 엣지는 라벨이 안 뜬다.
      g.addEdgeWithKey(`e${edgeId++}`, e.source, e.target, {
        kind, color, size, _baseColor: color,
        ...(label !== undefined ? { label } : {}),
      })
    } catch {
      // 중복 edge skip
    }
  }

  return g
}

// ── KnowledgeGraph component ──────────────────────────────────────────────────
const DEFAULT_EDGE_KINDS = new Set<'wiki' | 'doc_tag' | 'tag_cooc'>(['wiki', 'doc_tag'])

const FA2_CALM = {
  gravity: 0.05,
  scalingRatio: 80,
  adjustSizes: true,
  barnesHutOptimize: false,
  slowDown: 10,
  linLogMode: true,
}

const FA2_DRAG = {
  ...FA2_CALM,
  slowDown: 2,
  scalingRatio: 120,
}

export function KnowledgeGraph({
  nodes,
  edges,
  rootSlug = null,
  highlight = '',
  height = 640,
  edgeKinds = DEFAULT_EDGE_KINDS,
  showOrphans = true,
  minDegree = 0,
  hugeSpread = false,
  onPickNode,
  onPickTag,
  onContextMenu,
}: KnowledgeGraphProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const sigmaRef = useRef<Sigma | null>(null)
  const layoutRef = useRef<FA2LayoutSupervisor | null>(null)

  // nodes/edges/필터 변경 시 그래프 재구성
  useEffect(() => {
    if (!containerRef.current) return

    // 이전 인스턴스 정리
    layoutRef.current?.kill()
    layoutRef.current = null
    sigmaRef.current?.kill()
    sigmaRef.current = null

    const g = buildGraph(nodes, edges, {
      rootSlug,
      edgeKinds,
      showOrphans,
      minDegree,
      highlight,
      hugeSpread,
    })

    // ── 목표 위치 사전 계산 ─────────────────────────────────────────────────
    // sigma 띄우기 전에 동기 FA2 + noverlap 으로 안 겹치는 좌표를 미리 계산해서
    // 노드 attribute `_targetX/_targetY` 에 저장. 그 후 사용자에게는 작은 랜덤
    // 위치에서 시작해 그 목표로 부드럽게 lerp 하며 도착하는 애니메이션을 보여줌.
    // → 초기 프레임부터 "정돈된 곳으로 가고 있는" 화면이 보이고, 도착 시점에
    //   이미 겹침 없는 상태.
    g.forEachNode((node) => {
      g.setNodeAttribute(node, 'x', (Math.random() - 0.5) * 2)
      g.setNodeAttribute(node, 'y', (Math.random() - 0.5) * 2)
    })

    // 1) 동기 FA2 — 노드 수에 비례한 반복 + 강한 척력으로 시원하게 펼침.
    //    scalingRatio 가 클수록 노드 간 척력 강함. hugeSpread 에선 척력을 훨씬
    //    더 키워서 캔버스 끝까지 흩뜨림 (멀리서 봐도 군집이 보이도록).
    const fa2Iters = Math.min(4000, Math.max(500, g.order * 20))
    forceAtlas2.assign(g, {
      iterations: fa2Iters,
      settings: {
        ...FA2_CALM,
        scalingRatio: hugeSpread ? 4000 : 300,
        gravity: hugeSpread ? 0.001 : 0.02,
      },
    })

    // 2) 동기 noverlap — 겹침만 해소하는 미세 분리 (구조 유지).
    //    hugeSpread 에선 margin 더 키워서 노드 간 시각 여백 확보.
    noverlap.assign(g, {
      maxIterations: 400,
      settings: {
        margin: hugeSpread ? 60 : 12,
        ratio: 1.05,
        expansion: hugeSpread ? 1.2 : 1.05,
        gridSize: 20,
        speed: 5,
      },
    })

    // 2.5) bbox 기준 정규화 + 캔버스 종횡비 매칭.
    //     FA2 가 만든 좌표는 종횡비가 정해지지 않아서 sigma 가 fit 시 한쪽으로
    //     좁아 보일 수 있다. bbox 를 잡고 캔버스 종횡비 (w/h) 에 맞게 늘려서
    //     캔버스 공간을 가득 채움.
    const canvasW = containerRef.current.clientWidth || 800
    const canvasH = (typeof height === 'number' ? height : 600)
    const aspect = canvasW / canvasH
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    g.forEachNode((node) => {
      const x = g.getNodeAttribute(node, 'x') as number
      const y = g.getNodeAttribute(node, 'y') as number
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    })
    const bboxW = Math.max(1, maxX - minX)
    const bboxH = Math.max(1, maxY - minY)
    const bboxAspect = bboxW / bboxH
    // 캔버스보다 좁으면 x 를 늘리고, 넓으면 y 를 늘림.
    const stretchX = bboxAspect < aspect ? aspect / bboxAspect : 1
    const stretchY = bboxAspect > aspect ? bboxAspect / aspect : 1
    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2
    g.forEachNode((node) => {
      const x = g.getNodeAttribute(node, 'x') as number
      const y = g.getNodeAttribute(node, 'y') as number
      g.setNodeAttribute(node, 'x', cx + (x - cx) * stretchX)
      g.setNodeAttribute(node, 'y', cy + (y - cy) * stretchY)
    })

    // 3) 계산된 목표 좌표를 별도 attribute 로 저장하고, 화면 표시는 작은
    //    랜덤 위치에서 시작.
    g.forEachNode((node) => {
      const tx = g.getNodeAttribute(node, 'x') as number
      const ty = g.getNodeAttribute(node, 'y') as number
      g.setNodeAttribute(node, '_targetX', tx)
      g.setNodeAttribute(node, '_targetY', ty)
      g.setNodeAttribute(node, 'x', (Math.random() - 0.5) * 4)
      g.setNodeAttribute(node, 'y', (Math.random() - 0.5) * 4)
    })

    // 4) lerp 애니메이션 — 약 1.2s 동안 시작점 → 목표로 부드럽게 이동.
    //    ease-out (1 - (1-t)^3) 으로 자연스럽게 감속. 시작 위치를 별도로
    //    보관해서 매 프레임 (start + (target-start) * eased) 로 계산 — 단순/정확.
    g.forEachNode((node) => {
      g.setNodeAttribute(node, '_startX', g.getNodeAttribute(node, 'x'))
      g.setNodeAttribute(node, '_startY', g.getNodeAttribute(node, 'y'))
    })

    let arriveAnimTimer: number | null = null
    const animStart = performance.now()
    const ANIM_DURATION = 1200
    const animateArrive = () => {
      const elapsed = performance.now() - animStart
      const t = Math.min(1, elapsed / ANIM_DURATION)
      const eased = 1 - Math.pow(1 - t, 3)
      g.forEachNode((node) => {
        const sx = g.getNodeAttribute(node, '_startX') as number
        const sy = g.getNodeAttribute(node, '_startY') as number
        const tx = g.getNodeAttribute(node, '_targetX') as number
        const ty = g.getNodeAttribute(node, '_targetY') as number
        g.setNodeAttribute(node, 'x', sx + (tx - sx) * eased)
        g.setNodeAttribute(node, 'y', sy + (ty - sy) * eased)
      })
      if (t < 1) {
        arriveAnimTimer = window.requestAnimationFrame(animateArrive)
      } else {
        arriveAnimTimer = null
      }
    }
    arriveAnimTimer = window.requestAnimationFrame(animateArrive)

    // 5) FA2 worker — 도착 애니메이션이 끝난 뒤 미세 조정만 (짧게).
    const layout = new FA2LayoutSupervisor(g, { settings: FA2_CALM })
    layoutRef.current = layout

    const initialStopTimer = window.setTimeout(() => {
      // 애니메이션 끝나면 worker 잠깐 돌려서 자연스럽게 안정화.
      layout.start()
      window.setTimeout(() => layout.stop(), 800)
    }, ANIM_DURATION + 50)

    const renderer = new Sigma(g, containerRef.current, {
      nodeProgramClasses: {
        circle: createNodeBorderProgram({
          borders: [
            { size: { value: 0.1 }, color: { attribute: 'borderColor' } },
            { size: { fill: true }, color: { attribute: 'color' } },
          ],
        }),
      },
      defaultNodeType: 'circle',
      renderLabels: true,
      defaultDrawNodeLabel: drawInnerLabel,
      labelDensity: 1,
      labelGridCellSize: 80,
      labelRenderedSizeThreshold: 6,
      minCameraRatio: 0.05,
      maxCameraRatio: 10,
      // label attribute 가 있는 엣지(=triple)만 라벨이 그려진다 — wiki/tag 엣지엔
      // label 을 안 넣었으므로 triple predicate 만 화면에 표시된다.
      renderEdgeLabels: true,
      defaultEdgeColor: 'rgba(148,163,184,0.3)',
      zIndex: true,
    })
    sigmaRef.current = renderer

    // ── Hover + Focus (long-press 로 진입) ────────────────────────────────────
    // hoveredNode: 마우스 올라간 노드 — 임시 강조
    // focusedNode: long-press 로 잠근 노드 — 1-hop 만 보이고 나머지는 숨김
    //              더블클릭 stage 로 해제됨
    let hoveredNode: string | null = null
    let focusedNode: string | null = null
    let focusedNeighbors: Set<string> = new Set()

    const buildFocusedNeighbors = (node: string): Set<string> => {
      const s = new Set<string>([node])
      for (const nb of g.neighbors(node)) s.add(nb)
      return s
    }

    const applyReducers = () => {
      renderer.setSetting('nodeReducer', (node, data) => {
        // focus 모드 — 1-hop 이외는 완전 숨김
        if (focusedNode) {
          if (!focusedNeighbors.has(node)) {
            return { ...data, hidden: true }
          }
          if (node === focusedNode) {
            return {
              ...data,
              color: HOVER_SELF_COLOR,
              borderColor: lightenHex(HOVER_SELF_COLOR, 80),
              size: (data.size ?? 10) * 1.3,
              zIndex: 2,
              forceLabel: true,
            }
          }
          return {
            ...data,
            color: HOVER_NEIGHBOR_COLOR,
            borderColor: lightenHex(HOVER_NEIGHBOR_COLOR, 80),
            size: (data.size ?? 10) * 1.1,
            zIndex: 1,
            forceLabel: true,
          }
        }
        // 일반 hover
        if (!hoveredNode) return data
        if (node === hoveredNode) {
          return {
            ...data,
            color: HOVER_SELF_COLOR,
            borderColor: lightenHex(HOVER_SELF_COLOR, 80),
            size: (data.size ?? 10) * 1.25,
            zIndex: 2,
            forceLabel: true,
          }
        }
        if (g.neighbors(hoveredNode).includes(node)) {
          return {
            ...data,
            color: HOVER_NEIGHBOR_COLOR,
            borderColor: lightenHex(HOVER_NEIGHBOR_COLOR, 80),
            size: (data.size ?? 10) * 1.05,
            zIndex: 1,
            forceLabel: true,
          }
        }
        return {
          ...data,
          color: '#1e293b',
          borderColor: '#1e293b',
          label: null,
          zIndex: 0,
        }
      })

      renderer.setSetting('edgeReducer', (edge, data) => {
        const [src, tgt] = g.extremities(edge)
        // focus 모드 — focusedNode 와 직결된 엣지만 표시
        if (focusedNode) {
          if (src === focusedNode || tgt === focusedNode) {
            return { ...data, color: HOVER_SELF_COLOR + 'cc', size: (data.size ?? 1) * 2 }
          }
          return { ...data, hidden: true }
        }
        // 일반 hover
        if (!hoveredNode) return data
        if (src === hoveredNode || tgt === hoveredNode) {
          return { ...data, color: HOVER_SELF_COLOR + 'cc', size: (data.size ?? 1) * 2 }
        }
        return { ...data, hidden: true }
      })
    }

    const clearReducers = () => {
      // focus 가 켜져 있으면 reducers 유지 (hover 만 풀린 거).
      if (focusedNode) {
        applyReducers()
        return
      }
      renderer.setSetting('nodeReducer', null)
      renderer.setSetting('edgeReducer', null)
    }

    renderer.on('enterNode', ({ node }) => {
      hoveredNode = node
      applyReducers()
      renderer.refresh()
    })

    renderer.on('leaveNode', () => {
      hoveredNode = null
      clearReducers()
      renderer.refresh()
    })

    // ── Drag ──────────────────────────────────────────────────────────────────
    let draggedNode: string | null = null
    let isDragging = false
    let resumedStopTimer: number | null = null
    let mouseTarget: { x: number; y: number } | null = null
    let chaseTimer: number | null = null

    const stopChase = () => {
      if (chaseTimer) {
        window.cancelAnimationFrame(chaseTimer)
        chaseTimer = null
      }
    }

    const chase = () => {
      if (!draggedNode || !mouseTarget) { stopChase(); return }
      const cx = g.getNodeAttribute(draggedNode, 'x') as number
      const cy = g.getNodeAttribute(draggedNode, 'y') as number
      const dx = mouseTarget.x - cx
      const dy = mouseTarget.y - cy
      g.setNodeAttribute(draggedNode, 'x', cx + dx * 0.15)
      g.setNodeAttribute(draggedNode, 'y', cy + dy * 0.15)
      chaseTimer = window.requestAnimationFrame(chase)
    }

    // long-press 감지 — 500ms 이상 같은 노드를 누르고 있고 드래그가 아니면
    // focus 진입 (= toggle: 이미 focus 상태면 해제).
    // long-press 가 발동한 직후의 mouse-up 은 sigma 가 'clickNode' 를 그대로
    // emit 하므로 doc 이 열려버린다. longPressFired 플래그로 그 다음 click 만
    // 무시하고, 정상 클릭 (long-press 전에 손 떼는 경우) 는 그대로 통과.
    let longPressTimer: number | null = null
    let longPressFired = false
    const cancelLongPress = () => {
      if (longPressTimer) {
        window.clearTimeout(longPressTimer)
        longPressTimer = null
      }
    }

    renderer.on('downNode', ({ node }) => {
      draggedNode = node
      isDragging = false
      g.setNodeAttribute(draggedNode, 'fixed', true)
      renderer.getCamera().disable()

      layoutRef.current?.kill()
      const dragLayout = new FA2LayoutSupervisor(g, { settings: FA2_DRAG })
      layoutRef.current = dragLayout
      dragLayout.start()

      mouseTarget = {
        x: g.getNodeAttribute(node, 'x') as number,
        y: g.getNodeAttribute(node, 'y') as number,
      }
      stopChase()
      chase()

      // 500ms 안 움직이고 누르고 있으면 focus toggle.
      cancelLongPress()
      longPressTimer = window.setTimeout(() => {
        if (isDragging) return  // 드래그 중이면 long-press 무시
        // toggle: 같은 노드를 다시 long-press 하면 해제
        if (focusedNode === node) {
          focusedNode = null
          focusedNeighbors = new Set()
          clearReducers()
          renderer.refresh()
        } else {
          focusedNode = node
          focusedNeighbors = buildFocusedNeighbors(node)
          applyReducers()
          reshuffleAround(node)
        }
        // 곧 발생할 mouse-up 의 clickNode 를 소비할 플래그 + drag 가장.
        longPressFired = true
        isDragging = true
      }, 500) as unknown as number
    })

    renderer.on('moveBody', ({ event }) => {
      if (!draggedNode) return
      // 마우스가 움직이면 long-press 가 아니라 drag — 타이머 취소.
      cancelLongPress()
      isDragging = true
      mouseTarget = renderer.viewportToGraph({ x: event.x, y: event.y })
    })

    const stopDrag = () => {
      cancelLongPress()
      stopChase()
      draggedNode = null
      isDragging = false
      mouseTarget = null
      renderer.getCamera().enable()

      layoutRef.current?.kill()
      const calmLayout = new FA2LayoutSupervisor(g, { settings: FA2_CALM })
      layoutRef.current = calmLayout
      calmLayout.start()

      if (resumedStopTimer) window.clearTimeout(resumedStopTimer)
      resumedStopTimer = window.setTimeout(() => {
        calmLayout.stop()
        noverlap.assign(g, {
          maxIterations: 150,
          settings: {
            margin: 8,
            ratio: 1.1,
            expansion: 1.2,
            gridSize: 20,
            speed: 3,
          },
        })
        renderer.refresh()
      }, 600)
    }

    renderer.on('upNode', stopDrag)
    renderer.on('upStage', stopDrag)

    // ── Click ─────────────────────────────────────────────────────────────────
    renderer.on('clickNode', ({ node }) => {
      if (isDragging) return
      // long-press 가 방금 발동했다면 그에 따라온 click 은 무시 (1회 소비).
      if (longPressFired) {
        longPressFired = false
        return
      }
      const kind = g.getNodeAttribute(node, 'kind') as string
      if (kind === 'tag') {
        if (onPickTag) onPickTag(node)
      } else {
        const isMissing = g.getNodeAttribute(node, 'isMissing') as boolean
        if (!isMissing && onPickNode) onPickNode(node)
      }
    })

    // ── Right-click ───────────────────────────────────────────────────────────
    renderer.on('rightClickNode', ({ node, event }) => {
      const kind = g.getNodeAttribute(node, 'kind') as string
      const isMissing = kind === 'doc' && (g.getNodeAttribute(node, 'isMissing') as boolean)
      if (isMissing) return
      if (onContextMenu) {
        event.original.preventDefault()
        const orig = event.original as MouseEvent
        onContextMenu(node, orig.clientX, orig.clientY)
      }
    })

    // ── Double-click stage = 방사형 폭발 재배치 ────────────────────────────────
    // 클릭 지점을 origin 으로 두고, 각 노드를 (origin → node) 방향으로 랜덤한
    // 각도/거리만큼 더 멀리 밀어냄. origin 에서 멀리 있는 노드일수록 더 많이
    // 이동 → 자연스럽게 안 겹치고 방사상으로 퍼짐.
    let reshuffleTimer: number | null = null
    const reshuffle = (originX: number, originY: number) => {
      // FA2 / chase / arrive 모두 정지.
      layoutRef.current?.kill()
      layoutRef.current = null
      if (arriveAnimTimer) window.cancelAnimationFrame(arriveAnimTimer)
      if (reshuffleTimer) window.cancelAnimationFrame(reshuffleTimer)

      // 현재 그래프의 bbox — 이동 거리 단위 (반지름) 산정용.
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
      g.forEachNode((node) => {
        const x = g.getNodeAttribute(node, 'x') as number
        const y = g.getNodeAttribute(node, 'y') as number
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      })
      const diag = Math.hypot(maxX - minX, maxY - minY)
      // 같은 거리에 있는 노드들이 겹치지 않도록 origin 에서의 거리로 정규화한
      // 후, 그 값을 * (지터 + 0.6-1.4 의 랜덤 계수) 로 곱해 거리 산정.
      // 최종 거리 = baseDist * (1 + jitter*0.5) — baseDist 는 origin↔node 의
      // 현재 거리이고, 거기에 추가로 50% 정도 더 멀리 + 각도 약간 비틈.

      const nodeList = g.nodes()
      const targets: Record<string, { x: number; y: number; sx: number; sy: number }> = {}
      for (const node of nodeList) {
        const cx = g.getNodeAttribute(node, 'x') as number
        const cy = g.getNodeAttribute(node, 'y') as number
        const dx0 = cx - originX
        const dy0 = cy - originY
        const baseDist = Math.hypot(dx0, dy0)
        // baseDist 가 매우 작은 (origin 위) 노드도 어딘가로 밀려나야 하므로
        // 최소 반지름 보장 — diag 의 15% 이상 (origin 위에 몰린 노드들도
        // 충분히 퍼지도록).
        const minR = diag * 0.15
        // 현재 거리를 기반으로 더 멀리. 멀수록 더 많이 (× 2.5 ~ × 4.0).
        // 더 큰 배율로 캔버스 끝까지 시원하게 흩뜨림.
        const farMult = 2.5 + Math.random() * 1.5
        const baseR = Math.max(minR, baseDist) * farMult
        // 각도: 원래 방향에서 ±35° 정도 랜덤 비틈 (origin 위 노드는 완전 랜덤).
        const baseAngle = baseDist < 1e-6 ? Math.random() * Math.PI * 2 : Math.atan2(dy0, dx0)
        const angleJitter = (Math.random() - 0.5) * (Math.PI / 180) * 70
        const ang = baseAngle + angleJitter
        // 약간의 추가 랜덤 (셀룰러한 느낌 없애기).
        const r = baseR * (0.85 + Math.random() * 0.3)
        targets[node] = {
          sx: cx,
          sy: cy,
          x: originX + Math.cos(ang) * r,
          y: originY + Math.sin(ang) * r,
        }
      }

      // 3.5s 동안 ease-in-out-cubic 으로 lerp 이동.
      const DURATION = 3500
      const start = performance.now()
      const step = () => {
        const t = Math.min(1, (performance.now() - start) / DURATION)
        const eased = t < 0.5
          ? 4 * t * t * t
          : 1 - Math.pow(-2 * t + 2, 3) / 2
        for (const node of nodeList) {
          const tg = targets[node]
          if (!tg) continue
          g.setNodeAttribute(node, 'x', tg.sx + (tg.x - tg.sx) * eased)
          g.setNodeAttribute(node, 'y', tg.sy + (tg.y - tg.sy) * eased)
        }
        if (t < 1) {
          reshuffleTimer = window.requestAnimationFrame(step)
        } else {
          reshuffleTimer = null
          // 도착 후 강한 충돌 해소 패스:
          // 1) noverlap (그래프 size 기반 — sigma 렌더링 크기와 1:1 아님).
          noverlap.assign(g, {
            maxIterations: 200,
            settings: { margin: hugeSpread ? 30 : 12, ratio: 1.05, expansion: 1.05, gridSize: 20, speed: 3 },
          })
          // 2) "각 노드 반경의 1.3배 내 침범 금지" 직접 분리 (좌표 공간 기준).
          //
          // 문제: sigma 의 node `size` 는 픽셀-ish 단위라 layout 좌표와 스케일
          // 이 다름. size 합 그대로 쓰면 너무 작게 밀어내져 겹침이 안 해소됨.
          //
          // 해법: 좌표 공간의 bbox 기반으로 노드당 평균 반경을 추정.
          //   - bbox 면적 = W × H, 노드 수 = N
          //   - 노드당 셀 한 변 ≈ sqrt(W*H/N)
          //   - 분리 최소 반경 = 셀 변 × 0.5 (이웃끼리 셀 변 정도 거리)
          //   - 각 노드의 size 비율을 곱해서 큰 노드는 더 멀리.
          let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity
          g.forEachNode((node) => {
            const x = g.getNodeAttribute(node, 'x') as number
            const y = g.getNodeAttribute(node, 'y') as number
            if (x < bx0) bx0 = x
            if (x > bx1) bx1 = x
            if (y < by0) by0 = y
            if (y > by1) by1 = y
          })
          const bboxArea = Math.max(1, (bx1 - bx0) * (by1 - by0))
          const cellSide = Math.sqrt(bboxArea / Math.max(1, g.order))
          // BASE_R 을 셀 한 변 정도로 잡아서 이웃끼리 셀 폭만큼 떨어지게 함.
          // 이전 0.5 는 너무 짧아서 겹침이 안 풀림.
          const BASE_R = cellSide * 1.2
          const COLLISION_RATIO = 1.6

          // 각 노드의 effective radius (좌표 단위) = BASE_R × (size/avgSize).
          let avgSize = 0
          g.forEachNode((n) => { avgSize += g.getNodeAttribute(n, 'size') as number })
          avgSize = Math.max(1, avgSize / Math.max(1, g.order))
          const effR: Record<string, number> = {}
          g.forEachNode((n) => {
            const sz = g.getNodeAttribute(n, 'size') as number
            effR[n] = BASE_R * (0.6 + 0.8 * (sz / avgSize))
          })

          const PASSES = hugeSpread ? 14 : 8
          const nodes2 = g.nodes()

          // 공간 분할 그리드 broad-phase — O(N²) → O(N × k).
          // 셀 크기 = 최대 분리 거리. 한 노드는 자기 셀 + 인접 8 셀의 노드만 검사.
          // maxEffR × 2 × COLLISION_RATIO 가 가능한 최대 minDist.
          let maxR = 0
          g.forEachNode((n) => { if (effR[n]! > maxR) maxR = effR[n]! })
          const CELL = Math.max(1, maxR * 2 * COLLISION_RATIO)

          // 노드의 현재 위치를 캐시 (Map<key, [x,y]>) 후 각 패스마다 갱신.
          // graphology attribute 접근보다 array 가 훨씬 빠름.
          const px = new Float64Array(nodes2.length)
          const py = new Float64Array(nodes2.length)
          const pr = new Float64Array(nodes2.length)
          for (let i = 0; i < nodes2.length; i++) {
            px[i] = g.getNodeAttribute(nodes2[i]!, 'x') as number
            py[i] = g.getNodeAttribute(nodes2[i]!, 'y') as number
            pr[i] = effR[nodes2[i]!]!
          }

          for (let pass = 0; pass < PASSES; pass++) {
            // 그리드 빌드.
            const grid = new Map<string, number[]>()
            for (let i = 0; i < nodes2.length; i++) {
              const cx = Math.floor(px[i]! / CELL)
              const cy = Math.floor(py[i]! / CELL)
              const k = cx + ',' + cy
              let arr = grid.get(k)
              if (!arr) { arr = []; grid.set(k, arr) }
              arr.push(i)
            }

            // 이웃 셀 (자기 셀 포함) 9 개에 대해서만 충돌 검사.
            for (let i = 0; i < nodes2.length; i++) {
              const cx = Math.floor(px[i]! / CELL)
              const cy = Math.floor(py[i]! / CELL)
              for (let oy = -1; oy <= 1; oy++) {
                for (let ox = -1; ox <= 1; ox++) {
                  const arr = grid.get((cx + ox) + ',' + (cy + oy))
                  if (!arr) continue
                  for (const j of arr) {
                    if (j <= i) continue
                    let dx = px[j]! - px[i]!
                    let dy = py[j]! - py[i]!
                    let d = Math.hypot(dx, dy)
                    const minDist = (pr[i]! + pr[j]!) * COLLISION_RATIO
                    if (d < minDist) {
                      if (d < 1e-6) {
                        const a2 = Math.random() * Math.PI * 2
                        dx = Math.cos(a2)
                        dy = Math.sin(a2)
                        d = 1
                      }
                      const push = (minDist - d) / 2
                      const nx = dx / d
                      const ny = dy / d
                      px[i]! -= nx * push
                      py[i]! -= ny * push
                      px[j]! += nx * push
                      py[j]! += ny * push
                    }
                  }
                }
              }
            }
          }

          // 캐시 → graphology 반영.
          for (let i = 0; i < nodes2.length; i++) {
            g.setNodeAttribute(nodes2[i]!, 'x', px[i]!)
            g.setNodeAttribute(nodes2[i]!, 'y', py[i]!)
          }
          renderer.refresh()
        }
      }
      reshuffleTimer = window.requestAnimationFrame(step)
    }

    renderer.on('doubleClickStage', ({ event }) => {
      event.preventSigmaDefault()
      // focus 가 켜져 있으면 먼저 해제 (모든 노드 다시 활성화).
      if (focusedNode) {
        focusedNode = null
        focusedNeighbors = new Set()
        clearReducers()
        renderer.refresh()
        return
      }
      const gpt = renderer.viewportToGraph({ x: event.x, y: event.y })
      reshuffle(gpt.x, gpt.y)
    })

    // ── Touch 지원 ─────────────────────────────────────────────────────────────
    // Sigma 의 마우스 captor 가 emit 하는 downNode/upNode 는 터치에선 발동하지
    // 않음. touchCaptor 의 touchdown/touchup/touchmove 를 따로 받아서
    // long-press 토글을 처리한다.
    //
    // 노드 hit-test: sigma 의 private getNodeAtPosition 을 못 쓰므로 viewport
    // → graph 좌표 변환 후 모든 노드와 거리 비교. size 는 sigma 단위 (~10-30)
    // 이고 좌표는 layout 단위라 직접 비교 불가 → camera ratio 와 dimensions
    // 로 viewport 픽셀 거리를 환산해서 size+pad 안인지 본다.
    const findNodeAtViewport = (vx: number, vy: number): string | null => {
      const { width, height } = renderer.getDimensions()
      // viewport 픽셀 기준 hit-test — 각 노드를 viewport 로 투영해 거리 비교.
      let best: { node: string; d: number } | null = null
      g.forEachNode((node) => {
        const data = renderer.getNodeDisplayData(node)
        if (!data) return
        const v = renderer.graphToViewport({ x: data.x, y: data.y })
        const dx = v.x - vx
        const dy = v.y - vy
        const d = Math.hypot(dx, dy)
        // 노드 size 는 그래프 좌표 size 가 아니라 sigma 표시 size 라 픽셀에
        // 가깝다. 작은 노드도 누르기 편하도록 +6 padding.
        const radPx = (data.size ?? 8) + 6
        if (d < radPx && (!best || d < best.d)) {
          best = { node, d }
        }
      })
      // Narrowing 우회: forEachNode 콜백 안에서 best 를 변경하기 때문에 TS 가
      // 외부 변수 타입을 좁히고 못 풀어줌. as 로 명시.
      const b = best as { node: string; d: number } | null
      return b ? b.node : null
    }

    let touchStartNode: string | null = null
    let touchLongPressTimer: number | null = null
    let touchMoved = false
    let touchStartPos: { x: number; y: number } | null = null

    const cancelTouchLongPress = () => {
      if (touchLongPressTimer) {
        window.clearTimeout(touchLongPressTimer)
        touchLongPressTimer = null
      }
    }

    // sigma 의 touch 이벤트는 mouse 이벤트와 별도 captor 에서 emit 됨.
    const touchCaptor = renderer.getTouchCaptor()

    touchCaptor.on('touchdown', ({ touches }) => {
      if (touches.length !== 1) {
        cancelTouchLongPress()
        touchStartNode = null
        return
      }
      const t = touches[0]!
      const nodeAt = findNodeAtViewport(t.x, t.y)
      if (!nodeAt) {
        touchStartNode = null
        return
      }
      touchStartNode = nodeAt
      touchMoved = false
      touchStartPos = { x: t.x, y: t.y }
      cancelTouchLongPress()
      touchLongPressTimer = window.setTimeout(() => {
        if (touchMoved || !touchStartNode) return
        const node = touchStartNode
        if (focusedNode === node) {
          focusedNode = null
          focusedNeighbors = new Set()
          clearReducers()
          renderer.refresh()
        } else {
          focusedNode = node
          focusedNeighbors = buildFocusedNeighbors(node)
          applyReducers()
          reshuffleAround(node)
        }
        touchStartNode = null
      }, 500) as unknown as number
    })

    touchCaptor.on('touchmove', ({ touches }) => {
      if (!touchStartPos || touches.length !== 1) {
        cancelTouchLongPress()
        return
      }
      const t = touches[0]!
      const dx = t.x - touchStartPos.x
      const dy = t.y - touchStartPos.y
      if (Math.hypot(dx, dy) > 10) {
        touchMoved = true
        cancelTouchLongPress()
      }
    })

    touchCaptor.on('touchup', () => {
      cancelTouchLongPress()
      touchStartNode = null
      touchStartPos = null
      touchMoved = false
    })

    // focus 진입 시 그 노드 중심으로 1-hop 들을 작은 원으로 모아 정렬하는 헬퍼.
    // (방사형 폭발의 거꾸로 — 안쪽으로 끌어옴.)
    let focusAnimTimer: number | null = null
    const reshuffleAround = (centerNode: string) => {
      // 다른 애니메이션 멈춤.
      layoutRef.current?.kill()
      layoutRef.current = null
      if (arriveAnimTimer) window.cancelAnimationFrame(arriveAnimTimer)
      if (reshuffleTimer) window.cancelAnimationFrame(reshuffleTimer)
      if (focusAnimTimer) window.cancelAnimationFrame(focusAnimTimer)

      const cx0 = g.getNodeAttribute(centerNode, 'x') as number
      const cy0 = g.getNodeAttribute(centerNode, 'y') as number
      const neighbors = Array.from(focusedNeighbors).filter((n) => n !== centerNode)

      // bbox 기반으로 단위 거리 추정.
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
      g.forEachNode((node) => {
        const x = g.getNodeAttribute(node, 'x') as number
        const y = g.getNodeAttribute(node, 'y') as number
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      })
      const diag = Math.hypot(maxX - minX, maxY - minY)
      // 이웃 수에 따라 동심원 몇 겹으로 나눌지 결정 — 너무 등거리로 한 줄에
      // 늘어놓으면 다 겹쳐 보임. 한 ring 당 적정 수는 ~8-12.
      const N = Math.max(1, neighbors.length)
      const PER_RING = 10
      const rings = Math.max(1, Math.ceil(N / PER_RING))
      // 각 ring 의 반지름: 내부 ring 은 짧게, 바깥일수록 크게.
      const ringBase = Math.max(diag * 0.06, 40)
      const ringStep = Math.max(diag * 0.05, 35)

      // size 가 큰 노드를 바깥 ring 으로 (더 멀리 → 시각적 균형).
      const sortedNb = neighbors.slice().sort((a, b) => {
        const sa = g.getNodeAttribute(a, 'size') as number
        const sb = g.getNodeAttribute(b, 'size') as number
        return sa - sb
      })

      const targets: Record<string, { x: number; y: number; sx: number; sy: number }> = {}
      sortedNb.forEach((nb, i) => {
        const ringIdx = Math.min(rings - 1, Math.floor(i / PER_RING))
        const ringStart = ringIdx * PER_RING
        const ringSize = Math.min(PER_RING, sortedNb.length - ringStart)
        const inRingIdx = i - ringStart
        // 인접 ring 끼리 각도를 절반 오프셋해서 방사상으로 겹치지 않게.
        const angOffset = (ringIdx % 2) * (Math.PI / Math.max(ringSize, 1))
        const ang =
          (inRingIdx / Math.max(1, ringSize)) * Math.PI * 2
          + angOffset
          + (Math.random() - 0.5) * 0.25
        const rr =
          ringBase
          + ringIdx * ringStep
          + (Math.random() - 0.5) * ringStep * 0.2
        targets[nb] = {
          sx: g.getNodeAttribute(nb, 'x') as number,
          sy: g.getNodeAttribute(nb, 'y') as number,
          x: cx0 + Math.cos(ang) * rr,
          y: cy0 + Math.sin(ang) * rr,
        }
      })

      const DURATION = 800
      const start = performance.now()
      const step = () => {
        const t = Math.min(1, (performance.now() - start) / DURATION)
        const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
        for (const nb of neighbors) {
          const tg = targets[nb]
          if (!tg) continue
          g.setNodeAttribute(nb, 'x', tg.sx + (tg.x - tg.sx) * eased)
          g.setNodeAttribute(nb, 'y', tg.sy + (tg.y - tg.sy) * eased)
        }
        if (t < 1) {
          focusAnimTimer = window.requestAnimationFrame(step)
        } else {
          focusAnimTimer = null
          // 도착 후 1-hop 노드들끼리만 충돌 해소 — center 는 고정.
          // 좌표 공간 기준 분리 반경 = ringBase 의 30% 정도, 4 pass.
          const sepBase = ringBase * 0.5
          const visible = neighbors
          const px = new Float64Array(visible.length)
          const py = new Float64Array(visible.length)
          const pr = new Float64Array(visible.length)
          for (let i = 0; i < visible.length; i++) {
            px[i] = g.getNodeAttribute(visible[i]!, 'x') as number
            py[i] = g.getNodeAttribute(visible[i]!, 'y') as number
            const sz = g.getNodeAttribute(visible[i]!, 'size') as number
            pr[i] = sepBase * (0.7 + 0.6 * (sz / 24))
          }
          const RATIO = 1.5
          for (let pass = 0; pass < 6; pass++) {
            for (let i = 0; i < visible.length; i++) {
              for (let j = i + 1; j < visible.length; j++) {
                let dx = px[j]! - px[i]!
                let dy = py[j]! - py[i]!
                let d = Math.hypot(dx, dy)
                const minDist = (pr[i]! + pr[j]!) * RATIO
                if (d < minDist) {
                  if (d < 1e-6) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d = Math.hypot(dx, dy) }
                  const push = (minDist - d) / 2
                  const nx = dx / d
                  const ny = dy / d
                  px[i]! -= nx * push
                  py[i]! -= ny * push
                  px[j]! += nx * push
                  py[j]! += ny * push
                }
              }
            }
          }
          for (let i = 0; i < visible.length; i++) {
            g.setNodeAttribute(visible[i]!, 'x', px[i]!)
            g.setNodeAttribute(visible[i]!, 'y', py[i]!)
          }
          renderer.refresh()
        }
      }
      focusAnimTimer = window.requestAnimationFrame(step)
    }

    return () => {
      window.clearTimeout(initialStopTimer)
      if (resumedStopTimer) window.clearTimeout(resumedStopTimer)
      if (arriveAnimTimer) window.cancelAnimationFrame(arriveAnimTimer)
      if (reshuffleTimer) window.cancelAnimationFrame(reshuffleTimer)
      if (focusAnimTimer) window.cancelAnimationFrame(focusAnimTimer)
      cancelLongPress()
      cancelTouchLongPress()
      stopChase()
      layoutRef.current?.kill()
      layoutRef.current = null
      renderer.kill()
      sigmaRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, rootSlug, highlight, edgeKinds, showOrphans, minDegree, onPickNode, onPickTag, onContextMenu])

  return (
    <div
      ref={containerRef}
      style={{ height, background: '#0f172a' }}
      className="w-full rounded"
    />
  )
}

export default KnowledgeGraph
