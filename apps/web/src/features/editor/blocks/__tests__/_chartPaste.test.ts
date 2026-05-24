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

describe('parseChartPaste — timestamp x (P3)', () => {
  it('ISO date 시계열 → xAxisType=time, x 는 unix ms', () => {
    const r = parseChartPaste('2024-01-01\t100\n2024-01-02\t110\n2024-01-03\t120')
    expect(r).not.toBeNull()
    expect(r!.xAxisType).toBe('time')
    expect(r!.series).toHaveLength(1)
    const pts = r!.series[0]!.points
    expect(pts).toHaveLength(3)
    expect(pts[0]!.x).toBe(Date.parse('2024-01-01'))
    expect(pts[0]!.y).toBe(100)
    expect(pts[2]!.x).toBe(Date.parse('2024-01-03'))
  })

  it('ISO datetime → xAxisType=time', () => {
    const r = parseChartPaste(
      '2024-01-01T00:00:00Z\t50\n2024-01-01T12:00:00Z\t60',
    )
    expect(r).not.toBeNull()
    expect(r!.xAxisType).toBe('time')
    expect(r!.series[0]!.points[0]!.x).toBe(
      Date.parse('2024-01-01T00:00:00Z'),
    )
  })

  it('슬래시 패턴 YYYY/MM/DD → xAxisType=time', () => {
    const r = parseChartPaste('2024/01/01\t1\n2024/01/02\t2')
    expect(r).not.toBeNull()
    expect(r!.xAxisType).toBe('time')
    expect(r!.series[0]!.points[0]!.x).toBe(Date.parse('2024/01/01'))
  })

  it('헤더 date/price + ISO date → xAxisType=time, xAxisLabel=date', () => {
    const r = parseChartPaste('date\tprice\n2024-01-01\t100\n2024-01-02\t110')
    expect(r).not.toBeNull()
    expect(r!.xAxisType).toBe('time')
    expect(r!.xAxisLabel).toBe('date')
    expect(r!.yAxisLabel).toBe('price')
    expect(r!.series[0]!.points[0]!.x).toBe(Date.parse('2024-01-01'))
  })

  it('헤더에 time 키워드 + unix ms 정수 → xAxisType=time', () => {
    const r = parseChartPaste('time\tv\n1700000000000\t1\n1700000060000\t2')
    expect(r).not.toBeNull()
    expect(r!.xAxisType).toBe('time')
    expect(r!.series[0]!.points[0]!.x).toBe(1700000000000)
  })

  it('헤더 time 키워드 없는 unix-like 큰 정수 → xAxisType 미지정 (일반 number)', () => {
    const r = parseChartPaste('1700000000000\t1\n1700000060000\t2')
    expect(r).not.toBeNull()
    expect(r!.xAxisType).toBeUndefined()
    expect(r!.series[0]!.points).toEqual([
      { x: 1700000000000, y: 1 },
      { x: 1700000060000, y: 2 },
    ])
  })

  it('일반 숫자 x (변위/힘 케이스 회귀) → xAxisType 미지정', () => {
    const r = parseChartPaste('Strain [mm/mm]\tStress [MPa]\n0\t0\n0.1\t100')
    expect(r).not.toBeNull()
    expect(r!.xAxisType).toBeUndefined()
  })

  it('첫 컬럼에 일부만 ISO date (mix) → timestamp 미인식 (= xAxisType 미지정)', () => {
    // 첫 행은 ISO date, 두 번째는 일반 숫자. 일관성 없음 → timestamp 컬럼 아님.
    // x 셀이 모두 finite number 여야 하므로 ISO 행은 toPoints 에서 NaN 으로 drop.
    const r = parseChartPaste('2024-01-01\t1\n5\t2\n10\t3')
    expect(r).not.toBeNull()
    expect(r!.xAxisType).toBeUndefined()
    // ISO 행은 Number('2024-01-01')=NaN 으로 drop, 숫자 2 행만 남는다.
    expect(r!.series[0]!.points).toEqual([
      { x: 5, y: 2 },
      { x: 10, y: 3 },
    ])
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
