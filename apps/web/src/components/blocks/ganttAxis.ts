/**
 * Gantt x-axis tick generator — pure helper. (no DOM, unit-testable)
 *
 * Given the [minMs, maxMs] range and a unit, returns the list of tick
 * positions and short labels at each unit boundary that *falls inside*
 * the range. Range endpoints themselves are not forced — only natural
 * boundaries (start of day / Monday / 1st of month / 1st of Jan,Apr,Jul,Oct).
 *
 * 안전장치:
 *  - too-many-ticks cap: 40 (지나치게 좁은 단위로 큰 범위 들어왔을 때
 *    화면이 라벨로 도배되는 것 방지). 초과하면 자동으로 한 단계 큰 단위로
 *    fallback 한다 (day → week → month → quarter).
 *  - minMs > maxMs / NaN → 빈 배열.
 */

export type GanttAxisUnit = 'day' | 'week' | 'month' | 'quarter'

export interface AxisTick {
  ms: number
  label: string
}

const MAX_TICKS = 40
const FALLBACK_ORDER: GanttAxisUnit[] = ['day', 'week', 'month', 'quarter']

export function axisTicks(
  minMs: number,
  maxMs: number,
  unit: GanttAxisUnit,
): AxisTick[] {
  if (!Number.isFinite(minMs) || !Number.isFinite(maxMs)) return []
  if (maxMs < minMs) return []

  let current = unit
  let ticks = generate(minMs, maxMs, current)
  // 한 단계씩 큰 단위로 fallback.
  while (ticks.length > MAX_TICKS) {
    const idx = FALLBACK_ORDER.indexOf(current)
    if (idx === -1 || idx === FALLBACK_ORDER.length - 1) {
      // quarter 까지 fallback 했는데도 초과면 그대로 (그래도 화면은 망가지지만 더 큰 단위 없음).
      break
    }
    current = FALLBACK_ORDER[idx + 1]!
    ticks = generate(minMs, maxMs, current)
  }
  return ticks
}

function generate(minMs: number, maxMs: number, unit: GanttAxisUnit): AxisTick[] {
  const out: AxisTick[] = []
  const start = new Date(minMs)
  // UTC 로 계산 — Date.parse('2026-01-01') 가 UTC midnight 으로 들어오므로
  // 같은 기준으로 walk 해야 ms 비교가 일관됨.
  let cursor = firstBoundaryAtOrAfter(start, unit)
  while (cursor.getTime() <= maxMs) {
    out.push({ ms: cursor.getTime(), label: labelFor(cursor, unit) })
    cursor = nextBoundary(cursor, unit)
  }
  return out
}

function firstBoundaryAtOrAfter(d: Date, unit: GanttAxisUnit): Date {
  const u = new Date(Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
  ))
  switch (unit) {
    case 'day':
      // already day-aligned
      return u
    case 'week': {
      // Monday 시작 (ISO).  getUTCDay: Sun=0, Mon=1 ... Sat=6.
      const dow = u.getUTCDay()
      const shift = (dow + 6) % 7 // Mon=0, Sun=6
      // 다음(또는 현재) Monday — shift 만큼 빼면 그 주의 월요일.
      const mon = new Date(u.getTime() - shift * 86400000)
      // shift 0 이면 그 자체가 Mon 이라 ok, 아니면 다음 Mon 으로 +7.
      return shift === 0 ? mon : new Date(mon.getTime() + 7 * 86400000)
    }
    case 'month': {
      const y = u.getUTCFullYear()
      const m = u.getUTCMonth()
      const day = u.getUTCDate()
      // 이 달의 1일이 같은 범위에 들어왔다면 그것, 아니면 다음 달 1일.
      const thisFirst = new Date(Date.UTC(y, m, 1))
      return day === 1 ? thisFirst : new Date(Date.UTC(y, m + 1, 1))
    }
    case 'quarter': {
      const y = u.getUTCFullYear()
      const m = u.getUTCMonth()
      const day = u.getUTCDate()
      const qStartMonth = Math.floor(m / 3) * 3 // 0, 3, 6, 9
      const thisQ = new Date(Date.UTC(y, qStartMonth, 1))
      // 현재가 분기 시작 첫날이면 그것, 아니면 다음 분기.
      if (m === qStartMonth && day === 1) return thisQ
      return new Date(Date.UTC(y, qStartMonth + 3, 1))
    }
  }
}

function nextBoundary(d: Date, unit: GanttAxisUnit): Date {
  switch (unit) {
    case 'day':
      return new Date(d.getTime() + 86400000)
    case 'week':
      return new Date(d.getTime() + 7 * 86400000)
    case 'month':
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))
    case 'quarter':
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 3, 1))
  }
}

function labelFor(d: Date, unit: GanttAxisUnit): string {
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth() + 1
  const day = d.getUTCDate()
  const mm = String(m).padStart(2, '0')
  const dd = String(day).padStart(2, '0')
  switch (unit) {
    case 'day':
      return `${mm}-${dd}`
    case 'week':
      // ISO week 의 시작일 — `MM-DD` 짧게.
      return `${mm}-${dd}`
    case 'month':
      // 1월이면 `YYYY-MM`, 아니면 `MM월` — 가독성.
      return m === 1 ? `${y}-01` : `${mm}월`
    case 'quarter': {
      const q = Math.floor((m - 1) / 3) + 1
      return `${y} Q${q}`
    }
  }
}
