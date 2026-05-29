/**
 * Excel-style conditional formatting presets (WIDGET-02 Phase 2, FE-only).
 *
 * Each preset takes the target column and (when needed) the column's raw
 * values, then returns a list of {@link ConditionalRule} ready to append to
 * `TableBlock.options.conditionalFormatting`. Multiple rules per preset are
 * only emitted by {@link presetDuplicates} — every other preset returns a
 * single rule.
 *
 * All presets scope to a specific column (string header or 0-based index);
 * an `undefined` scope is not used because the Excel UX always picks "이
 * 컬럼에 적용" before clicking a preset.
 *
 * Why no `duplicates` operator on the helper? The schema's operator enum is
 * fixed (gt/gte/lt/lte/eq/neq/between/top_n/bottom_n/contains/not_contains)
 * and extending it touches both ends of the stack. Instead, {@link
 * presetDuplicates} expands into a set of `eq` rules — one per value that
 * appears more than once. This keeps the schema untouched while still
 * highlighting the duplicate cells.
 */

import { parseNumericForAggregate } from './tableFormat'
import type { ConditionalRule, ConditionalStyle } from './conditionalFormatting'

export type PresetId =
  | 'top10pct'
  | 'bottom10pct'
  | 'aboveAverage'
  | 'nonPositive'
  | 'duplicates'

export const PRESET_STYLES: Record<PresetId, ConditionalStyle> = {
  // Excel defaults: green/red soft fills, blue tint for averages, red bold
  // for negatives. Hex picked so the cell text stays readable on white.
  top10pct: { bg: '#d4edda' },
  bottom10pct: { bg: '#f8d7da' },
  aboveAverage: { bg: '#d1ecf1' },
  nonPositive: { fg: '#b91c1c', bold: true },
  duplicates: { bg: '#fff3cd' },
}

export interface PresetMeta {
  id: PresetId
  label: string
  description: string
}

export const PRESET_LIST: readonly PresetMeta[] = [
  { id: 'top10pct', label: '상위 10%', description: '값 기준 상위 10% 셀을 강조' },
  { id: 'bottom10pct', label: '하위 10%', description: '값 기준 하위 10% 셀을 강조' },
  { id: 'aboveAverage', label: '평균 초과', description: '컬럼 평균보다 큰 셀을 강조' },
  { id: 'nonPositive', label: '0 이하', description: '0 이하 값을 빨간 굵게 표시' },
  { id: 'duplicates', label: '중복', description: '두 번 이상 나타난 값을 강조' },
]

function _columnScope(column: string | number): ConditionalRule['column'] {
  return column
}

/**
 * Count of numeric values in the column → used to compute "top N" where N
 * is `ceil(count * pct)`. Returns 0 when no numbers are present so the
 * caller can skip emitting a rule.
 */
function _numericCount(columnValues: (string | number | undefined)[]): number {
  let n = 0
  for (const v of columnValues) {
    if (v === undefined || v === null || v === '') continue
    const num = typeof v === 'number' ? (Number.isFinite(v) ? v : null) : parseNumericForAggregate(v)
    if (num != null) n++
  }
  return n
}

/**
 * Mean of the column's numeric values. Returns `null` when no numbers
 * exist — caller skips emitting a rule in that case (an "above average"
 * rule against an empty column would never match anything useful).
 */
function _columnMean(columnValues: (string | number | undefined)[]): number | null {
  let sum = 0
  let n = 0
  for (const v of columnValues) {
    if (v === undefined || v === null || v === '') continue
    const num = typeof v === 'number' ? (Number.isFinite(v) ? v : null) : parseNumericForAggregate(v)
    if (num != null) {
      sum += num
      n++
    }
  }
  return n === 0 ? null : sum / n
}

export function presetTop10(
  column: string | number,
  columnValues: (string | number | undefined)[],
): ConditionalRule[] {
  const count = _numericCount(columnValues)
  if (count === 0) return []
  // ceil(count * 0.1), clamped to at least 1 so a small column still
  // highlights its single largest value.
  const n = Math.max(1, Math.ceil(count * 0.1))
  return [
    {
      column: _columnScope(column),
      operator: 'top_n',
      value: n,
      style: PRESET_STYLES.top10pct,
    },
  ]
}

export function presetBottom10(
  column: string | number,
  columnValues: (string | number | undefined)[],
): ConditionalRule[] {
  const count = _numericCount(columnValues)
  if (count === 0) return []
  const n = Math.max(1, Math.ceil(count * 0.1))
  return [
    {
      column: _columnScope(column),
      operator: 'bottom_n',
      value: n,
      style: PRESET_STYLES.bottom10pct,
    },
  ]
}

export function presetAboveAverage(
  column: string | number,
  columnValues: (string | number | undefined)[],
): ConditionalRule[] {
  const mean = _columnMean(columnValues)
  if (mean == null) return []
  return [
    {
      column: _columnScope(column),
      operator: 'gt',
      // Snap to 4 decimal places so the saved rule reads cleanly. Cell
      // values are tested as numbers regardless, so trimming precision here
      // doesn't change which cells match in practice.
      value: Math.round(mean * 10000) / 10000,
      style: PRESET_STYLES.aboveAverage,
    },
  ]
}

export function presetNonPositive(column: string | number): ConditionalRule[] {
  return [
    {
      column: _columnScope(column),
      operator: 'lte',
      value: 0,
      style: PRESET_STYLES.nonPositive,
    },
  ]
}

/**
 * Duplicates preset — expands into one `eq` rule per value that appears
 * more than once in the column. Empty cells are ignored. Numeric values
 * are emitted as numbers (so `eq` uses numeric compare); other values fall
 * back to the raw string form.
 */
export function presetDuplicates(
  column: string | number,
  columnValues: (string | number | undefined)[],
): ConditionalRule[] {
  const counts = new Map<string, { count: number; raw: string | number }>()
  for (const v of columnValues) {
    if (v === undefined || v === null || v === '') continue
    const key = String(v)
    const cur = counts.get(key)
    if (cur) cur.count++
    else counts.set(key, { count: 1, raw: v })
  }
  const dups: ConditionalRule[] = []
  for (const { count, raw } of counts.values()) {
    if (count < 2) continue
    const asNum =
      typeof raw === 'number'
        ? Number.isFinite(raw)
          ? raw
          : null
        : parseNumericForAggregate(raw)
    dups.push({
      column: _columnScope(column),
      operator: 'eq',
      value: asNum != null ? asNum : String(raw),
      style: PRESET_STYLES.duplicates,
    })
  }
  return dups
}

/**
 * Single entry point used by the UI — dispatches on the preset id and
 * returns the list of rules to append. Centralised so the panel doesn't
 * have to remember which presets need column values.
 */
export function buildPresetRules(
  id: PresetId,
  column: string | number,
  columnValues: (string | number | undefined)[],
): ConditionalRule[] {
  switch (id) {
    case 'top10pct':
      return presetTop10(column, columnValues)
    case 'bottom10pct':
      return presetBottom10(column, columnValues)
    case 'aboveAverage':
      return presetAboveAverage(column, columnValues)
    case 'nonPositive':
      return presetNonPositive(column)
    case 'duplicates':
      return presetDuplicates(column, columnValues)
  }
}

/**
 * Append preset rules to an existing rule list. Returned as a fresh array
 * so callers can hand it straight to a setState/patch boundary without
 * worrying about reference identity. Empty preset output (e.g. no numeric
 * data) returns the previous list unchanged — callers compare references
 * to decide whether anything changed.
 */
export function appendPresetRules(
  existing: ConditionalRule[] | undefined,
  id: PresetId,
  column: string | number,
  columnValues: (string | number | undefined)[],
): ConditionalRule[] | undefined {
  const next = buildPresetRules(id, column, columnValues)
  if (next.length === 0) return existing
  return [...(existing ?? []), ...next]
}
