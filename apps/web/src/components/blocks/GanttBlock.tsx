import type { GanttBlock } from '@/types/document'

/**
 * Minimal Gantt chart — single SVG with horizontal bars positioned by
 * (start, end) ms timestamps relative to the global span. Progress is
 * indicated by a darker overlay.
 */
export function GanttBlockView({ block }: { block: GanttBlock }) {
  if (block.tasks.length === 0) {
    return <p className="text-xs text-gray-500">작업 없음</p>
  }

  const tasks = block.tasks.map((t) => ({
    ...t,
    startMs: Date.parse(t.start),
    endMs: Date.parse(t.end),
  }))
  const minMs = Math.min(...tasks.map((t) => t.startMs))
  const maxMs = Math.max(...tasks.map((t) => t.endMs))
  const span = Math.max(1, maxMs - minMs)

  const rowH = 24
  const labelW = 140
  const barAreaW = 360
  const totalW = labelW + barAreaW + 16
  const totalH = tasks.length * rowH + 24

  const stripeOn = block.options?.stripe !== false

  return (
    <figure className="overflow-x-auto rounded border border-gray-200 bg-white p-2">
      <svg
        width={totalW}
        height={totalH}
        viewBox={`0 0 ${totalW} ${totalH}`}
        role="img"
        aria-label="Gantt 차트"
      >
        {/* zebra rows — paint first so they sit behind axis line and bars. */}
        {stripeOn &&
          tasks.map((_, idx) =>
            idx % 2 === 1 ? (
              <rect
                key={`zebra-${idx}`}
                data-gantt-zebra-row
                x={0}
                y={idx * rowH + 4}
                width={totalW}
                height={rowH}
                fill="#F9FAFB"
              />
            ) : null,
          )}
        {/* axis line */}
        <line
          x1={labelW}
          y1={totalH - 16}
          x2={labelW + barAreaW}
          y2={totalH - 16}
          stroke="#E5E7EB"
        />
        {tasks.map((t, idx) => {
          const x =
            labelW + ((t.startMs - minMs) / span) * barAreaW
          const w = Math.max(2, ((t.endMs - t.startMs) / span) * barAreaW)
          const progressW = ((t.progress ?? 0) / 100) * w
          const y = idx * rowH + 8
          return (
            <g key={idx}>
              <text x={4} y={y + 14} fontSize={11} fill="#1A1A1A">
                {t.name}
              </text>
              <rect x={x} y={y} width={w} height={rowH - 8} fill="#2E5BFF" rx={2} />
              {progressW > 0 && (
                <rect x={x} y={y} width={progressW} height={rowH - 8} fill="#1428A0" rx={2} />
              )}
            </g>
          )
        })}
      </svg>
    </figure>
  )
}
