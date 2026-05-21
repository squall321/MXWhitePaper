/**
 * SigmaDemo — sigma.js 지식그래프 데모 (v2, upgraded).
 *
 * 변경 요약 (기존 GraphCanvas / Graph.tsx 는 건드리지 않음):
 *  - 원형 노드 (NodeCircleProgram — sigma 내장)
 *  - 라벨 원 안쪽 중앙 렌더 (defaultDrawNodeLabel 재정의, Canvas layer)
 *  - FA2LayoutSupervisor worker — drag 중에도 충돌방지 layout 지속
 *  - hover: 자신=주황, 1-hop=분홍, 나머지=fade + 라벨 숨김
 *  - 어두운 배경 그라데이션, edge 투명도
 *  - 폰트: Inter + 시스템 sans 스택 (index.html 기존 스택 활용)
 *
 * Route: /sigma-demo
 */
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import Graph from 'graphology'
import { circular } from 'graphology-layout'
import forceAtlas2 from 'graphology-layout-forceatlas2'
import FA2LayoutSupervisor from 'graphology-layout-forceatlas2/worker'
import noverlap from 'graphology-layout-noverlap'
import { Sigma } from 'sigma'
import { NodeCircleProgram } from 'sigma/rendering'
import { createNodeBorderProgram } from '@sigma/node-border'
import type { Settings } from 'sigma/settings'
import {
  fetchGraph,
  type GraphNode,
  type GraphNodeDoc,
  type GraphNodeTag,
  type GraphEdge,
} from '@/features/graph/api'

// ── Domain palette — 채도 높인 버전 ──────────────────────────────────────────
const DOMAIN_COLOR: Record<string, string> = {
  mobile:   '#3b82f6',  // blue-500
  software: '#10b981',  // emerald-500
  hardware: '#f59e0b',  // amber-500
  telecom:  '#ec4899',  // pink-500
}
const DOC_COLOR = '#6366f1'   // indigo-500 (기존 dark blue 보다 더 밝게)

const DOMAINS = ['mobile', 'software', 'hardware', 'telecom'] as const
type Domain = typeof DOMAINS[number]

// hover 색상
const HOVER_SELF_COLOR   = '#f59e0b'  // amber-400
const HOVER_NEIGHBOR_COLOR = '#ec4899' // pink-500

/**
 * 색을 살짝 *밝게* 변환 — border 용. r/g/b 각각 +40 (max 255).
 * 입력: '#rrggbb' → 출력: '#rrggbb'
 */
function lightenHex(hex: string, amount = 40): string {
  const m = hex.replace('#', '')
  if (m.length !== 6) return hex
  const r = Math.min(255, parseInt(m.slice(0, 2), 16) + amount)
  const g = Math.min(255, parseInt(m.slice(2, 4), 16) + amount)
  const b = Math.min(255, parseInt(m.slice(4, 6), 16) + amount)
  return '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')
}

// ── Custom label renderer — 라벨을 노드 중앙에 그림 ─────────────────────────
//
// sigma 의 Canvas layer (WebGL 위) 에 그려지는 텍스트다.
// data.x / data.y 는 이미 viewport 좌표이고, data.size 는 screen px 단위.
// 기본 drawDiscNodeLabel 은 노드 오른쪽 외부에 그림 → 여기서는 중앙으로 변경.
//
/**
 * 라벨을 노드 크기에 맞춰 *여러 줄로* wrap. 분리 우선순위:
 *   1) 공백
 *   2) 괄호 ( ) [ ] 직전
 *   3) 점/슬래시 . / 직전
 *   4) 그래도 안 들어가면 글자 단위 잘라서 + 마지막 줄에 ...
 */
function wrapLabel(label: string, maxChars: number, maxLines: number = 3): string[] {
  if (label.length <= maxChars) return [label]

  // 분리 가능 지점 패턴
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
      // token 자체가 maxChars 보다 길면 강제 분할
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

  // maxLines 초과면 마지막에 ...
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

const drawInnerLabel: Settings['defaultDrawNodeLabel'] = (
  context,
  data,
  _settings,
) => {
  if (!data.label) return

  const size = data.size           // screen px 반지름
  // 글자 폭 추정 — 한글이 더 넓음. 폰트 size 의 0.65 정도가 평균 char width.
  const fontSize = Math.max(9, Math.min(13, size * 0.42))
  const charWidth = fontSize * 0.65
  // 원 안에 들어갈 *대각 너비* — 2 × radius × 0.85 (여백)
  const innerWidth = size * 2 * 0.85
  const maxChars = Math.max(3, Math.floor(innerWidth / charWidth))

  // 최대 줄 수 — 노드 크기에 따라 1~3
  const maxLines = size >= 30 ? 3 : size >= 18 ? 2 : 1
  const lines = wrapLabel(data.label, maxChars, maxLines)

  context.font = `600 ${fontSize}px Inter, "Apple SD Gothic Neo", system-ui, sans-serif`
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillStyle = '#ffffff'
  context.shadowColor = 'rgba(0,0,0,0.7)'
  context.shadowBlur = 3

  // 여러 줄 — 세로 중앙 정렬: 전체 텍스트 높이 = lines.length * lineHeight
  const lineHeight = fontSize * 1.15
  const totalHeight = (lines.length - 1) * lineHeight
  const startY = data.y - totalHeight / 2

  lines.forEach((line, i) => {
    context.fillText(line, data.x, startY + i * lineHeight)
  })

  context.shadowBlur = 0
  context.shadowColor = 'transparent'
}

// ── Graph builder ─────────────────────────────────────────────────────────────
function buildGraph(nodes: GraphNode[], edges: GraphEdge[]): Graph {
  const g = new Graph({ multi: false, type: 'undirected' })

  const deg = new Map<string, number>()
  for (const e of edges) {
    if ((e.kind ?? 'wiki') !== 'wiki') continue
    const c = e.count ?? 1
    deg.set(e.source, (deg.get(e.source) ?? 0) + c)
    deg.set(e.target, (deg.get(e.target) ?? 0) + c)
  }

  for (const node of nodes) {
    if (node.kind === 'tag') {
      const t = node as GraphNodeTag
      const color = DOMAIN_COLOR[t.super_domain] ?? '#a78bfa'
      // 더 크게 — 라벨이 안에 들어갈 정도. min 24 ~ max 50
      const size = Math.min(50, Math.max(24, Math.sqrt(t.doc_count ?? 1) * 4 + 18))
      g.addNode(t.slug, {
        label: t.name,           // '#' 제거 — 원 안에서 공간 절약
        type: 'circle',
        size,
        color,
        borderColor: lightenHex(color, 60),  // 더 밝은 톤의 같은 색 — 글로우 느낌
        _baseColor: color,
        kind: 'tag',
        docCount: t.doc_count,
        superDomain: t.super_domain,
        x: Math.random(),
        y: Math.random(),
      })
    } else {
      const d = node as GraphNodeDoc
      const isMissing = d.status === 'missing'
      const color = isMissing ? '#ef4444' : DOC_COLOR
      const docDeg = deg.get(d.slug) ?? 0
      // 더 크게 — 라벨 들어갈 정도. min 16 ~ max 32
      const size = Math.min(32, Math.max(16, 16 + Math.sqrt(docDeg) * 3))
      g.addNode(d.slug, {
        label: d.title,
        type: 'circle',
        size,
        color,
        borderColor: lightenHex(color, 50),
        _baseColor: color,
        kind: 'doc',
        isMissing,
        x: Math.random(),
        y: Math.random(),
      })
    }
  }

  let edgeId = 0
  for (const e of edges) {
    if (!g.hasNode(e.source) || !g.hasNode(e.target)) continue
    if (e.source === e.target) continue
    const kind = e.kind ?? 'wiki'
    let color: string
    let size: number
    if (kind === 'wiki') {
      color = 'rgba(148,163,184,0.35)'
      size = 1 + Math.min(e.count ?? 1, 5) * 0.25
    } else if (kind === 'tag_cooc') {
      const srcDomain = g.getNodeAttribute(e.source, 'superDomain') as string | undefined
      const base = DOMAIN_COLOR[srcDomain ?? ''] ?? '#a78bfa'
      color = base + '66'  // 40% opacity
      size = Math.max(0.8, (e.weight ?? 1) / 5)
    } else {
      color = 'rgba(203,213,225,0.2)'
      size = 0.5
    }
    try {
      g.addEdgeWithKey(`e${edgeId++}`, e.source, e.target, { kind, color, size, _baseColor: color })
    } catch {
      // 중복 edge — skip
    }
  }

  return g
}

// ── SigmaDemo page ────────────────────────────────────────────────────────────
export function SigmaDemo() {
  const navigate = useNavigate()
  const [domain, setDomain] = useState<Domain>('mobile')
  const containerRef = useRef<HTMLDivElement | null>(null)
  const sigmaRef = useRef<Sigma | null>(null)
  const layoutRef = useRef<FA2LayoutSupervisor | null>(null)

  const [fps, setFps] = useState<number | null>(null)
  const fpsWindow = useRef<number[]>([])
  const lastRenderAt = useRef<number>(0)

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['sigma-demo', domain],
    queryFn: () =>
      fetchGraph({
        domain,
        include_tags: true,
        include_doc_tag_edges: true,
        include_tag_cooc: true,
      }),
    staleTime: 60_000,
  })

  useEffect(() => {
    if (!containerRef.current || !data) return

    // 이전 인스턴스 정리
    layoutRef.current?.kill()
    layoutRef.current = null
    sigmaRef.current?.kill()
    sigmaRef.current = null

    const g = buildGraph(data.nodes, data.edges)

    // 초기 위치: circular seed → 150 iter sync
    // 작은 영역에 랜덤 배치 — 일부러 겹치게.
    // supervisor 가 시작 후 *애니메이션 으로* 자연스럽게 밀어내며 펼침.
    g.forEachNode((node) => {
      g.setNodeAttribute(node, 'x', (Math.random() - 0.5) * 2)  // -1 ~ 1
      g.setNodeAttribute(node, 'y', (Math.random() - 0.5) * 2)
    })

    // FA2 supervisor (worker) — *짧게* 돌리고 stop. 계속 돌면 화면이 떨림.
    // drag 시 재개 + 일정 시간 후 다시 stop.
    const layout = new FA2LayoutSupervisor(g, {
      settings: {
        gravity: 0.05,
        scalingRatio: 80,
        adjustSizes: true,
        barnesHutOptimize: false,
        slowDown: 10,              // 20→10 — 적절히 빠르되 진동 안 함
        linLogMode: true,
      },
    })
    layoutRef.current = layout

    // 시작 — 겹친 상태에서 자연스럽게 밀어내며 펼침 (애니메이션).
    layout.start()

    // 충분히 펼쳐졌을 시점 stop (대략 2.5초 후).
    const initialStopTimer = window.setTimeout(() => {
      layout.stop()
    }, 2500)

    const renderer = new Sigma(g, containerRef.current, {
      nodeProgramClasses: {
        // 테두리 있는 원 — 채움색 + border 색을 노드 attribute 로 받음.
        // borderRatio 0.1 = 노드 반지름의 10% 가 border 두께.
        circle: createNodeBorderProgram({
          borders: [
            { size: { value: 0.1 }, color: { attribute: 'borderColor' } },
            { size: { fill: true }, color: { attribute: 'color' } },
          ],
        }),
      },
      defaultNodeType: 'circle',
      renderLabels: true,
      // 기본 라벨 렌더 대신 내부 중앙 렌더 사용
      defaultDrawNodeLabel: drawInnerLabel,
      labelDensity: 1,
      labelGridCellSize: 80,
      labelRenderedSizeThreshold: 6,
      minCameraRatio: 0.05,
      maxCameraRatio: 10,
      renderEdgeLabels: false,
      defaultEdgeColor: 'rgba(148,163,184,0.3)',
      zIndex: true,
    })
    sigmaRef.current = renderer

    // ── FPS ───────────────────────────────────────────────────────────────────
    renderer.on('beforeRender', () => {
      const now = performance.now()
      if (lastRenderAt.current > 0) {
        const dt = now - lastRenderAt.current
        if (dt > 0 && dt < 5000) {
          fpsWindow.current.push(1000 / dt)
          if (fpsWindow.current.length > 30) fpsWindow.current.shift()
          const avg =
            fpsWindow.current.reduce((a, b) => a + b, 0) / fpsWindow.current.length
          setFps(Math.round(avg))
        }
      }
      lastRenderAt.current = now
    })

    // ── Hover: 1-hop 색 + fade ────────────────────────────────────────────────
    let hoveredNode: string | null = null

    const applyReducers = () => {
      renderer.setSetting('nodeReducer', (node, data) => {
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
        // fade — 배경이 어두우니 거의 안 보이는 색
        return {
          ...data,
          color: '#1e293b',
          borderColor: '#1e293b',
          label: null,
          zIndex: 0,
        }
      })

      renderer.setSetting('edgeReducer', (edge, data) => {
        if (!hoveredNode) return data
        const [src, tgt] = g.extremities(edge)
        if (src === hoveredNode || tgt === hoveredNode) {
          return { ...data, color: HOVER_SELF_COLOR + 'cc', size: (data.size ?? 1) * 2 }
        }
        return { ...data, hidden: true }
      })
    }

    const clearReducers = () => {
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

    // FA2 settings — 평소 (차분) vs drag-time (빠른 반응)
    const calmSettings = {
      gravity: 0.05,
      scalingRatio: 80,
      adjustSizes: true,
      barnesHutOptimize: false,
      slowDown: 10,
      linLogMode: true,
    }
    const dragSettings = {
      ...calmSettings,
      slowDown: 2,           // 5배 빠른 반응
      scalingRatio: 120,     // 척력 더 강하게
    }

    // 마우스가 *attractor* — drag 노드의 목표 좌표.
    // 매 frame 마우스로 lerp(현재, target, 0.15) — 스르륵 추격 + 정착.
    let mouseTarget: { x: number; y: number } | null = null
    let chaseTimer: number | null = null

    const stopChase = () => {
      if (chaseTimer) {
        window.cancelAnimationFrame(chaseTimer)
        chaseTimer = null
      }
    }

    const chase = () => {
      if (!draggedNode || !mouseTarget) {
        stopChase()
        return
      }
      const cx = g.getNodeAttribute(draggedNode, 'x') as number
      const cy = g.getNodeAttribute(draggedNode, 'y') as number
      const tx = mouseTarget.x
      const ty = mouseTarget.y
      const dx = tx - cx
      const dy = ty - cy
      // lerp 0.15 — 부드러운 추격. 너무 작으면 늦고, 크면 즉시.
      const nx = cx + dx * 0.15
      const ny = cy + dy * 0.15
      g.setNodeAttribute(draggedNode, 'x', nx)
      g.setNodeAttribute(draggedNode, 'y', ny)
      chaseTimer = window.requestAnimationFrame(chase)
    }

    renderer.on('downNode', ({ node }) => {
      draggedNode = node
      isDragging = false
      // fixed 안 함 — supervisor 가 layout 안 끌도록 attribute 만, *대신 chase loop*
      // 가 매 frame lerp 로 좌표 업데이트. supervisor 의 척력은 *그 좌표 변화* 에
      // 반응해 주변 노드를 밀어냄.
      g.setNodeAttribute(draggedNode, 'fixed', true)
      renderer.getCamera().disable()

      layoutRef.current?.kill()
      const dragLayout = new FA2LayoutSupervisor(g, { settings: dragSettings })
      layoutRef.current = dragLayout
      dragLayout.start()

      mouseTarget = {
        x: g.getNodeAttribute(node, 'x') as number,
        y: g.getNodeAttribute(node, 'y') as number,
      }
      stopChase()
      chase()
    })

    renderer.on('moveBody', ({ event }) => {
      if (!draggedNode) return
      isDragging = true
      const pos = renderer.viewportToGraph({ x: event.x, y: event.y })
      mouseTarget = pos
      // chase loop 이 매 frame 좌표 업데이트
    })

    const stopDrag = () => {
      // 사용자가 놓은 *그 자리* — drag 노드는 chase loop 가 *마우스 마지막 위치*
      // 까지 부드럽게 도착. 그 후 fixed 유지 (anchor).
      stopChase()
      draggedNode = null
      isDragging = false
      mouseTarget = null
      renderer.getCamera().enable()

      // calm settings 로 새 supervisor → 정착 후 stop
      layoutRef.current?.kill()
      const calmLayout = new FA2LayoutSupervisor(g, { settings: calmSettings })
      layoutRef.current = calmLayout
      calmLayout.start()

      if (resumedStopTimer) window.clearTimeout(resumedStopTimer)
      resumedStopTimer = window.setTimeout(() => {
        calmLayout.stop()
      }, 600)
    }

    renderer.on('upNode', stopDrag)
    renderer.on('upStage', stopDrag)

    // ── Click ─────────────────────────────────────────────────────────────────
    renderer.on('clickNode', ({ node }) => {
      if (isDragging) return
      const kind = g.getNodeAttribute(node, 'kind') as string
      if (kind === 'doc') {
        const isMissing = g.getNodeAttribute(node, 'isMissing') as boolean
        if (!isMissing) navigate(`/docs/${encodeURIComponent(node)}`)
      }
    })

    return () => {
      window.clearTimeout(initialStopTimer)
      if (resumedStopTimer) window.clearTimeout(resumedStopTimer)
      stopChase()
      layoutRef.current?.kill()
      layoutRef.current = null
      renderer.kill()
      sigmaRef.current = null
    }
  }, [data, navigate])

  const nodeCount = data?.nodes.length ?? 0
  const docCount = data?.nodes.filter((n) => (n.kind ?? 'doc') === 'doc').length ?? 0
  const tagCount = data?.nodes.filter((n) => n.kind === 'tag').length ?? 0
  const edgeCount = data?.edges.length ?? 0

  return (
    <div className="flex flex-col gap-3 p-3 min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950">
      {/* Header */}
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-700 pb-2">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700"
        >
          &larr; 뒤로
        </button>
        <h1 className="text-lg font-semibold text-slate-100">
          지식그래프 데모 (sigma.js)
        </h1>
        <label className="flex items-center gap-1 text-xs text-slate-400">
          domain:
          <select
            value={domain}
            onChange={(e) => setDomain(e.target.value as Domain)}
            className="rounded border border-slate-600 bg-slate-800 px-2 py-1 text-sm text-slate-200"
          >
            {DOMAINS.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </label>
        <span className="ml-auto text-xs text-slate-500">
          평가용 — 기존 그래프 병행
        </span>
      </header>

      {/* Graph container */}
      {isPending && (
        <div className="flex h-[640px] items-center justify-center rounded-xl border border-slate-700 text-sm text-slate-400">
          불러오는 중…
        </div>
      )}
      {isError && (
        <div className="flex h-[640px] items-center justify-center rounded-xl border border-red-800 bg-red-950/50 text-sm text-red-400">
          오류: {(error as Error).message}
        </div>
      )}
      <div
        ref={containerRef}
        style={{ height: 640, display: isPending || isError ? 'none' : 'block' }}
        className="w-full rounded-xl border border-slate-700 overflow-hidden"
      />

      {/* Footer stats */}
      {!isPending && !isError && (
        <p className="font-mono text-[11px] text-slate-500">
          nodes: {nodeCount} (doc {docCount} + tag {tagCount})
          {' | '}edges: {edgeCount}
          {' | '}fps: {fps !== null ? fps : '--'}
          {' | '}layout: FA2 supervisor (adjustSizes)
          {' | '}
          <span>
            hover=1-hop highlight &bull; drag=layout 지속 &bull; click doc=이동
          </span>
        </p>
      )}
    </div>
  )
}

export default SigmaDemo
