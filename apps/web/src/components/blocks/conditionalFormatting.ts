/**
 * Conditional formatting for TableBlock cells (WIDGET-02 Phase 1, FE-only).
 *
 * A rule = (optional column scope) + operator + value(s) + style. The
 * renderer walks rules per cell, OR-merges every matching rule's style
 * (later rules override earlier on the same key) and applies the result
 * as inline style on the <td>/<th>. Sparse cells' own `bg`/`color`/
 * `bold` always win over a conditional style — those are explicit user
 * intent, conditional rules are derived.
 *
 * Numeric operators (gt/gte/lt/lte/eq/neq/between/top_n/bottom_n) coerce
 * via {@link parseNumericForAggregate} so '1,234', '12%', '$50' work.
 * String operators (contains/not_contains) are case-insensitive
 * substring tests on the raw text. eq/neq fall back to a case-sensitive
 * string compare when both sides fail numeric coercion (so eq:"Pass"
 * still works on text columns).
 *
 * top_n / bottom_n need the whole column's values up front — caller
 * passes them via {@link RuleContext.columnValues}; if absent the
 * operator skips (no error, just no match).
 *
 * Out of scope for Phase 1: data bars, icon sets, color scales, docx
 * round-trip. KpiCards / Spreadsheet integration is deferred.
 */

import { parseNumericForAggregate } from './tableFormat'

export type ConditionalOperator =
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'eq'
  | 'neq'
  | 'between'
  | 'top_n'
  | 'bottom_n'
  | 'contains'
  | 'not_contains'

export interface ConditionalStyle {
  bg?: string
  fg?: string
  bold?: boolean
}

export interface ConditionalRule {
  /**
   * Column scope. `string` matches header text (case-sensitive); `number`
   * matches 0-based column index. `undefined` = apply to every column.
   */
  column?: string | number
  operator: ConditionalOperator
  value: number | string | [number, number]
  style: ConditionalStyle
}

export interface RuleContext {
  columnName?: string
  columnIndex: number
  /** Whole-column values required by top_n/bottom_n; ignored otherwise. */
  columnValues?: (number | string | undefined)[]
}

function _matchColumn(
  scope: ConditionalRule['column'],
  ctx: RuleContext,
): boolean {
  if (scope === undefined) return true
  if (typeof scope === 'number') return scope === ctx.columnIndex
  return scope === ctx.columnName
}

function _coerceNumber(v: number | string | undefined): number | null {
  if (v === undefined || v === null) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  return parseNumericForAggregate(v)
}

function _matchRule(
  rule: ConditionalRule,
  cellValue: number | string,
  ctx: RuleContext,
): boolean {
  const op = rule.operator
  if (op === 'contains' || op === 'not_contains') {
    const needle = String(rule.value).toLowerCase()
    const hay = String(cellValue).toLowerCase()
    const hit = hay.includes(needle)
    return op === 'contains' ? hit : !hit
  }
  if (op === 'between') {
    if (!Array.isArray(rule.value) || rule.value.length !== 2) return false
    const n = _coerceNumber(cellValue)
    if (n == null) return false
    const [lo, hi] = rule.value
    return n >= lo && n <= hi
  }
  if (op === 'top_n' || op === 'bottom_n') {
    const n = _coerceNumber(cellValue)
    if (n == null) return false
    const all = ctx.columnValues
    if (!all || all.length === 0) return false
    const nums: number[] = []
    for (const v of all) {
      const x = _coerceNumber(v)
      if (x != null) nums.push(x)
    }
    if (nums.length === 0) return false
    const k = Math.max(1, Math.floor(Number(rule.value)))
    if (!Number.isFinite(k)) return false
    nums.sort((a, b) => (op === 'top_n' ? b - a : a - b))
    const cutoff = nums[Math.min(k, nums.length) - 1]
    if (cutoff === undefined) return false
    return op === 'top_n' ? n >= cutoff : n <= cutoff
  }
  // gt/gte/lt/lte/eq/neq — try numeric first, fall back to string for eq/neq.
  const cn = _coerceNumber(cellValue)
  const rn = _coerceNumber(rule.value as number | string)
  if (cn != null && rn != null) {
    if (op === 'gt') return cn > rn
    if (op === 'gte') return cn >= rn
    if (op === 'lt') return cn < rn
    if (op === 'lte') return cn <= rn
    if (op === 'eq') return cn === rn
    if (op === 'neq') return cn !== rn
  }
  if (op === 'eq') return String(cellValue) === String(rule.value)
  if (op === 'neq') return String(cellValue) !== String(rule.value)
  return false
}

function _merge(
  base: ConditionalStyle | undefined,
  next: ConditionalStyle,
): ConditionalStyle {
  const out: ConditionalStyle = { ...(base ?? {}) }
  if (next.bg !== undefined) out.bg = next.bg
  if (next.fg !== undefined) out.fg = next.fg
  if (next.bold !== undefined) out.bold = next.bold
  return out
}

export function applyConditionalFormatting(
  rules: ConditionalRule[] | undefined,
  cellValue: number | string | undefined,
  ctx: RuleContext,
): ConditionalStyle | undefined {
  if (!rules?.length) return undefined
  if (cellValue === undefined || cellValue === null || cellValue === '') {
    return undefined
  }
  let merged: ConditionalStyle | undefined
  for (const r of rules) {
    if (!_matchColumn(r.column, ctx)) continue
    if (_matchRule(r, cellValue, ctx)) {
      merged = _merge(merged, r.style)
    }
  }
  return merged
}

/**
 * Layer an explicit sparse cell override on top of a conditional style.
 * Sparse cell fields ({@link bg}/{@link color}/{@link bold}) are user
 * intent — they always win when set.
 */
export function mergeCondStyle(
  base: ConditionalStyle | undefined,
  override: { bg?: string; color?: string; bold?: boolean } | undefined,
): ConditionalStyle | undefined {
  if (!base && !override) return undefined
  const out: ConditionalStyle = { ...(base ?? {}) }
  if (override?.bg !== undefined) out.bg = override.bg
  if (override?.color !== undefined) out.fg = override.color
  if (override?.bold !== undefined) out.bold = override.bold
  return out
}
