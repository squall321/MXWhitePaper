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

// ─────────────────────────────────────────────────────────────────────────────
// P3: 비선형 fit (poly2/poly3, exponential, power)
// ─────────────────────────────────────────────────────────────────────────────

export type FitType = 'linear' | 'poly2' | 'poly3' | 'exp' | 'power'

export interface PolyFitResult {
  coeffs: number[] // c0 + c1*x + c2*x^2 + ...
  r2: number
  n: number
}

export interface ExpFitResult {
  a: number // y = a * exp(b*x)
  b: number
  r2: number
  n: number
}

export interface PowerFitResult {
  a: number // y = a * x^b
  b: number
  r2: number
  n: number
}

/** 다항식 평가: c0 + c1*x + c2*x^2 + ... (Horner). */
function polyEval(coeffs: readonly number[], x: number): number {
  let y = 0
  for (let i = coeffs.length - 1; i >= 0; i--) {
    y = y * x + (coeffs[i] ?? 0)
  }
  return y
}

/**
 * 정방행렬을 부분 피벗 가우스 소거로 푼다. singular 면 null.
 * A: n×n (row-major), b: n. 반환은 길이 n 의 해.
 */
function solveLinearSystem(A: number[][], b: number[]): number[] | null {
  const n = b.length
  // 깊은 복사 — 호출자 데이터를 보존.
  const M: number[][] = A.map((row) => row.slice())
  const v: number[] = b.slice()

  for (let i = 0; i < n; i++) {
    // 부분 피벗.
    let pivot = i
    let pivotAbs = Math.abs(M[i]![i]!)
    for (let r = i + 1; r < n; r++) {
      const cur = Math.abs(M[r]![i]!)
      if (cur > pivotAbs) {
        pivot = r
        pivotAbs = cur
      }
    }
    if (pivotAbs < 1e-12) return null // singular.
    if (pivot !== i) {
      const tmpRow = M[i]!
      M[i] = M[pivot]!
      M[pivot] = tmpRow
      const tmpV = v[i]!
      v[i] = v[pivot]!
      v[pivot] = tmpV
    }
    // 소거.
    const piv = M[i]![i]!
    for (let r = i + 1; r < n; r++) {
      const factor = M[r]![i]! / piv
      if (factor === 0) continue
      for (let c = i; c < n; c++) {
        M[r]![c] = M[r]![c]! - factor * M[i]![c]!
      }
      v[r] = v[r]! - factor * v[i]!
    }
  }

  // 후방대입.
  const x: number[] = new Array(n).fill(0)
  for (let i = n - 1; i >= 0; i--) {
    let s = v[i]!
    for (let c = i + 1; c < n; c++) {
      s -= M[i]![c]! * x[c]!
    }
    const diag = M[i]![i]!
    if (Math.abs(diag) < 1e-12) return null
    x[i] = s / diag
  }
  return x
}

/** R² 를 원본 y 공간에서 계산. ssTot=0 이면 1 로 약속 (모든 y 가 동일). */
function computeR2(valid: readonly XYPoint[], predict: (x: number) => number): number {
  const n = valid.length
  if (n === 0) return 0
  let sumY = 0
  for (const p of valid) sumY += p.y
  const meanY = sumY / n
  let ssRes = 0
  let ssTot = 0
  for (const p of valid) {
    const yHat = predict(p.x)
    const dr = p.y - yHat
    const dt = p.y - meanY
    ssRes += dr * dr
    ssTot += dt * dt
  }
  if (ssTot === 0) return 1
  let r2 = 1 - ssRes / ssTot
  if (!Number.isFinite(r2)) return 0
  if (r2 < 0) r2 = 0
  if (r2 > 1) r2 = 1
  return r2
}

/**
 * 최소제곱 다항회귀 (degree=2|3). normal equation 직접 풀이.
 * n < degree+1 또는 행렬 singular 면 null.
 */
export function polyFit(points: readonly XYPoint[], degree: 2 | 3): PolyFitResult | null {
  const valid: XYPoint[] = []
  for (const p of points) {
    if (isFinitePoint(p)) valid.push(p)
  }
  const n = valid.length
  const k = degree + 1
  if (n < k) return null

  // X^T X (k×k) 와 X^T y (k). X 의 행은 [1, x, x^2, ..., x^degree].
  // (X^T X)[i][j] = Σ x^(i+j). 그래서 sumX[d] = Σ x^d 를 d=0..2*degree 까지 미리 모은다.
  const sumXPow: number[] = new Array(2 * degree + 1).fill(0)
  const sumYX: number[] = new Array(k).fill(0)
  for (const p of valid) {
    let xp = 1
    for (let d = 0; d <= 2 * degree; d++) {
      sumXPow[d] = (sumXPow[d] ?? 0) + xp
      if (d < k) sumYX[d] = (sumYX[d] ?? 0) + p.y * xp
      xp *= p.x
    }
  }

  const A: number[][] = []
  for (let i = 0; i < k; i++) {
    const row: number[] = []
    for (let j = 0; j < k; j++) row.push(sumXPow[i + j] ?? 0)
    A.push(row)
  }
  const coeffs = solveLinearSystem(A, sumYX)
  if (!coeffs) return null

  const r2 = computeR2(valid, (x) => polyEval(coeffs, x))
  return { coeffs, r2, n }
}

/**
 * 모델 y = a*exp(b*x). y>0 인 점만 사용 → log(y) = log(a) + b*x 로 선형회귀.
 * 사용 가능 점 < 2 면 null. R² 는 원본 y 공간에서 재계산.
 */
export function exponentialFit(points: readonly XYPoint[]): ExpFitResult | null {
  const valid: XYPoint[] = []
  for (const p of points) {
    if (isFinitePoint(p) && p.y > 0) valid.push(p)
  }
  if (valid.length < 2) return null

  const logPts: XYPoint[] = valid.map((p) => ({ x: p.x, y: Math.log(p.y) }))
  const lin = linearFit(logPts)
  if (lin.n < 2) return null

  const b = lin.slope
  const a = Math.exp(lin.intercept)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null

  const r2 = computeR2(valid, (x) => a * Math.exp(b * x))
  return { a, b, r2, n: valid.length }
}

/**
 * 모델 y = a*x^b. x>0 AND y>0 인 점만 → log(y) = log(a) + b*log(x).
 */
export function powerFit(points: readonly XYPoint[]): PowerFitResult | null {
  const valid: XYPoint[] = []
  for (const p of points) {
    if (isFinitePoint(p) && p.x > 0 && p.y > 0) valid.push(p)
  }
  if (valid.length < 2) return null

  const logPts: XYPoint[] = valid.map((p) => ({ x: Math.log(p.x), y: Math.log(p.y) }))
  const lin = linearFit(logPts)
  if (lin.n < 2) return null

  const b = lin.slope
  const a = Math.exp(lin.intercept)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null

  const r2 = computeR2(valid, (x) => a * Math.pow(x, b))
  return { a, b, r2, n: valid.length }
}

/** 위 fit 결과들의 union (각 함수의 반환을 합쳐서 평가/포맷에 사용). */
export type AnyFitResult =
  | (LinearFitResult & { coeffs?: number[]; a?: number; b?: number })
  | (PolyFitResult & { slope?: number; intercept?: number; a?: number; b?: number })
  | (ExpFitResult & { slope?: number; intercept?: number; coeffs?: number[] })
  | (PowerFitResult & { slope?: number; intercept?: number; coeffs?: number[] })

/**
 * 주어진 xs 에 대해 fit 모델의 y 값을 계산. 미정의 type 이면 빈 배열.
 * 차트에서 별도 line series 로 회귀곡선을 그릴 때 쓴다.
 */
export function evaluateFit(
  fitType: FitType,
  result: AnyFitResult,
  xs: readonly number[],
): number[] {
  switch (fitType) {
    case 'linear': {
      const slope = result.slope ?? 0
      const intercept = result.intercept ?? 0
      return xs.map((x) => slope * x + intercept)
    }
    case 'poly2':
    case 'poly3': {
      const coeffs = result.coeffs
      if (!coeffs || coeffs.length === 0) return []
      return xs.map((x) => polyEval(coeffs, x))
    }
    case 'exp': {
      const a = result.a ?? 0
      const b = result.b ?? 0
      return xs.map((x) => a * Math.exp(b * x))
    }
    case 'power': {
      const a = result.a ?? 0
      const b = result.b ?? 0
      // x<=0 은 NaN 이지만 호출측이 powerFit 통과한 시리즈라면 보통 안전.
      return xs.map((x) => a * Math.pow(x, b))
    }
    default:
      return []
  }
}

/** R² 만 안전하게 꺼낸다 (NaN → 0). */
function safeR2(r2: unknown): string {
  const v = typeof r2 === 'number' && Number.isFinite(r2) ? r2 : 0
  return v.toFixed(3)
}

/**
 * 사람이 읽는 식 + R². 각 fitType 별 다른 표기.
 *   linear: y = a·x + b (R²=…)
 *   poly2:  y = c2·x² + c1·x + c0 (R²=…)
 *   poly3:  y = c3·x³ + c2·x² + c1·x + c0 (R²=…)
 *   exp:    y = a·e^(b·x) (R²=…)
 *   power:  y = a·x^b (R²=…)
 */
export function formatFitGeneric(fitType: FitType, result: AnyFitResult): string {
  switch (fitType) {
    case 'linear': {
      const slope = result.slope ?? 0
      const intercept = result.intercept ?? 0
      return formatFit({ slope, intercept, r2: typeof result.r2 === 'number' ? result.r2 : 0, n: result.n ?? 0 })
    }
    case 'poly2':
    case 'poly3': {
      const coeffs = result.coeffs ?? []
      const r2 = safeR2(result.r2)
      // 고차항부터 표시.
      const parts: string[] = []
      for (let d = coeffs.length - 1; d >= 0; d--) {
        const c = coeffs[d] ?? 0
        if (d === coeffs.length - 1) {
          parts.push(`${formatNum(c)}${termX(d)}`)
        } else {
          const sign = c >= 0 ? '+' : '-'
          parts.push(`${sign} ${formatNum(Math.abs(c))}${termX(d)}`)
        }
      }
      return `y = ${parts.join(' ')} (R²=${r2})`
    }
    case 'exp': {
      const a = formatNum(result.a ?? 0)
      const b = formatNum(result.b ?? 0)
      const r2 = safeR2(result.r2)
      return `y = ${a}·e^(${b}·x) (R²=${r2})`
    }
    case 'power': {
      const a = formatNum(result.a ?? 0)
      const b = formatNum(result.b ?? 0)
      const r2 = safeR2(result.r2)
      return `y = ${a}·x^${b} (R²=${r2})`
    }
    default:
      return ''
  }
}

/** 다항식의 d 차 항 문자열 (계수 제외). d=0 → "", d=1 → "·x", d>=2 → "·x^d" (²/³ 유니코드). */
function termX(d: number): string {
  if (d === 0) return ''
  if (d === 1) return '·x'
  if (d === 2) return '·x²'
  if (d === 3) return '·x³'
  return `·x^${d}`
}
