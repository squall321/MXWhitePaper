import { describe, it, expect } from 'vitest'
import { extractUnit, parseChartPaste } from '../_chartPaste'

describe('parseChartPaste — 기본 2 컬럼', () => {
  it('헤더 없는 2 컬럼 TSV → 단일 시리즈', () => {
    const r = parseChartPaste('1\t2\n3\t4')
    expect(r).not.toBeNull()
    expect(r!.title).toBeUndefined()
    expect(r!.xAxisLabel).toBeUndefined()
    expect(r!.yAxisLabel).toBeUndefined()
    expect(r!.series).toHaveLength(1)
    expect(r!.series[0]!.name).toBe('Series 1')
    expect(r!.series[0]!.points).toEqual([
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ])
  })

  it('헤더가 있는 2 컬럼 TSV → x/y 라벨 인식', () => {
    const r = parseChartPaste('x\ty\n1\t2\n3\t4')
    expect(r).not.toBeNull()
    expect(r!.xAxisLabel).toBe('x')
    expect(r!.yAxisLabel).toBe('y')
    expect(r!.series).toHaveLength(1)
    expect(r!.series[0]!.points).toEqual([
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ])
  })
})

describe('parseChartPaste — 타이틀 행', () => {
  it('첫 행이 단일 셀 타이틀 (delimiter 없는 줄) → title 추출', () => {
    const r = parseChartPaste('Stress vs Strain\n\nx\ty\n1\t2')
    expect(r).not.toBeNull()
    expect(r!.title).toBe('Stress vs Strain')
    expect(r!.xAxisLabel).toBe('x')
    expect(r!.yAxisLabel).toBe('y')
    expect(r!.series[0]!.points).toEqual([{ x: 1, y: 2 }])
  })
})

describe('parseChartPaste — 단위 포함 헤더', () => {
  it('xAxisLabel 에 단위 그대로 포함', () => {
    const r = parseChartPaste('Strain [mm/mm]\tStress [MPa]\n0\t0\n0.1\t100')
    expect(r).not.toBeNull()
    expect(r!.xAxisLabel).toBe('Strain [mm/mm]')
    expect(r!.yAxisLabel).toBe('Stress [MPa]')
    // 시리즈 name 은 단위가 빠진 깔끔한 이름.
    expect(r!.series[0]!.name).toBe('Stress')
    expect(r!.series[0]!.points).toEqual([
      { x: 0, y: 0 },
      { x: 0.1, y: 100 },
    ])
  })
})

describe('parseChartPaste — 3 컬럼 멀티 시리즈', () => {
  it('첫 컬럼 공통 x, 나머지가 각 시리즈 y', () => {
    const r = parseChartPaste('x\ty1\ty2\n1\t10\t20\n2\t30\t40')
    expect(r).not.toBeNull()
    expect(r!.xAxisLabel).toBe('x')
    // 멀티 시리즈는 yAxisLabel 비움.
    expect(r!.yAxisLabel).toBeUndefined()
    expect(r!.series).toHaveLength(2)
    expect(r!.series[0]!.name).toBe('y1')
    expect(r!.series[0]!.points).toEqual([
      { x: 1, y: 10 },
      { x: 2, y: 30 },
    ])
    expect(r!.series[1]!.name).toBe('y2')
    expect(r!.series[1]!.points).toEqual([
      { x: 1, y: 20 },
      { x: 2, y: 40 },
    ])
  })

  it('헤더 없는 3 컬럼 (모든 셀이 숫자) → Series N 자동명', () => {
    const r = parseChartPaste('1\t10\t20\n2\t30\t40')
    expect(r).not.toBeNull()
    expect(r!.xAxisLabel).toBeUndefined()
    expect(r!.series).toHaveLength(2)
    expect(r!.series[0]!.name).toBe('Series 1')
    expect(r!.series[1]!.name).toBe('Series 2')
  })
})

describe('parseChartPaste — 실패/엣지 케이스', () => {
  it('빈 입력 → null', () => {
    expect(parseChartPaste('')).toBeNull()
  })

  it('1 행만 있는 입력 → null', () => {
    expect(parseChartPaste('1\t2')).toBeNull()
  })

  it('CSV 형식이 아닌 잡문 → null', () => {
    expect(parseChartPaste('hello world')).toBeNull()
    expect(parseChartPaste('lorem ipsum\ndolor sit amet')).toBeNull()
  })
})

describe('extractUnit', () => {
  it('대괄호 [..] 인식', () => {
    expect(extractUnit('Stress [MPa]')).toEqual({ name: 'Stress', unit: 'MPa' })
  })

  it('단위 없는 헤더 → unit 빈 문자열', () => {
    expect(extractUnit('x')).toEqual({ name: 'x', unit: '' })
  })

  it('소괄호 (..) 인식', () => {
    expect(extractUnit('y (m/s)')).toEqual({ name: 'y', unit: 'm/s' })
  })

  it('중괄호 {..} 인식', () => {
    expect(extractUnit('angle {deg}')).toEqual({ name: 'angle', unit: 'deg' })
  })

  it('단위만 있는 헤더 → name 빈 문자열, unit 추출', () => {
    expect(extractUnit('{deg}')).toEqual({ name: '', unit: 'deg' })
  })

  it('앞뒤 공백 정리', () => {
    expect(extractUnit('  Stress   [MPa]  ')).toEqual({ name: 'Stress', unit: 'MPa' })
  })
})
