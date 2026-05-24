import type { WhiteboardBlock, WhiteboardElement } from '@/types/document'

/**
 * `whiteboard` block — read-only SVG renderer.
 *
 * Walks `elements` in array order and emits the matching SVG primitive:
 *   - stroke → <path d="M x y L x y …">
 *   - shape  → <rect> / <ellipse> / <line> / <polyline> (arrow w/ marker)
 *   - text   → <text>
 *
 * Pure SVG, no external deps. Designed to mirror exactly what the editor
 * commits so the read view never drifts from the live edit canvas.
 */
export function WhiteboardBlockView({ block }: { block: WhiteboardBlock }) {
  const { w, h } = block.viewbox
  return (
    <figure
      className="rounded border border-gray-200 bg-white p-2 dark:border-gray-700"
      data-whiteboard-block
      data-block-id={block.id}
    >
      {block.title ? (
        <figcaption className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
          {block.title}
        </figcaption>
      ) : null}
      <svg
        viewBox={`0 0 ${w} ${h}`}
        width="100%"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={block.title ?? 'whiteboard'}
        className="block max-w-full"
      >
        <WhiteboardElementsLayer elements={block.elements} />
      </svg>
    </figure>
  )
}

/** SVG inner layer — emits the marker `<defs>` plus every element. Reused by
 *  the editor so it can mount the same SVG primitives inside its own canvas. */
export function WhiteboardElementsLayer({
  elements,
}: {
  elements: ReadonlyArray<WhiteboardElement>
}) {
  return (
    <>
      <ArrowMarker />
      {elements.map((el) => (
        <WhiteboardElementView key={el.id} el={el} />
      ))}
    </>
  )
}

/** Reusable arrow-head marker (id="wb-arrow"). One per SVG is enough. */
export function ArrowMarker() {
  return (
    <defs>
      <marker
        id="wb-arrow"
        viewBox="0 0 10 10"
        refX="8"
        refY="5"
        markerWidth="6"
        markerHeight="6"
        orient="auto-start-reverse"
      >
        <path d="M0,0 L10,5 L0,10 z" fill="currentColor" />
      </marker>
    </defs>
  )
}

/** Translate a stroke's points array into an SVG path `d` attribute. */
export function strokeToPathD(points: ReadonlyArray<readonly [number, number]>): string {
  if (points.length === 0) return ''
  const head = points[0]!
  let d = `M ${head[0]} ${head[1]}`
  for (let i = 1; i < points.length; i++) {
    const p = points[i]!
    d += ` L ${p[0]} ${p[1]}`
  }
  return d
}

export function WhiteboardElementView({ el }: { el: WhiteboardElement }) {
  if (el.kind === 'stroke') {
    return (
      <path
        data-el-id={el.id}
        d={strokeToPathD(el.points as ReadonlyArray<readonly [number, number]>)}
        fill="none"
        stroke={el.stroke}
        strokeWidth={el.strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    )
  }
  if (el.kind === 'text') {
    return (
      <text
        data-el-id={el.id}
        x={el.x}
        y={el.y}
        fontSize={el.fontSize}
        fill={el.color}
        dominantBaseline="hanging"
      >
        {el.text}
      </text>
    )
  }
  // shape
  const fill = el.fill ?? 'none'
  if (el.shape === 'rect') {
    return (
      <rect
        data-el-id={el.id}
        x={el.x}
        y={el.y}
        width={el.w}
        height={el.h}
        stroke={el.stroke}
        strokeWidth={el.strokeWidth}
        fill={fill}
      />
    )
  }
  if (el.shape === 'ellipse') {
    return (
      <ellipse
        data-el-id={el.id}
        cx={el.x + el.w / 2}
        cy={el.y + el.h / 2}
        rx={Math.abs(el.w) / 2}
        ry={Math.abs(el.h) / 2}
        stroke={el.stroke}
        strokeWidth={el.strokeWidth}
        fill={fill}
      />
    )
  }
  if (el.shape === 'line') {
    return (
      <line
        data-el-id={el.id}
        x1={el.x}
        y1={el.y}
        x2={el.x + el.w}
        y2={el.y + el.h}
        stroke={el.stroke}
        strokeWidth={el.strokeWidth}
      />
    )
  }
  // arrow
  return (
    <line
      data-el-id={el.id}
      x1={el.x}
      y1={el.y}
      x2={el.x + el.w}
      y2={el.y + el.h}
      stroke={el.stroke}
      strokeWidth={el.strokeWidth}
      style={{ color: el.stroke }}
      markerEnd="url(#wb-arrow)"
    />
  )
}
