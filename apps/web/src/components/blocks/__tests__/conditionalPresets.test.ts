import { describe, it, expect } from 'vitest'
import {
  buildPresetRules,
  presetAboveAverage,
  presetBottom10,
  presetDuplicates,
  presetNonPositive,
  presetTop10,
  PRESET_LIST,
  PRESET_STYLES,
} from '../conditionalPresets'

describe('presetTop10', () => {
  it('emits a single top_n rule with n = ceil(count * 0.1), clamped to ≥ 1', () => {
    // 30 numeric values → ceil(3) = 3
    const values = Array.from({ length: 30 }, (_, i) => String(i + 1))
    const rules = presetTop10('매출', values)
    expect(rules).toHaveLength(1)
    const rule = rules[0]!
    expect(rule).toEqual({
      column: '매출',
      operator: 'top_n',
      value: 3,
      style: PRESET_STYLES.top10pct,
    })
  })

  it('clamps to at least 1 even for tiny columns', () => {
    const rules = presetTop10(0, ['5'])
    expect(rules[0]!.value).toBe(1)
  })

  it('returns [] when the column has no numeric data', () => {
    expect(presetTop10('x', ['', 'abc', undefined])).toEqual([])
  })
})

describe('presetBottom10', () => {
  it('emits a single bottom_n rule using the same count math', () => {
    const values = Array.from({ length: 25 }, (_, i) => String(i + 1))
    const rules = presetBottom10(2, values)
    expect(rules).toHaveLength(1)
    expect(rules[0]).toEqual({
      column: 2,
      operator: 'bottom_n',
      value: 3, // ceil(2.5)
      style: PRESET_STYLES.bottom10pct,
    })
  })
})

describe('presetAboveAverage', () => {
  it('emits a gt rule whose threshold is the column mean', () => {
    const rules = presetAboveAverage('score', ['10', '20', '30'])
    expect(rules).toHaveLength(1)
    expect(rules[0]).toEqual({
      column: 'score',
      operator: 'gt',
      value: 20,
      style: PRESET_STYLES.aboveAverage,
    })
  })

  it('coerces formatted strings (%, $, thousands) when computing the mean', () => {
    const rules = presetAboveAverage(0, ['1,000', '$2,000', '3000'])
    // mean of 1000, 2000, 3000 = 2000
    expect(rules[0]!.value).toBe(2000)
  })

  it('returns [] when no numeric data exists', () => {
    expect(presetAboveAverage(0, ['abc', '', undefined])).toEqual([])
  })
})

describe('presetNonPositive', () => {
  it('emits an lte:0 rule with red-bold style — no column data needed', () => {
    const rules = presetNonPositive('잔액')
    expect(rules).toEqual([
      {
        column: '잔액',
        operator: 'lte',
        value: 0,
        style: PRESET_STYLES.nonPositive,
      },
    ])
  })
})

describe('presetDuplicates', () => {
  it('emits one eq rule per duplicated value, ignoring singletons', () => {
    const rules = presetDuplicates(0, ['A', 'B', 'A', 'C', 'B', 'A'])
    // Both A (×3) and B (×2) are duplicates; C is unique.
    expect(rules).toHaveLength(2)
    const values = rules.map((r) => r.value).sort()
    expect(values).toEqual(['A', 'B'])
    for (const r of rules) {
      expect(r.operator).toBe('eq')
      expect(r.column).toBe(0)
      expect(r.style).toEqual(PRESET_STYLES.duplicates)
    }
  })

  it('uses numeric form when the value coerces to a number', () => {
    const rules = presetDuplicates('count', ['10', '20', '10'])
    expect(rules).toHaveLength(1)
    expect(rules[0]!.value).toBe(10) // numeric, not the string '10'
  })

  it('returns [] when no duplicates exist', () => {
    expect(presetDuplicates(0, ['A', 'B', 'C'])).toEqual([])
    expect(presetDuplicates(0, [])).toEqual([])
  })

  it('ignores empty / undefined cells', () => {
    const rules = presetDuplicates(0, ['', 'A', '', 'A', undefined])
    // Only 'A' duplicates — the empty cells are not treated as a duplicate group.
    expect(rules).toHaveLength(1)
    expect(rules[0]!.value).toBe('A')
  })
})

describe('buildPresetRules — dispatch', () => {
  it('routes each preset id to its builder', () => {
    const vals = ['10', '20', '30']
    expect(buildPresetRules('top10pct', 0, vals)[0]!.operator).toBe('top_n')
    expect(buildPresetRules('bottom10pct', 0, vals)[0]!.operator).toBe('bottom_n')
    expect(buildPresetRules('aboveAverage', 0, vals)[0]!.operator).toBe('gt')
    expect(buildPresetRules('nonPositive', 0, vals)[0]!.operator).toBe('lte')
    // 'duplicates' returns [] when no dups — exercise it with an actual dup.
    expect(
      buildPresetRules('duplicates', 0, ['x', 'x'])[0]!.operator,
    ).toBe('eq')
  })
})

describe('PRESET_LIST — UI metadata contract', () => {
  it('lists all five presets with non-empty label + description', () => {
    expect(PRESET_LIST).toHaveLength(5)
    const ids = PRESET_LIST.map((p) => p.id)
    expect(ids).toEqual([
      'top10pct',
      'bottom10pct',
      'aboveAverage',
      'nonPositive',
      'duplicates',
    ])
    for (const p of PRESET_LIST) {
      expect(p.label.length).toBeGreaterThan(0)
      expect(p.description.length).toBeGreaterThan(0)
    }
  })
})
