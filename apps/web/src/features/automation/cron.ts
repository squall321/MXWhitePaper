/**
 * Tiny pure cron parser — TypeScript port of the BE
 * `apps/api/app/services/cron_parser.py`. Keep both implementations in
 * lockstep — when one changes, mirror the change in the other.
 *
 * Grammar (5-field standard cron, no extensions):
 *
 *   minute hour dom month dow
 *   0-59   0-23 1-31 1-12 0-6  (0=Sunday)
 *
 * Each field accepts ``*`` / ``?`` / literal / range / step / comma list.
 * No L/W/# extensions, no named months/days, no @yearly macros.
 *
 * `parseCron` throws on malformed input; `nextRun` returns the smallest
 * minute-aligned `Date` strictly greater than `after`.
 */

export interface ParsedCron {
  minute: Set<number>
  hour: Set<number>
  dom: Set<number>
  month: Set<number>
  dow: Set<number>
  domUnrestricted: boolean
  dowUnrestricted: boolean
}

interface FieldRange {
  lo: number
  hi: number
}

const FIELD_RANGES: FieldRange[] = [
  { lo: 0, hi: 59 }, // minute
  { lo: 0, hi: 23 }, // hour
  { lo: 1, hi: 31 }, // day-of-month
  { lo: 1, hi: 12 }, // month
  { lo: 0, hi: 6 }, // day-of-week (0 = Sunday)
]

function parseField(token: string, lo: number, hi: number): Set<number> {
  if (!token) throw new Error('empty cron field')
  const out = new Set<number>()
  for (const piece of token.split(',')) {
    const p = piece.trim()
    if (!p) throw new Error(`empty cron list element in ${token}`)
    let body = p
    let step = 1
    const slash = body.indexOf('/')
    if (slash >= 0) {
      const stepRaw = body.slice(slash + 1)
      const stepNum = parseInt(stepRaw, 10)
      if (!Number.isFinite(stepNum) || stepNum <= 0) {
        throw new Error(`invalid step ${stepRaw}`)
      }
      step = stepNum
      body = body.slice(0, slash)
    }
    let start: number
    let end: number
    if (body === '*' || body === '?') {
      start = lo
      end = hi
    } else if (body.includes('-')) {
      const parts = body.split('-', 2)
      const a = parts[0] ?? ''
      const b = parts[1] ?? ''
      start = parseInt(a, 10)
      end = parseInt(b, 10)
      if (!Number.isFinite(start) || !Number.isFinite(end)) {
        throw new Error(`invalid range ${body}`)
      }
      if (start > end) throw new Error(`reversed range ${body}`)
    } else {
      const v = parseInt(body, 10)
      if (!Number.isFinite(v)) throw new Error(`invalid cron literal ${body}`)
      start = v
      end = v
    }
    if (start < lo || end > hi) {
      throw new Error(`value out of range ${start}-${end} for [${lo},${hi}]`)
    }
    for (let v = start; v <= end; v += step) out.add(v)
  }
  if (out.size === 0) throw new Error('cron field expanded to empty set')
  return out
}

export function parseCron(expr: string): ParsedCron {
  if (typeof expr !== 'string') {
    throw new Error('cron expression must be a string')
  }
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) {
    throw new Error(
      `expected 5 fields (minute hour dom month dow), got ${parts.length}`,
    )
  }
  const sets = parts.map((tok, i) => {
    const range = FIELD_RANGES[i]
    if (!range) throw new Error(`internal: missing range for field ${i}`)
    return parseField(tok, range.lo, range.hi)
  })
  // The whole field is "unrestricted" only when the bare token is `*` or `?`.
  // A `*/2` or explicit `0-59` is treated as restricted for the POSIX OR rule.
  const unrestricted = parts.map((tok) => tok.trim() === '*' || tok.trim() === '?')
  return {
    minute: sets[0]!,
    hour: sets[1]!,
    dom: sets[2]!,
    month: sets[3]!,
    dow: sets[4]!,
    domUnrestricted: unrestricted[2]!,
    dowUnrestricted: unrestricted[4]!,
  }
}

function matchesDate(parsed: ParsedCron, dt: Date): boolean {
  // JS getUTCMonth() is 0-11 while cron month is 1-12.
  const month = dt.getUTCMonth() + 1
  if (!parsed.month.has(month)) return false
  // JS getUTCDay(): Sunday=0..Saturday=6 — already cron-compatible.
  const dow = dt.getUTCDay()
  const dom = dt.getUTCDate()
  const domOk = parsed.dom.has(dom)
  const dowOk = parsed.dow.has(dow)
  if (parsed.domUnrestricted && !parsed.dowUnrestricted) return dowOk
  if (parsed.dowUnrestricted && !parsed.domUnrestricted) return domOk
  if (parsed.domUnrestricted && parsed.dowUnrestricted) return true
  return domOk || dowOk // both restricted → POSIX OR
}

/**
 * Smallest minute-aligned UTC `Date` strictly greater than `after` whose
 * components match the parsed schedule. Mirrors the BE `next_run`
 * 1:1 — including the >4y "no firing" cap. Uses UTC throughout.
 */
export function nextRun(parsed: ParsedCron, after: Date): Date {
  // Step to the next minute boundary.
  const start = new Date(
    Date.UTC(
      after.getUTCFullYear(),
      after.getUTCMonth(),
      after.getUTCDate(),
      after.getUTCHours(),
      after.getUTCMinutes() + 1,
      0,
      0,
    ),
  )
  let candidate = start
  const deadline = new Date(start.getTime() + 4 * 366 * 24 * 60 * 60 * 1000)
  while (candidate < deadline) {
    if (
      parsed.minute.has(candidate.getUTCMinutes()) &&
      parsed.hour.has(candidate.getUTCHours()) &&
      matchesDate(parsed, candidate)
    ) {
      return candidate
    }
    candidate = new Date(candidate.getTime() + 60_000)
  }
  throw new Error('cron expression has no firing time within 4 years')
}

/**
 * Best-effort relative-time hint for FE display ("3시간 5분 뒤").
 * Rounds to whole minutes and falls back to "곧" (soon) for sub-minute deltas.
 */
export function relativeTimeKo(now: Date, target: Date): string {
  const ms = target.getTime() - now.getTime()
  if (ms < 0) return '지남'
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return '곧'
  if (minutes < 60) return `${minutes}분 뒤`
  const hours = Math.floor(minutes / 60)
  const mRem = minutes % 60
  if (hours < 24) return mRem ? `${hours}시간 ${mRem}분 뒤` : `${hours}시간 뒤`
  const days = Math.floor(hours / 24)
  const hRem = hours % 24
  if (days < 30) return hRem ? `${days}일 ${hRem}시간 뒤` : `${days}일 뒤`
  const months = Math.floor(days / 30)
  return `${months}개월 뒤`
}
