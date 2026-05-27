import type { GanttBlock } from '@/types/document'

/**
 * Minimal Gantt chart — single SVG with horizontal bars positioned by
 * (start, end) ms timestamps relative to the global span. Progress is
 * indicated by a darker overlay.
 *
 * `today` prop 은 테스트/SSR 안정성용 (YYYY-MM-DD). 미지정 시 `new Date()` 사용.
 */
export function GanttBlockView({
  block,
  today,
}: {
  block: GanttBlock
  today?: string
}) {
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

  // today marker — 오늘 날짜가 gantt 범위 [minMs, maxMs] 안에 있으면 빨간 점선
  // 세로선을 task bars 위에 그린다. 범위 밖이면 미렌더.
  const todayMs = today ? Date.parse(today) : Date.now()
  const todayInRange =
    Number.isFinite(todayMs) && todayMs >= minMs && todayMs <= maxMs
  const todayX = todayInRange
    ? labelW + ((todayMs - minMs) / span) * barAreaW
    : 0

  return (
    <figure className="overflow-x-auto rounded border border-gray-200 bg-white p-2 dark:border-gray-700 dark:bg-gray-900">
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
                fill="var(--smsg-gray-050)"
              />
            ) : null,
          )}
        {/* axis line */}
        <line
          x1={labelW}
          y1={totalH - 16}
          x2={labelW + barAreaW}
          y2={totalH - 16}
          stroke="var(--smsg-gray-200)"
        />
        {tasks.map((t, idx) => {
          const x =
            labelW + ((t.startMs - minMs) / span) * barAreaW
          const w = Math.max(2, ((t.endMs - t.startMs) / span) * barAreaW)
          const progressW = ((t.progress ?? 0) / 100) * w
          const y = idx * rowH + 8
          return (
            <g key={idx}>
              <text x={4} y={y + 14} fontSize={11} fill="var(--smsg-gray-900)">
                {t.name}
              </text>
              <rect x={x} y={y} width={w} height={rowH - 8} fill="var(--smsg-blue-500)" rx={2} />
              {progressW > 0 && (
                <rect x={x} y={y} width={progressW} height={rowH - 8} fill="var(--smsg-blue-700)" rx={2} />
              )}
            </g>
          )
        })}
        {/* today marker — task bars 다음 (위에 오도록) */}
        {todayInRange && (
          <line
            data-gantt-today
            x1={todayX}
            x2={todayX}
            y1={0}
            y2={totalH}
            stroke="#dc2626"
            strokeWidth={1.5}
            strokeDasharray="4 3"
            aria-label="오늘"
          >
            <title>오늘</title>
          </line>
        )}
      </svg>
    </figure>
  )
}
