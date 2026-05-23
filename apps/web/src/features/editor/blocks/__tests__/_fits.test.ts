import { describe, expect, it } from 'vitest'
import { fitLine, formatFit, linearFit, type XYPoint } from '../_fits'

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
