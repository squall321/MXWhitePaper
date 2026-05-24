import { describe, expect, it } from 'vitest'
import {
  diffSeries,
  differentiate,
  findPeaks,
  integrate,
} from '../_derived'
import type { XYPoint } from '../_fits'

describe('differentiate', () => {
  it('y = x → dy/dx ≈ 1 모든 점', () => {
    const pts: XYPoint[] = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: 3 },
      { x: 4, y: 4 },
    ]
    const d = differentiate(pts)
    expect(d).toHaveLength(5)
    for (const p of d) {
      expect(p.y).toBeCloseTo(1, 10)
    }
  })

  it('y = x² → dy/dx ≈ 2x (중앙차분은 균등 격자에서 정확)', () => {
    const pts: XYPoint[] = []
    for (let i = 0; i <= 10; i++) pts.push({ x: i, y: i * i })
    const d = differentiate(pts)
    expect(d).toHaveLength(11)
    // 내부 점은 2x 정확히 (중앙차분으로 quadratic 은 정확).
    for (let i = 1; i < d.length - 1; i++) {
      expect(d[i]!.y).toBeCloseTo(2 * d[i]!.x, 10)
    }
  })

  it('빈 배열 → 빈 배열', () => {
    expect(differentiate([])).toEqual([])
  })

  it('한 점만 → 빈 배열', () => {
    expect(differentiate([{ x: 0, y: 1 }])).toEqual([])
  })

  it('무작위 순서 입력이어도 결과는 x 오름차순', () => {
    const pts: XYPoint[] = [
      { x: 3, y: 3 },
      { x: 0, y: 0 },
      { x: 2, y: 2 },
      { x: 1, y: 1 },
    ]
    const d = differentiate(pts)
    for (let i = 1; i < d.length; i++) {
      expect(d[i]!.x).toBeGreaterThan(d[i - 1]!.x)
    }
  })

  it('dx=0 인 인접 점은 skip', () => {
    const pts: XYPoint[] = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 1, y: 5 }, // 같은 x — 중앙차분 시 좌우 dx=0 회피해야.
      { x: 2, y: 2 },
    ]
    const d = differentiate(pts)
    // 적어도 부정확한 Infinity/NaN 이 들어가지 않아야 한다.
    for (const p of d) {
      expect(Number.isFinite(p.y)).toBe(true)
    }
  })
})

describe('integrate', () => {
  it('y=1 (상수) → ∫ = x - x0', () => {
    const pts: XYPoint[] = [
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 5, y: 1 },
    ]
    const I = integrate(pts)
    expect(I).toHaveLength(4)
    expect(I[0]!.y).toBe(0)
    expect(I[1]!.y).toBeCloseTo(1, 10)
    expect(I[2]!.y).toBeCloseTo(2, 10)
    expect(I[3]!.y).toBeCloseTo(5, 10)
  })

  it('y=x → ∫ ≈ x²/2 (사다리꼴은 선형 y 에 대해 정확)', () => {
    const pts: XYPoint[] = []
    for (let i = 0; i <= 10; i++) pts.push({ x: i, y: i })
    const I = integrate(pts)
    expect(I).toHaveLength(11)
    expect(I[0]!.y).toBe(0)
    expect(I[10]!.y).toBeCloseTo(50, 10) // 10²/2.
    expect(I[5]!.y).toBeCloseTo(12.5, 10)
  })

  it('빈/단일점 → 빈 배열', () => {
    expect(integrate([])).toEqual([])
    expect(integrate([{ x: 0, y: 1 }])).toEqual([])
  })

  it('무작위 순서 입력이어도 결과는 x 오름차순 & 누적 시작 0', () => {
    const pts: XYPoint[] = [
      { x: 4, y: 1 },
      { x: 1, y: 1 },
      { x: 3, y: 1 },
      { x: 2, y: 1 },
    ]
    const I = integrate(pts)
    expect(I[0]!.y).toBe(0)
    for (let i = 1; i < I.length; i++) {
      expect(I[i]!.x).toBeGreaterThan(I[i - 1]!.x)
    }
  })
})

describe('findPeaks', () => {
  it('[1,3,1,5,1] → peak at idx 1,3, valley at idx 2', () => {
    const pts: XYPoint[] = [
      { x: 0, y: 1 },
      { x: 1, y: 3 },
      { x: 2, y: 1 },
      { x: 3, y: 5 },
      { x: 4, y: 1 },
    ]
    const peaks = findPeaks(pts)
    expect(peaks).toHaveLength(3)
    expect(peaks[0]).toEqual({ x: 1, y: 3, kind: 'peak' })
    expect(peaks[1]).toEqual({ x: 2, y: 1, kind: 'valley' })
    expect(peaks[2]).toEqual({ x: 3, y: 5, kind: 'peak' })
  })

  it('빈 배열 → 빈', () => {
    expect(findPeaks([])).toEqual([])
  })

  it('단일점 → 빈', () => {
    expect(findPeaks([{ x: 0, y: 1 }])).toEqual([])
  })

  it('두 점 → 빈 (끝점 제외 규칙)', () => {
    expect(findPeaks([{ x: 0, y: 1 }, { x: 1, y: 2 }])).toEqual([])
  })

  it('minProminence 로 작은 흔들림 무시', () => {
    // y_max=10, y_min=0 → 범위 10. minProminence=0.2 → 인접차 2 이하 무시.
    // 큰 peak: 0→10→0 (prom=10), 작은 peak: 4→5→4 (prom=1, 무시 대상).
    const pts: XYPoint[] = [
      { x: 0, y: 0 },
      { x: 1, y: 10 }, // 큰 peak, prom=min(10,10)=10.
      { x: 2, y: 0 },
      { x: 3, y: 4 },
      { x: 4, y: 5 }, // 작은 peak, prom=min(1,1)=1 → 임계 2 보다 작음.
      { x: 5, y: 4 },
      { x: 6, y: 0 },
    ]
    const peaks = findPeaks(pts, { minProminence: 0.2 })
    const onlyPeaks = peaks.filter((p) => p.kind === 'peak')
    expect(onlyPeaks).toHaveLength(1)
    expect(onlyPeaks[0]!.x).toBe(1)
  })

  it('minProminence=0 (기본) → 모든 극값 반환', () => {
    const pts: XYPoint[] = [
      { x: 0, y: 0 },
      { x: 1, y: 1 }, // 작은 peak.
      { x: 2, y: 0 },
      { x: 3, y: 10 }, // 큰 peak.
      { x: 4, y: 0 },
    ]
    const peaks = findPeaks(pts)
    const onlyPeaks = peaks.filter((p) => p.kind === 'peak')
    expect(onlyPeaks).toHaveLength(2)
  })

  it('plateau — 같은 y 연속이면 가운데를 representative', () => {
    const pts: XYPoint[] = [
      { x: 0, y: 0 },
      { x: 1, y: 5 },
      { x: 2, y: 5 },
      { x: 3, y: 5 },
      { x: 4, y: 0 },
    ]
    const peaks = findPeaks(pts)
    expect(peaks).toHaveLength(1)
    expect(peaks[0]!.kind).toBe('peak')
    expect(peaks[0]!.y).toBe(5)
    // [1,2,3] 의 중앙 인덱스 2 → x=2.
    expect(peaks[0]!.x).toBe(2)
  })
})

describe('diffSeries', () => {
  it('같은 x 시리즈 두 개 → y2 - y1', () => {
    const a: XYPoint[] = [
      { x: 0, y: 1 },
      { x: 1, y: 2 },
      { x: 2, y: 3 },
    ]
    const b: XYPoint[] = [
      { x: 0, y: 5 },
      { x: 1, y: 7 },
      { x: 2, y: 9 },
    ]
    const d = diffSeries(a, b)
    expect(d).toEqual([
      { x: 0, y: 4 },
      { x: 1, y: 5 },
      { x: 2, y: 6 },
    ])
  })

  it('일부만 공통 → 공통 x 만 결과', () => {
    const a: XYPoint[] = [
      { x: 0, y: 10 },
      { x: 1, y: 20 },
      { x: 2, y: 30 },
    ]
    const b: XYPoint[] = [
      { x: 1, y: 25 },
      { x: 2, y: 35 },
      { x: 3, y: 100 }, // a 에 없음.
    ]
    const d = diffSeries(a, b)
    expect(d).toEqual([
      { x: 1, y: 5 },
      { x: 2, y: 5 },
    ])
  })

  it('공통 x 없음 → 빈 배열', () => {
    const a: XYPoint[] = [{ x: 0, y: 1 }]
    const b: XYPoint[] = [{ x: 1, y: 2 }]
    expect(diffSeries(a, b)).toEqual([])
  })

  it('무작위 순서 입력 — 결과는 x 오름차순', () => {
    const a: XYPoint[] = [
      { x: 3, y: 1 },
      { x: 1, y: 1 },
      { x: 2, y: 1 },
    ]
    const b: XYPoint[] = [
      { x: 2, y: 2 },
      { x: 3, y: 2 },
      { x: 1, y: 2 },
    ]
    const d = diffSeries(a, b)
    expect(d).toHaveLength(3)
    for (let i = 1; i < d.length; i++) {
      expect(d[i]!.x).toBeGreaterThan(d[i - 1]!.x)
    }
    for (const p of d) expect(p.y).toBe(1)
  })
})
