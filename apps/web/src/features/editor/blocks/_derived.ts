/**
 * 차트 블록용 derived 시리즈 계산 — 미분/적분/peak/diff (순수 모듈).
 *
 * 왜 이 파일이 따로 있나:
 *   - ECharts/React 의존성 없이 수학만 모아두어야 vitest 에서 빠르게 단위
 *     테스트되고, _fits.ts 와 같은 컨벤션을 유지한다.
 *   - chart-xy-line.plan §2.6 B3/B4/B5 — toolbar 가 호출해서 새 series 를
 *     `block.data.series` 에 push 한다 (반환값은 series 의 points 만).
 *
 * 공통 규칙:
 *   - 모든 함수는 입력 points 를 내부적으로 sortedByX 로 정렬 (NaN x 제외).
 *     사용자가 paste 한 순서가 무작위여도 결과는 x 오름차순.
 *   - n < 2 같은 의미 없는 입력은 빈 배열을 반환 (호출측이 toast 로 안내).
 */

import type { XYPoint } from './_fits'

/* ── 정렬 헬퍼 ─────────────────────────────────────────────────────────── */

/**
 * NaN/Inf x 를 제외하고 x 오름차순 정렬한 새 배열을 반환. y 가 NaN 이어도
 * 정렬 단계에서는 살아남는다 (미분/적분에서 별도로 isFinite 체크).
 */
function sortedByX(points: readonly XYPoint[]): XYPoint[] {
  const valid: XYPoint[] = []
  for (const p of points) {
    if (Number.isFinite(p.x)) valid.push({ x: p.x, y: p.y })
  }
  valid.sort((a, b) => a.x - b.x)
  return valid
}

/* ── 1) differentiate — 수치 미분 ─────────────────────────────────────── */

/**
 * 중앙차분으로 dy/dx 를 계산. 양 끝은 전/후 차분.
 *   - i=0       : (y[1]   - y[0])     / (x[1]   - x[0])     (forward)
 *   - i=n-1     : (y[n-1] - y[n-2])   / (x[n-1] - x[n-2])   (backward)
 *   - else      : (y[i+1] - y[i-1])   / (x[i+1] - x[i-1])   (central)
 * 인접 두 점의 dx=0 이면 그 항은 skip (zero-division 방지).
 * n < 2 → 빈 배열.
 */
export function differentiate(points: readonly XYPoint[]): XYPoint[] {
  const pts = sortedByX(points)
  const n = pts.length
  if (n < 2) return []

  const out: XYPoint[] = []
  for (let i = 0; i < n; i++) {
    const cur = pts[i]!
    if (!Number.isFinite(cur.y)) continue

    let dx: number
    let dy: number
    if (i === 0) {
      const next = pts[i + 1]!
      if (!Number.isFinite(next.y)) continue
      dx = next.x - cur.x
      dy = next.y - cur.y
    } else if (i === n - 1) {
      const prev = pts[i - 1]!
      if (!Number.isFinite(prev.y)) continue
      dx = cur.x - prev.x
      dy = cur.y - prev.y
    } else {
      const prev = pts[i - 1]!
      const next = pts[i + 1]!
      if (!Number.isFinite(prev.y) || !Number.isFinite(next.y)) continue
      dx = next.x - prev.x
      dy = next.y - prev.y
    }
    if (dx === 0) continue
    out.push({ x: cur.x, y: dy / dx })
  }
  return out
}

/* ── 2) integrate — 사다리꼴 누적 적분 ────────────────────────────────── */

/**
 * 누적 적분 (cumulative trapezoidal). 결과 길이 = 입력의 유효 길이.
 *   cumSum[0] = 0
 *   cumSum[i] = cumSum[i-1] + (y[i-1] + y[i])/2 * (x[i] - x[i-1])
 * y 가 NaN 인 인접 점은 그 구간을 0 으로 본다 (누적값은 유지).
 * n < 2 → 한 점뿐이거나 빈 배열은 빈 배열.
 */
export function integrate(points: readonly XYPoint[]): XYPoint[] {
  const pts = sortedByX(points)
  const n = pts.length
  if (n < 2) return []

  const out: XYPoint[] = []
  let acc = 0
  // 첫 점 — 누적 0 으로 시작.
  out.push({ x: pts[0]!.x, y: 0 })
  for (let i = 1; i < n; i++) {
    const prev = pts[i - 1]!
    const cur = pts[i]!
    const dx = cur.x - prev.x
    if (
      dx !== 0 &&
      Number.isFinite(prev.y) &&
      Number.isFinite(cur.y)
    ) {
      acc += ((prev.y + cur.y) / 2) * dx
    }
    out.push({ x: cur.x, y: acc })
  }
  return out
}

/* ── 3) findPeaks — 극값 검출 ─────────────────────────────────────────── */

export interface PeakInfo {
  x: number
  y: number
  kind: 'peak' | 'valley'
}

/**
 * 단순 인접비교로 극값을 찾는다. 끝점은 제외 (n≥3 이어야 결과 가능).
 * Plateau (같은 y 연속) 는 가운데 인덱스를 representative 로 사용.
 *
 * opts.minProminence (0~1) — y_max - y_min 의 일정 비율 이하 변화는 무시.
 * 기본 0 → 모든 극값 반환.
 */
export function findPeaks(
  points: readonly XYPoint[],
  opts?: { minProminence?: number },
): PeakInfo[] {
  const pts = sortedByX(points).filter((p) => Number.isFinite(p.y))
  const n = pts.length
  if (n < 3) return []

  // 임계값 계산 — y_max - y_min 의 minProminence 배율.
  const minProm = opts?.minProminence ?? 0
  let yMin = Infinity
  let yMax = -Infinity
  for (const p of pts) {
    if (p.y < yMin) yMin = p.y
    if (p.y > yMax) yMax = p.y
  }
  const threshold = minProm > 0 ? (yMax - yMin) * minProm : 0

  const out: PeakInfo[] = []
  let i = 1
  while (i < n - 1) {
    const prev = pts[i - 1]!
    const cur = pts[i]!
    const next = pts[i + 1]!

    // plateau 인 경우 같은 y 가 이어지는 마지막 인덱스를 찾아 가운데를 대표로.
    if (cur.y === next.y) {
      let j = i
      while (j < n - 1 && pts[j + 1]!.y === cur.y) j++
      // plateau 가 [i .. j] — 양쪽 (i-1, j+1) 비교.
      if (j < n - 1) {
        const before = pts[i - 1]!
        const after = pts[j + 1]!
        const mid = pts[Math.floor((i + j) / 2)]!
        if (cur.y > before.y && cur.y > after.y) {
          // peak.
          if (yMax - cur.y >= 0 && cur.y - Math.max(before.y, after.y) >= threshold) {
            out.push({ x: mid.x, y: cur.y, kind: 'peak' })
          }
        } else if (cur.y < before.y && cur.y < after.y) {
          // valley.
          if (Math.min(before.y, after.y) - cur.y >= threshold) {
            out.push({ x: mid.x, y: cur.y, kind: 'valley' })
          }
        }
      }
      i = j + 1
      continue
    }

    if (cur.y > prev.y && cur.y > next.y) {
      // peak — prominence 는 양쪽 이웃과의 최소 차이.
      const prom = Math.min(cur.y - prev.y, cur.y - next.y)
      if (prom >= threshold) out.push({ x: cur.x, y: cur.y, kind: 'peak' })
    } else if (cur.y < prev.y && cur.y < next.y) {
      const prom = Math.min(prev.y - cur.y, next.y - cur.y)
      if (prom >= threshold) out.push({ x: cur.x, y: cur.y, kind: 'valley' })
    }
    i++
  }
  return out
}

/* ── 4) diffSeries — 두 시리즈의 차 (y_b - y_a) ───────────────────────── */

/**
 * 공통 x 에서만 (y_b - y_a) 를 계산. 부동소수 noise 는 호출측 책임 (정확 동치
 * 비교). 결과는 x 오름차순.
 *
 * 양쪽 모두 NaN y 면 그 x 는 skip.
 */
export function diffSeries(
  a: readonly XYPoint[],
  b: readonly XYPoint[],
): XYPoint[] {
  // a 의 x → y 매핑. 중복 x 가 있으면 마지막 값이 이긴다 (단순화).
  const mapA = new Map<number, number>()
  for (const p of a) {
    if (Number.isFinite(p.x) && Number.isFinite(p.y)) mapA.set(p.x, p.y)
  }
  const out: XYPoint[] = []
  for (const p of b) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue
    const ya = mapA.get(p.x)
    if (ya === undefined) continue
    out.push({ x: p.x, y: p.y - ya })
  }
  out.sort((a, b) => a.x - b.x)
  return out
}
