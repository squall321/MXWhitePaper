/**
 * Gantt bar 포인터 드래그 — 순수 헬퍼. (no DOM, unit-testable)
 *
 * GanttBlockView 의 에디터 프리뷰 드래그에서 사용:
 *  - dragHitZone    : bar 의 어느 영역을 잡았는지 (가장자리 8px = resize, 몸통 = 이동)
 *  - pxToDayDelta   : 포인터 이동 px → 일 단위 delta (기존 축 환산 barAreaW/span 재사용)
 *  - applyDragDays  : ms 도메인 드래그 미리보기 (start ≤ end 클램프)
 *  - ganttDragPatch : pointerup 시 1회 적용할 {start?, end?} ISO patch (no-op 이면 null)
 */

export type GanttDragZone = 'start' | 'end' | 'body'

const DAY_MS = 86400000
const EDGE_PX = 8

/**
 * bar 시작점 기준 `offsetX` 가 어느 zone 인지. 좁은 bar 는 가장자리 폭을
 * barW/3 으로 줄여 몸통(이동) 영역이 항상 남도록 한다.
 */
export function dragHitZone(offsetX: number, barW: number): GanttDragZone {
  const edge = Math.min(EDGE_PX, barW / 3)
  if (offsetX <= edge) return 'start'
  if (offsetX >= barW - edge) return 'end'
  return 'body'
}

export function pxToDayDelta(dxPx: number, barAreaW: number, spanMs: number): number {
  if (!Number.isFinite(dxPx) || barAreaW <= 0 || spanMs <= 0) return 0
  return Math.round((dxPx / barAreaW) * (spanMs / DAY_MS))
}

export function applyDragDays(
  startMs: number,
  endMs: number,
  zone: GanttDragZone,
  dayDelta: number,
): { startMs: number; endMs: number } {
  const d = dayDelta * DAY_MS
  switch (zone) {
    case 'body':
      return { startMs: startMs + d, endMs: endMs + d }
    case 'start':
      return { startMs: Math.min(startMs + d, endMs), endMs }
    case 'end':
      return { startMs, endMs: Math.max(endMs + d, startMs) }
  }
}

/** ms → YYYY-MM-DD. `Date.parse('YYYY-MM-DD')` 가 UTC midnight 이므로 UTC 기준 역변환. */
function msToISODate(ms: number): string {
  const d = new Date(ms)
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${d.getUTCFullYear()}-${m}-${day}`
}

export function ganttDragPatch(
  task: { start: string; end: string },
  zone: GanttDragZone,
  dayDelta: number,
): { start?: string; end?: string } | null {
  if (dayDelta === 0) return null
  const startMs = Date.parse(task.start)
  const endMs = Date.parse(task.end)
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null
  const next = applyDragDays(startMs, endMs, zone, dayDelta)
  const patch: { start?: string; end?: string } = {}
  if (zone !== 'end' && next.startMs !== startMs) patch.start = msToISODate(next.startMs)
  if (zone !== 'start' && next.endMs !== endMs) patch.end = msToISODate(next.endMs)
  return patch.start !== undefined || patch.end !== undefined ? patch : null
}
