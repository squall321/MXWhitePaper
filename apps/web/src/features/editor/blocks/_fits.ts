/**
 * 차트 블록용 회귀/피팅 순수 함수.
 *
 * 왜 이 파일이 따로 있나:
 *   - ECharts/React 의존성 없이 수학만 모아두어야 vitest 에서 빠르게 단위
 *     테스트되고, P3 의 비선형 fit (poly/exp/power) 도 같은 자리에 붙일 수 있다.
 *   - chart-xy-line.plan §2.5 — Phase 1 은 linear 만, 시그니처는 다른 에이전트가
 *     import 하므로 변경 금지.
 *
 * 수학 메모 (왜 이 공식이냐):
 *   slope a = (n·Σxy − Σx·Σy) / (n·Σx² − (Σx)²)
 *   intercept b = (Σy − a·Σx) / n
 *   R² = 1 − SS_res / SS_tot   (단, SS_tot=0 인 수평 분포는 r2=0 으로 약속)
 *   — 표준 OLS. 한 패스로 모든 합을 모은다.
 */

export interface XYPoint {
  x: number
  y: number
}

export interface LinearFitResult {
  slope: number // y = a*x + b 의 a
  intercept: number // b
  r2: number // 결정계수 0~1, 계산 불가 시 0
  n: number // NaN/Inf 제외 후 실제 사용된 점 수
}

const EMPTY: LinearFitResult = { slope: 0, intercept: 0, r2: 0, n: 0 }

/** 유한수 (NaN/±Infinity 가 아닌 number) 인지. */
function isFinitePoint(p: XYPoint): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y)
}

/** 최소제곱 단순 선형회귀. n<2 또는 모든 x 가 동일하면 slope=0, r2=0. */
export function linearFit(points: readonly XYPoint[]): LinearFitResult {
  // NaN/Inf 는 통째 skip — 계산식 안에 들어가면 전부 오염되기 때문.
  const valid: XYPoint[] = []
  for (const p of points) {
    if (isFinitePoint(p)) valid.push(p)
  }
  const n = valid.length
  if (n === 0) return EMPTY
  if (n === 1) {
    // 한 점만으로는 기울기를 정할 수 없다. 절편만 그 점의 y 로.
    // (n===1 보장이지만 noUncheckedIndexedAccess 때문에 non-null 단언.)
    const only = valid[0]!
    return { slope: 0, intercept: only.y, r2: 0, n: 1 }
  }

  let sumX = 0
  let sumY = 0
  let sumXX = 0
  let sumXY = 0
  for (const p of valid) {
    sumX += p.x
    sumY += p.y
    sumXX += p.x * p.x
    sumXY += p.x * p.y
  }

  const denom = n * sumXX - sumX * sumX
  // denom=0 ↔ 모든 x 가 동일 (수직선). 회귀 정의 불가.
  if (denom === 0) return { slope: 0, intercept: 0, r2: 0, n }

  const slope = (n * sumXY - sumX * sumY) / denom
  const intercept = (sumY - slope * sumX) / n

  // R² — 잔차제곱합 / 총제곱합.
  const meanY = sumY / n
  let ssRes = 0
  let ssTot = 0
  for (const p of valid) {
    const yHat = slope * p.x + intercept
    const dr = p.y - yHat
    const dt = p.y - meanY
    ssRes += dr * dr
    ssTot += dt * dt
  }
  // ssTot=0 → 모든 y 가 동일. 회귀선이 그 수평선과 일치하면 r2=1 이라고 정의할
  // 수도 있지만, 사용자에게 의미 없는 fit 이므로 0 으로 약속.
  let r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot
  if (!Number.isFinite(r2)) r2 = 0
  if (r2 < 0) r2 = 0 // 부동소수 노이즈로 음수 직전까지 가는 경우 클램프.
  if (r2 > 1) r2 = 1

  return { slope, intercept, r2, n }
}

/**
 * 사람이 읽는 식. 소수 자리수는 값 크기에 맞춰 자동 (작으면 더 자세히).
 *   예: "y = 1.234·x + 0.567 (R²=0.987)"
 */
export function formatFit(fit: LinearFitResult): string {
  const a = formatNum(fit.slope)
  const b = formatNum(fit.intercept)
  const r2 = fit.r2.toFixed(3)
  // 절편 부호에 따라 "+ " / "- " 로 자연스럽게.
  const sign = fit.intercept >= 0 ? '+' : '-'
  const bAbs = formatNum(Math.abs(fit.intercept))
  return `y = ${a}·x ${sign} ${bAbs} (R²=${r2})`
}

/** 절대값에 따라 자릿수를 다르게. 0 은 "0". */
function formatNum(v: number): string {
  if (v === 0) return '0'
  const abs = Math.abs(v)
  if (abs >= 100) return v.toFixed(1)
  if (abs >= 1) return v.toFixed(3)
  if (abs >= 0.01) return v.toFixed(4)
  // 매우 작은 값은 지수표기.
  return v.toExponential(2)
}

/**
 * 시리즈에 linearFit 을 적용한 뒤, 회귀선을 그릴 두 endpoint 를 반환.
 * fit 이 의미 없는 경우 (n<2 또는 수직선) null.
 *
 * 두 endpoint 의 x 는 입력의 min/max — ECharts markLine 의 시작/끝으로 그대로
 * 쓸 수 있다.
 */
export function fitLine(
  points: readonly XYPoint[],
): { fit: LinearFitResult; line: [XYPoint, XYPoint] } | null {
  const fit = linearFit(points)
  if (fit.n < 2 || fit.slope === 0) {
    // slope=0 도 의미 있는 fit 일 수 있으나 (완전 수평), 호출측이 회귀선을 그릴
    // 목적이라면 수평선은 따로 처리해야 하므로 여기서는 null 로 약속.
    // 단, 진짜 데이터가 수평이고 r2>0 이면 그리는 게 맞다 — 그래서 r2 조건도 본다.
    if (fit.n < 2) return null
    if (fit.r2 === 0) return null
  }

  let xMin = Infinity
  let xMax = -Infinity
  for (const p of points) {
    if (!isFinitePoint(p)) continue
    if (p.x < xMin) xMin = p.x
    if (p.x > xMax) xMax = p.x
  }
  if (!Number.isFinite(xMin) || !Number.isFinite(xMax) || xMin === xMax) {
    return null
  }

  const line: [XYPoint, XYPoint] = [
    { x: xMin, y: fit.slope * xMin + fit.intercept },
    { x: xMax, y: fit.slope * xMax + fit.intercept },
  ]
  return { fit, line }
}
