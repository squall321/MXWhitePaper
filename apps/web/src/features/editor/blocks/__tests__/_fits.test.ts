import { describe, expect, it } from 'vitest'
import {
  evaluateFit,
  exponentialFit,
  fitLine,
  formatFit,
  formatFitGeneric,
  linearFit,
  polyFit,
  powerFit,
  type XYPoint,
} from '../_fits'

describe('linearFit', () => {
  it('정확히 y = 2x + 1 위의 4 점이면 slope=2, intercept=1, r2=1', () => {
    const pts: XYPoint[] = [
      { x: 0, y: 1 },
      { x: 1, y: 3 },
      { x: 2, y: 5 },
      { x: 3, y: 7 },
    ]
    const fit = linearFit(pts)
    expect(fit.slope).toBeCloseTo(2, 10)
    expect(fit.intercept).toBeCloseTo(1, 10)
    expect(fit.r2).toBeGreaterThan(0.9999)
    expect(fit.n).toBe(4)
  })

  it('빈 배열 → 0/0/0/0', () => {
    const fit = linearFit([])
    expect(fit).toEqual({ slope: 0, intercept: 0, r2: 0, n: 0 })
  })

  it('한 점만 → slope=0, intercept=y, r2=0', () => {
    const fit = linearFit([{ x: 5, y: 42 }])
    expect(fit.slope).toBe(0)
    expect(fit.intercept).toBe(42)
    expect(fit.r2).toBe(0)
    expect(fit.n).toBe(1)
  })

  it('모든 x 가 동일 (수직선) → slope=0, r2=0', () => {
    const pts: XYPoint[] = [
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 1, y: 2 },
    ]
    const fit = linearFit(pts)
    expect(fit.slope).toBe(0)
    expect(fit.r2).toBe(0)
  })

  it('노이즈 있는 대략 선형 → r2 가 0.5~0.95 사이', () => {
    // y ≈ 3x + 2 + noise (결정적, 시드 없이 재현 가능하도록 고정값).
    const pts: XYPoint[] = [
      { x: 0, y: 2.4 },
      { x: 1, y: 4.8 },
      { x: 2, y: 9.1 },
      { x: 3, y: 10.5 },
      { x: 4, y: 13.9 },
      { x: 5, y: 18.2 },
      { x: 6, y: 19.0 },
      { x: 7, y: 24.5 },
      { x: 8, y: 25.1 },
      { x: 9, y: 30.7 },
    ]
    const fit = linearFit(pts)
    expect(fit.r2).toBeGreaterThan(0.5)
    expect(fit.r2).toBeLessThan(0.999)
    expect(fit.slope).toBeGreaterThan(2)
    expect(fit.slope).toBeLessThan(4)
  })

  it('NaN/Infinity 점은 skip — n 카운트도 제외', () => {
    const pts: XYPoint[] = [
      { x: 0, y: 1 },
      { x: Number.NaN, y: 3 },
      { x: 1, y: 3 },
      { x: 2, y: Number.POSITIVE_INFINITY },
      { x: 2, y: 5 },
      { x: Number.NEGATIVE_INFINITY, y: 0 },
      { x: 3, y: 7 },
    ]
    const fit = linearFit(pts)
    expect(fit.n).toBe(4) // 유효 4 점
    expect(fit.slope).toBeCloseTo(2, 10)
    expect(fit.intercept).toBeCloseTo(1, 10)
    expect(fit.r2).toBeGreaterThan(0.9999)
  })
})

describe('formatFit', () => {
  it('식 텍스트에 "y = ", "x ", "(R²=" 가 포함된다', () => {
    const s = formatFit({ slope: 1.234, intercept: 0.567, r2: 0.987, n: 5 })
    expect(s).toContain('y = ')
    expect(s).toContain('x ')
    expect(s).toContain('(R²=')
  })

  it('음수 절편이면 "- " 로 표시', () => {
    const s = formatFit({ slope: 2, intercept: -3, r2: 0.9, n: 5 })
    expect(s).toContain('- 3')
    expect(s).not.toContain('+ -')
  })

  it('R² 는 소수 셋째 자리까지', () => {
    const s = formatFit({ slope: 1, intercept: 0, r2: 0.123456, n: 5 })
    expect(s).toContain('0.123')
  })
})

describe('fitLine', () => {
  it('정상 시리즈 → 두 endpoint x 가 입력 min/max 와 같다', () => {
    const pts: XYPoint[] = [
      { x: 0, y: 1 },
      { x: 5, y: 11 },
      { x: 3, y: 7 },
      { x: 10, y: 21 },
    ]
    const out = fitLine(pts)
    expect(out).not.toBeNull()
    if (out) {
      expect(out.line[0].x).toBe(0)
      expect(out.line[1].x).toBe(10)
      // y = 2x + 1 위에 있으므로 endpoint y 도 계산식과 일치.
      expect(out.line[0].y).toBeCloseTo(1, 10)
      expect(out.line[1].y).toBeCloseTo(21, 10)
      expect(out.fit.r2).toBeGreaterThan(0.9999)
    }
  })

  it('점이 1 개 이하면 null', () => {
    expect(fitLine([])).toBeNull()
    expect(fitLine([{ x: 1, y: 2 }])).toBeNull()
  })

  it('모든 x 가 동일하면 null', () => {
    const pts: XYPoint[] = [
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 1, y: 2 },
    ]
    expect(fitLine(pts)).toBeNull()
  })

  it('NaN 섞인 점은 min/max 계산에서도 제외', () => {
    const pts: XYPoint[] = [
      { x: Number.NaN, y: 999 },
      { x: 0, y: 1 },
      { x: 4, y: 9 },
    ]
    const out = fitLine(pts)
    expect(out).not.toBeNull()
    if (out) {
      expect(out.line[0].x).toBe(0)
      expect(out.line[1].x).toBe(4)
    }
  })
})

describe('polyFit', () => {
  it('정확한 포물선 y = 2x² - 3x + 1 → R²=1, 계수 일치', () => {
    // 5 점 (degree=2 는 3 점이면 결정되지만 fit 검증을 위해 더 많이).
    const f = (x: number) => 2 * x * x - 3 * x + 1
    const pts: XYPoint[] = [-2, -1, 0, 1, 2, 3].map((x) => ({ x, y: f(x) }))
    const r = polyFit(pts, 2)
    expect(r).not.toBeNull()
    if (r) {
      expect(r.r2).toBeGreaterThan(0.9999)
      expect(r.coeffs.length).toBe(3)
      expect(r.coeffs[0]!).toBeCloseTo(1, 6) // c0
      expect(r.coeffs[1]!).toBeCloseTo(-3, 6) // c1
      expect(r.coeffs[2]!).toBeCloseTo(2, 6) // c2
      expect(r.n).toBe(6)
    }
  })

  it('정확한 3차 y = x³ + 0·x² + 0·x + 0 → R²=1', () => {
    const f = (x: number) => x * x * x
    const pts: XYPoint[] = [-2, -1, 0, 1, 2, 3].map((x) => ({ x, y: f(x) }))
    const r = polyFit(pts, 3)
    expect(r).not.toBeNull()
    if (r) {
      expect(r.r2).toBeGreaterThan(0.9999)
      expect(r.coeffs.length).toBe(4)
      expect(r.coeffs[3]!).toBeCloseTo(1, 6)
    }
  })

  it('degree+1 미만 점 → null', () => {
    // degree=2 → 3 점 필요. 2 점은 null.
    const pts2: XYPoint[] = [
      { x: 0, y: 1 },
      { x: 1, y: 2 },
    ]
    expect(polyFit(pts2, 2)).toBeNull()
    // degree=3 → 4 점 필요.
    const pts3: XYPoint[] = [
      { x: 0, y: 1 },
      { x: 1, y: 2 },
      { x: 2, y: 5 },
    ]
    expect(polyFit(pts3, 3)).toBeNull()
  })

  it('모든 x 가 동일 (수직선) → null (singular)', () => {
    const pts: XYPoint[] = [
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 1, y: 2 },
      { x: 1, y: 3 },
    ]
    expect(polyFit(pts, 2)).toBeNull()
  })
})

describe('exponentialFit', () => {
  it('y = 2·exp(0.5·x) → a≈2, b≈0.5, R² 높음', () => {
    const xs = [0, 1, 2, 3, 4, 5]
    const pts: XYPoint[] = xs.map((x) => ({ x, y: 2 * Math.exp(0.5 * x) }))
    const r = exponentialFit(pts)
    expect(r).not.toBeNull()
    if (r) {
      expect(r.a).toBeCloseTo(2, 6)
      expect(r.b).toBeCloseTo(0.5, 6)
      expect(r.r2).toBeGreaterThan(0.999)
      expect(r.n).toBe(xs.length)
    }
  })

  it('y<=0 점은 제외하고 fit', () => {
    const pts: XYPoint[] = [
      { x: 0, y: 2 },
      { x: 1, y: -1 }, // skip
      { x: 2, y: 2 * Math.exp(1) },
      { x: 3, y: 0 }, // skip
      { x: 4, y: 2 * Math.exp(2) },
    ]
    const r = exponentialFit(pts)
    expect(r).not.toBeNull()
    if (r) {
      expect(r.n).toBe(3)
      expect(r.a).toBeCloseTo(2, 6)
      expect(r.b).toBeCloseTo(0.5, 6)
    }
  })

  it('사용 가능 점 < 2 → null', () => {
    const pts: XYPoint[] = [{ x: 0, y: 1 }, { x: 1, y: -1 }]
    expect(exponentialFit(pts)).toBeNull()
  })
})

describe('powerFit', () => {
  it('y = 3·x^1.5, x>0 → a≈3, b≈1.5', () => {
    const xs = [1, 2, 3, 4, 5]
    const pts: XYPoint[] = xs.map((x) => ({ x, y: 3 * Math.pow(x, 1.5) }))
    const r = powerFit(pts)
    expect(r).not.toBeNull()
    if (r) {
      expect(r.a).toBeCloseTo(3, 6)
      expect(r.b).toBeCloseTo(1.5, 6)
      expect(r.r2).toBeGreaterThan(0.999)
      expect(r.n).toBe(xs.length)
    }
  })

  it('x<=0 또는 y<=0 점 모두 제외', () => {
    const pts: XYPoint[] = [
      { x: 1, y: 3 },
      { x: 0, y: 1 }, // x<=0 skip
      { x: -1, y: 5 }, // x<=0 skip
      { x: 2, y: 0 }, // y<=0 skip
      { x: 3, y: -1 }, // y<=0 skip
      { x: 4, y: 3 * Math.pow(4, 1.5) },
      { x: 9, y: 3 * Math.pow(9, 1.5) },
    ]
    const r = powerFit(pts)
    expect(r).not.toBeNull()
    if (r) {
      expect(r.n).toBe(3)
      expect(r.a).toBeCloseTo(3, 6)
      expect(r.b).toBeCloseTo(1.5, 6)
    }
  })

  it('사용 가능 점 < 2 → null', () => {
    const pts: XYPoint[] = [{ x: 1, y: 1 }, { x: -1, y: 1 }]
    expect(powerFit(pts)).toBeNull()
  })
})

describe('evaluateFit', () => {
  const xs = [0, 1, 2, 3]

  it('linear — slope/intercept 로 평가, 길이 = xs.length', () => {
    const ys = evaluateFit('linear', { slope: 2, intercept: 1, r2: 1, n: 5 }, xs)
    expect(ys.length).toBe(xs.length)
    expect(ys).toEqual([1, 3, 5, 7])
  })

  it('poly2 — coeffs 평가', () => {
    // y = 1 + 2x + 3x²
    const ys = evaluateFit('poly2', { coeffs: [1, 2, 3], r2: 1, n: 5 }, xs)
    expect(ys.length).toBe(xs.length)
    expect(ys[0]).toBeCloseTo(1)
    expect(ys[1]).toBeCloseTo(6) // 1+2+3
    expect(ys[2]).toBeCloseTo(17) // 1+4+12
    expect(ys[3]).toBeCloseTo(34) // 1+6+27
  })

  it('poly3 — coeffs 평가', () => {
    // y = x³
    const ys = evaluateFit('poly3', { coeffs: [0, 0, 0, 1], r2: 1, n: 5 }, xs)
    expect(ys.length).toBe(xs.length)
    expect(ys[3]).toBeCloseTo(27)
  })

  it('exp — a·exp(b·x)', () => {
    const ys = evaluateFit('exp', { a: 2, b: 0.5, r2: 1, n: 5 }, xs)
    expect(ys.length).toBe(xs.length)
    expect(ys[0]).toBeCloseTo(2)
    expect(ys[2]).toBeCloseTo(2 * Math.exp(1))
  })

  it('power — a·x^b (x>0)', () => {
    const ys = evaluateFit('power', { a: 3, b: 1.5, r2: 1, n: 5 }, [1, 4, 9])
    expect(ys.length).toBe(3)
    expect(ys[0]).toBeCloseTo(3)
    expect(ys[1]).toBeCloseTo(3 * Math.pow(4, 1.5))
  })

  it('coeffs 없으면 poly 는 빈 배열', () => {
    const ys = evaluateFit('poly2', { r2: 0, n: 0 } as never, xs)
    expect(ys).toEqual([])
  })
})

describe('formatFitGeneric', () => {
  it('linear — 기존 formatFit 와 호환', () => {
    const s = formatFitGeneric('linear', { slope: 2, intercept: 1, r2: 0.9, n: 5 })
    expect(s).toContain('y = ')
    expect(s).toContain('(R²=')
  })

  it('poly2 — x² 항이 들어간 식', () => {
    const s = formatFitGeneric('poly2', { coeffs: [1, -3, 2], r2: 0.95, n: 6 })
    expect(s).toContain('y = ')
    expect(s).toContain('x²')
    expect(s).toContain('(R²=0.950)')
  })

  it('poly3 — x³ 항 포함', () => {
    const s = formatFitGeneric('poly3', { coeffs: [0, 0, 0, 1], r2: 1, n: 5 })
    expect(s).toContain('x³')
  })

  it('exp — e^( 표기', () => {
    const s = formatFitGeneric('exp', { a: 1.2, b: 0.3, r2: 0.9, n: 5 })
    expect(s).toContain('e^(')
    expect(s).toContain('(R²=0.900)')
  })

  it('power — x^ 표기', () => {
    const s = formatFitGeneric('power', { a: 3, b: 1.5, r2: 0.9, n: 5 })
    expect(s).toContain('x^')
  })

  it('NaN r2 는 0.000 으로 안전 처리', () => {
    const s = formatFitGeneric('exp', { a: 1, b: 1, r2: Number.NaN as number, n: 0 })
    expect(s).toContain('(R²=0.000)')
  })
})
