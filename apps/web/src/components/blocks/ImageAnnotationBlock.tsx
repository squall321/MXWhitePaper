import type { ImageAnnotationBlock, AnnotationElement } from '@/types/document'
import { useImage } from '@/features/upload/hooks/useImage'

/**
 * `image-annotation` block — read-only renderer.
 *
 * Layers:
 *   1. <img> resolved through `useImage(image_id)` (same hook ImageBlock uses).
 *   2. Absolutely-positioned <svg> overlay covering the image rect (viewBox
 *      `0 0 1 1` so element coords are already in normalised space).
 *   3. Each annotation kind:
 *        - arrow   : <line> with `marker-end` to `#ia-arrow`
 *        - rect    : <rect> with stroke + 18% fill
 *        - callout : <line> from `(x,y)` to `anchor` + bubble <rect> + <text>
 *
 * Coordinates are normalised [0..1] so the overlay scales with the rendered
 * image — no recompute is needed when the parent column changes width.
 */
export function ImageAnnotationBlockView({ block }: { block: ImageAnnotationBlock }) {
  const { data: image } = useImage(block.image_id || undefined)
  const src = image?.urls.view ?? `/api/v1/images/${encodeURIComponent(block.image_id)}`
  const bg = image?.dominant_color ?? '#f3f4f6'

  return (
    <figure
      className="my-4 mx-auto w-full max-w-3xl"
      data-image-annotation-block
      data-block-id={block.id}
    >
      <div
        className="relative overflow-hidden rounded border border-gray-200"
        style={{ backgroundColor: bg }}
      >
        <img
          src={src}
          alt={block.caption ?? ''}
          loading="lazy"
          decoding="async"
          className="block w-full"
        />
        <svg
          viewBox="0 0 1 1"
          preserveAspectRatio="none"
          className="pointer-events-none absolute inset-0 h-full w-full"
          aria-hidden="true"
        >
          <AnnotationArrowMarker />
          {block.annotations.map((ann) => (
            <AnnotationElementView key={ann.id} ann={ann} />
          ))}
        </svg>
      </div>
      {block.caption && (
        <figcaption className="mt-1 text-center text-xs text-gray-500">
          {block.caption}
        </figcaption>
      )}
    </figure>
  )
}

/** Arrow-head marker shared by every arrow annotation. Extracted so the
 *  editor can mount the same SVG primitives inside its own canvas. */
export function AnnotationArrowMarker() {
  return (
    <defs>
      <marker
        id="ia-arrow"
        viewBox="0 0 10 10"
        refX="8"
        refY="5"
        markerUnits="strokeWidth"
        markerWidth="6"
        markerHeight="6"
        orient="auto-start-reverse"
      >
        <path d="M0,0 L10,5 L0,10 z" fill="currentColor" />
      </marker>
    </defs>
  )
}

/** One annotation element — dispatch by kind. Stroke widths are tiny
 *  numbers because the SVG is in normalised [0..1] space. */
export function AnnotationElementView({ ann }: { ann: AnnotationElement }) {
  if (ann.kind === 'arrow') {
    return (
      <g data-el-id={ann.id} style={{ color: ann.color }}>
        <line
          x1={ann.from.x}
          y1={ann.from.y}
          x2={ann.to.x}
          y2={ann.to.y}
          stroke={ann.color}
          strokeWidth={0.005}
          strokeLinecap="round"
          markerEnd="url(#ia-arrow)"
        />
        {ann.label ? (
          <text
            x={(ann.from.x + ann.to.x) / 2}
            y={(ann.from.y + ann.to.y) / 2 - 0.012}
            fill={ann.color}
            fontSize={0.025}
            textAnchor="middle"
          >
            {ann.label}
          </text>
        ) : null}
      </g>
    )
  }
  if (ann.kind === 'rect') {
    return (
      <g data-el-id={ann.id}>
        <rect
          x={ann.x}
          y={ann.y}
          width={ann.w}
          height={ann.h}
          stroke={ann.color}
          strokeWidth={0.005}
          fill={ann.color}
          fillOpacity={0.18}
        />
        {ann.label ? (
          <text
            x={ann.x + 0.005}
            y={ann.y - 0.005}
            fill={ann.color}
            fontSize={0.025}
            dominantBaseline="auto"
          >
            {ann.label}
          </text>
        ) : null}
      </g>
    )
  }
  // callout
  return (
    <g data-el-id={ann.id}>
      {ann.anchor ? (
        <line
          x1={ann.x}
          y1={ann.y}
          x2={ann.anchor.x}
          y2={ann.anchor.y}
          stroke={ann.color}
          strokeWidth={0.003}
          strokeDasharray="0.01 0.005"
        />
      ) : null}
      <rect
        x={ann.x}
        y={ann.y}
        width={Math.max(0.08, ann.text.length * 0.014)}
        height={0.045}
        rx={0.01}
        stroke={ann.color}
        strokeWidth={0.003}
        fill="white"
        fillOpacity={0.9}
      />
      <text
        x={ann.x + 0.01}
        y={ann.y + 0.022}
        fill={ann.color}
        fontSize={0.025}
        dominantBaseline="middle"
      >
        {ann.text}
      </text>
    </g>
  )
}
