import { useState } from 'react'
import type { GanttBlock } from '@/types/document'
import { axisTicks, type GanttAxisUnit } from './ganttAxis'
import {
  applyDragDays,
  dragHitZone,
  ganttDragPatch,
  pxToDayDelta,
  type GanttDragZone,
} from './ganttDrag'
import { WidgetExportMenu } from './WidgetExportMenu'
import { ganttTasksToCsv } from '@/lib/widgetExport'
import { useT } from '@/lib/i18n'

/**
 * Minimal Gantt chart — single SVG with horizontal bars positioned by
 * (start, end) ms timestamps relative to the global span. Progress is
 * indicated by a darker overlay.
 *
 * `today` prop 은 테스트/SSR 안정성용 (YYYY-MM-DD). 미지정 시 `new Date()` 사용.
 *
 * `options.axisUnit` (day | week | month | quarter, default 'month') 가
 * 주어지면 x-axis 에 해당 단위 경계마다 세로 tick 선과 label 을 그린다.
 *
 * `onTaskPatch` 는 에디터 프리뷰 전용 — 주어지면 bar 가 포인터 드래그 가능
 * (가장자리 8px = 해당 날짜 resize, 몸통 = 전체 이동). 드래그 중에는 로컬
 * state 로 미리보기만 하고 pointerup 에 1회 호출한다. 미지정 시 (일반 문서
 * 뷰) 현행 read-only 그대로.
 */
export function GanttBlockView({
  block,
  today,
  onTaskPatch,
}: {
  block: GanttBlock
  today?: string
  onTaskPatch?: (idx: number, patch: { start?: string; end?: string }) => void
}) {
  // shadow-safe alias — task callbacks below bind a parameter named `t`.
  const tr = useT()
  const [drag, setDrag] = useState<{
    idx: number
    zone: GanttDragZone
    originX: number
    dayDelta: number
  } | null>(null)
  const [hover, setHover] = useState<{ idx: number; zone: GanttDragZone } | null>(null)
  if (block.tasks.length === 0) {
    return <p className="text-xs text-gray-500">{tr('block.gantt.noTasks')}</p>
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
  const axisUnit: GanttAxisUnit = block.options?.axisUnit ?? 'month'
  const ticks = axisTicks(minMs, maxMs, axisUnit)

  // today marker — 오늘 날짜가 gantt 범위 [minMs, maxMs] 안에 있으면 빨간 점선
  // 세로선을 task bars 위에 그린다. 범위 밖이면 미렌더.
  const todayMs = today ? Date.parse(today) : Date.now()
  const todayInRange =
    Number.isFinite(todayMs) && todayMs >= minMs && todayMs <= maxMs
  const todayX = todayInRange
    ? labelW + ((todayMs - minMs) / span) * barAreaW
    : 0

  return (
    <figure
      className="group relative overflow-x-auto rounded border border-gray-200 bg-white p-2 dark:border-gray-700 dark:bg-gray-900"
      data-export-root="gantt"
    >
      <WidgetExportMenu
        formats={['png', 'svg', 'csv']}
        getCsv={() => ganttTasksToCsv(block.tasks)}
        filename="gantt"
      />
      <svg
        width={totalW}
        height={totalH}
        viewBox={`0 0 ${totalW} ${totalH}`}
        role="img"
        aria-label={tr('block.gantt.ariaLabel')}
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
        {/* axis tick lines + labels (axisUnit 단위 경계마다) — bars 뒤에 그려 가독성 확보 */}
        {ticks.map((tk, i) => {
          const x = labelW + ((tk.ms - minMs) / span) * barAreaW
          return (
            <g key={`tick-${i}`} data-gantt-tick={tk.label}>
              <line
                x1={x}
                x2={x}
                y1={4}
                y2={totalH - 16}
                stroke="var(--smsg-gray-200)"
                strokeDasharray="2 3"
              />
              <text
                x={x}
                y={totalH - 4}
                fontSize={9}
                fill="var(--smsg-gray-500)"
                textAnchor="middle"
              >
                {tk.label}
              </text>
            </g>
          )
        })}
        {/* axis line */}
        <line
          x1={labelW}
          y1={totalH - 16}
          x2={labelW + barAreaW}
          y2={totalH - 16}
          stroke="var(--smsg-gray-200)"
        />
        {tasks.map((t, idx) => {
          const dragging = drag?.idx === idx ? drag : null
          const previewed = dragging
            ? applyDragDays(t.startMs, t.endMs, dragging.zone, dragging.dayDelta)
            : { startMs: t.startMs, endMs: t.endMs }
          const x =
            labelW + ((previewed.startMs - minMs) / span) * barAreaW
          const w = Math.max(2, ((previewed.endMs - previewed.startMs) / span) * barAreaW)
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
              {onTaskPatch && (
                <rect
                  data-gantt-drag-overlay={idx}
                  x={x}
                  y={y}
                  width={w}
                  height={rowH - 8}
                  fill="transparent"
                  style={{
                    cursor: dragging
                      ? dragging.zone === 'body'
                        ? 'grabbing'
                        : 'ew-resize'
                      : hover?.idx === idx
                        ? hover.zone === 'body'
                          ? 'grab'
                          : 'ew-resize'
                        : undefined,
                  }}
                  onPointerDown={(e) => {
                    const offsetX =
                      e.clientX - e.currentTarget.getBoundingClientRect().left
                    e.currentTarget.setPointerCapture(e.pointerId)
                    setDrag({
                      idx,
                      zone: dragHitZone(offsetX, w),
                      originX: e.clientX,
                      dayDelta: 0,
                    })
                    e.preventDefault()
                  }}
                  onPointerMove={(e) => {
                    if (drag) {
                      if (drag.idx !== idx) return
                      const dayDelta = pxToDayDelta(
                        e.clientX - drag.originX,
                        barAreaW,
                        span,
                      )
                      if (dayDelta !== drag.dayDelta) setDrag({ ...drag, dayDelta })
                    } else {
                      const offsetX =
                        e.clientX - e.currentTarget.getBoundingClientRect().left
                      const zone = dragHitZone(offsetX, w)
                      if (hover?.idx !== idx || hover.zone !== zone) {
                        setHover({ idx, zone })
                      }
                    }
                  }}
                  onPointerLeave={() => {
                    if (!drag) setHover(null)
                  }}
                  onPointerUp={() => {
                    if (!drag || drag.idx !== idx) return
                    const patch = ganttDragPatch(t, drag.zone, drag.dayDelta)
                    setDrag(null)
                    if (patch) onTaskPatch(idx, patch)
                  }}
                  onPointerCancel={() => setDrag(null)}
                />
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
            aria-label={tr('block.gantt.todayMarker')}
          >
            <title>{tr('block.gantt.todayMarker')}</title>
          </line>
        )}
      </svg>
    </figure>
  )
}
