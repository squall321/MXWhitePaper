import { useMemo, useState } from 'react'
import type { OrgChartBlock, OrgChartNode } from '@/types/document'

/** 2D position assigned to a node by `layoutTree`. */
export interface PositionedNode {
  node: OrgChartNode
  x: number
  y: number
  parentId?: string
}

/**
 * Minimal tidy-tree layout: leaves are placed left-to-right with a constant
 * step, internal nodes are centered above their child range. ~30 lines —
 * acceptable for the typical org-chart depth (≤ 6).
 *
 * Coordinates are in abstract units; the renderer scales them via NODE_W/H.
 */
export function layoutTree(
  root: OrgChartNode,
  layout: 'tree' | 'horizontal' = 'tree',
): { nodes: PositionedNode[]; width: number; height: number } {
  let cursor = 0
  const result: PositionedNode[] = []

  function visit(node: OrgChartNode, depth: number, parentId?: string): number {
    const children = node.children ?? []
    if (children.length === 0) {
      const x = cursor++
      result.push({ node, x, y: depth, parentId })
      return x
    }
    const childXs = children.map((c) => visit(c, depth + 1, node.id))
    const first = childXs[0] ?? 0
    const last = childXs[childXs.length - 1] ?? 0
    const x = (first + last) / 2
    result.push({ node, x, y: depth, parentId })
    return x
  }
  visit(root, 0)

  const xs = result.map((p) => p.x)
  const ys = result.map((p) => p.y)
  const width = Math.max(...xs) + 1
  const height = Math.max(...ys) + 1
  if (layout === 'horizontal') {
    return {
      nodes: result.map((p) => ({ ...p, x: p.y, y: p.x })),
      width: height,
      height: width,
    }
  }
  return { nodes: result, width, height }
}

/** Collect descendant ids of `id` for hover highlight. */
export function collectDescendants(root: OrgChartNode, id: string): Set<string> {
  const out = new Set<string>()
  function find(n: OrgChartNode): OrgChartNode | null {
    if (n.id === id) return n
    for (const c of n.children ?? []) {
      const f = find(c)
      if (f) return f
    }
    return null
  }
  const target = find(root)
  if (!target) return out
  function walk(n: OrgChartNode) {
    out.add(n.id)
    for (const c of n.children ?? []) walk(c)
  }
  walk(target)
  return out
}

const NODE_W = 140
const NODE_H = 56
const X_GAP = 28
const Y_GAP = 36

interface Props {
  block: OrgChartBlock
}

/**
 * Read-mode org-chart. SVG-based layout with hover highlight on the focused
 * node + its descendants.
 */
export function OrgChartBlockView({ block }: Props) {
  const layout = block.layout ?? 'tree'
  const positioned = useMemo(() => layoutTree(block.root, layout), [block.root, layout])
  const [hoverId, setHoverId] = useState<string | null>(null)
  const highlight = useMemo(
    () => (hoverId ? collectDescendants(block.root, hoverId) : null),
    [hoverId, block.root],
  )

  const stepX = NODE_W + X_GAP
  const stepY = NODE_H + Y_GAP
  const svgW = positioned.width * stepX + X_GAP
  const svgH = positioned.height * stepY + Y_GAP

  // Pre-compute node center (px) by id for edge drawing.
  const center = new Map<string, { cx: number; cy: number }>()
  for (const p of positioned.nodes) {
    const cx = p.x * stepX + X_GAP + NODE_W / 2
    const cy = p.y * stepY + Y_GAP + NODE_H / 2
    center.set(p.node.id, { cx, cy })
  }

  return (
    <figure className="overflow-auto rounded border border-gray-200 bg-white p-2">
      <svg width={svgW} height={svgH} role="img" aria-label="조직도">
        {/* edges */}
        {positioned.nodes.map((p) => {
          if (!p.parentId) return null
          const a = center.get(p.parentId)
          const b = center.get(p.node.id)
          if (!a || !b) return null
          const active = highlight?.has(p.node.id)
          return (
            <line
              key={`e-${p.node.id}`}
              x1={a.cx}
              y1={a.cy + NODE_H / 2}
              x2={b.cx}
              y2={b.cy - NODE_H / 2}
              stroke={active ? '#1428A0' : '#CBD5E1'}
              strokeWidth={active ? 2 : 1.2}
            />
          )
        })}
        {/* nodes */}
        {positioned.nodes.map((p) => {
          const c = center.get(p.node.id)!
          const active = highlight?.has(p.node.id)
          return (
            <g
              key={p.node.id}
              onMouseEnter={() => setHoverId(p.node.id)}
              onMouseLeave={() => setHoverId(null)}
            >
              <rect
                x={c.cx - NODE_W / 2}
                y={c.cy - NODE_H / 2}
                width={NODE_W}
                height={NODE_H}
                rx={8}
                fill={active ? '#E8EFFF' : '#FFFFFF'}
                stroke={active ? '#1428A0' : '#94A3B8'}
                strokeWidth={active ? 2 : 1}
              />
              <text
                x={c.cx}
                y={c.cy - 6}
                textAnchor="middle"
                fontSize={13}
                fontWeight={600}
                fill="#0F172A"
              >
                {truncate(p.node.label, 16)}
              </text>
              {p.node.role && (
                <text
                  x={c.cx}
                  y={c.cy + 12}
                  textAnchor="middle"
                  fontSize={11}
                  fill="#475569"
                >
                  {truncate(p.node.role, 18)}
                </text>
              )}
            </g>
          )
        })}
      </svg>
    </figure>
  )
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}
