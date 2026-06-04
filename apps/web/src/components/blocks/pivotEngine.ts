import type { PivotTableBlock } from '@/types/document'

/**
 * Pure cross-tab pivot engine.
 *
 * Sprint 1: rows × cols cross-tab + 8 aggregators
 *   (sum / count / avg / min / max / median / stdev / var).
 *
 * Sprint 2: filter (in / not_in / gt / lt / top_n / bottom_n) +
 *   sort (by row/col dimension or measure label) +
 *   subtotal / grand total (raw-row re-aggregation, never agg-of-agg).
 *
 * Sprint 4: measure.expr — calculated field. When a measure has `expr` set
 *   (e.g. `'revenue - cost'`, `'profit / revenue * 100'`), each raw row's
 *   expression is evaluated using the row's field values as identifiers; the
 *   resulting numeric values are then aggregated with `agg` as usual (sum of
 *   per-row exprs, avg of per-row exprs, etc.). `expr` takes precedence over
 *   `field`. Supported in expressions: `+ - * /`, parentheses, numeric
 *   literals, and bare identifiers that reference the row's field names
 *   (case-sensitive). Rows whose expression evaluation fails (missing field,
 *   non-numeric field, divide by zero, parse error) are silently skipped —
 *   the same "graceful skip" semantics field-based measures use for non-
 *   numeric values. count(expr) counts rows whose expression evaluated to a
 *   finite number.
 *
 * Sprint 3: measure.showAs transforms each cell value in `values` after
 *   aggregation. Supported:
 *     - 'value'      (default)     — raw aggregate
 *     - 'pct_row'    cell / Σcells in same row (for this measure)
 *     - 'pct_col'    cell / Σcells in same col
 *     - 'pct_total'  cell / Σ all cells (for this measure)
 *     - 'running'    row-wise cumulative sum across cols (col order = current)
 *   Denominators are sum-of-cells (not re-aggregated raw rows) so the
 *   transform is well-defined for any agg and doesn't depend on totals.* toggles.
 *   null cells contribute 0 to denominators; result of x/0 → null.
 *   `running` propagates: a null cell yields null in that slot but does not
 *   reset the running sum — the next non-null cell continues from the
 *   previous accumulator.
 *   When showAs ≠ 'value', the corresponding rowTotals/colTotals/grandTotals
 *   for that measure are recomputed from the transformed value grid (sum of
 *   transformed cells along the axis) so they stay numerically consistent
 *   (e.g. pct_row row-total = 1.0). `running` totals are the last running
 *   value along the row (rowTotals) or the column sum of raw aggregates
 *   (colTotals/grand — same as showAs='value').
 *
 * Output shape:
 *   - rowHeaders[i] = dim-value tuple identifying row i (one entry per `rowDims`)
 *   - colHeaders[j] = dim-value tuple identifying col j (one entry per `colDims`)
 *   - values[i][j][k] = aggregated value of measures[k] over raw rows that
 *     match rowHeaders[i] and colHeaders[j]; `null` if the (row, col) bucket
 *     has zero raw rows.
 *   - rowTotals[i][k] / colTotals[j][k] / grandTotals[k] — Sprint 2; only
 *     present when the corresponding `totals.*` toggle is on. Computed by
 *     re-aggregating the underlying raw rows (so avg, median, stdev are
 *     correct rather than agg-of-agg).
 *
 * Header ordering is the first-seen order from the raw rows (stable) before
 * an optional `sort` rearranges row OR col axis.
 *
 * Aggregator semantics:
 *   - `count` = COUNTA equivalent — counts every non-null field value
 *     (numeric or string), matching Excel pivot-table behaviour.
 *   - All other aggregators are numeric-only; non-numeric / null values
 *     in the measure field are silently skipped.
 *   - Empty input for a numeric aggregator → null in the cell (not error).
 *   - `stdev` / `var` use the sample formula (denominator n − 1). With
 *     fewer than 2 numeric values the cell is null.
 *
 * Complexity: O(N · D) where N = raw row count, D = total dim count.
 */

export type AggKind = PivotTableBlock['values'][number]['agg']

export interface PivotResult {
  /** One tuple per output row, in first-seen order (or sorted). */
  rowHeaders: string[][]
  /** One tuple per output col, in first-seen order (or sorted). Empty when `cols=[]`. */
  colHeaders: string[][]
  /** values[rowIdx][colIdx][measureIdx] — null = empty bucket. */
  values: (number | null)[][][]
  /** Echoed from the block — handy for renderers. Sprint 5 union: each entry
   *  is either `'field'` or `{field, group?}`. Use `dimField` / `dimLabel`
   *  helpers when consuming. */
  rowDims: DimSpec[]
  colDims: DimSpec[]
  measures: PivotTableBlock['values']
  /** Sprint 2 — only present when `totals.row` is true. rowTotals[i][k]. */
  rowTotals?: (number | null)[][]
  /** Sprint 2 — only present when `totals.col` is true. colTotals[j][k]. */
  colTotals?: (number | null)[][]
  /** Sprint 2 — only present when `totals.grand` is true. grandTotals[k]. */
  grandTotals?: (number | null)[]
}

type RawRow = ReturnType<typeof sourceRows>[number]
type Measure = PivotTableBlock['values'][number]
type FilterSpec = NonNullable<PivotTableBlock['filters']>[number]

/**
 * Sprint 5 — rows/cols are `(string | {field, group?})`. Normalised spec the
 * engine actually consumes. `group` triggers date-bucket coercion via
 * `bucketDate`; otherwise `dimValue` reads the raw field.
 */
export type DimSpec = NonNullable<PivotTableBlock['rows']>[number]
export type DateGroup = 'year' | 'quarter' | 'month' | 'week' | 'day'

/**
 * Sprint 6 — read the inline raw rows from a PivotTableBlock's `source`.
 * Source is now a union: inline/csv carry `rows`, data-source defers to
 * a sibling DataSourceBlock and exposes `rows` as `[]` here (the viewer
 * hydrates a synthetic clone with rows from useDataSource() before
 * calling buildPivot — engine stays pure).
 */
export function sourceRows(
  source: PivotTableBlock['source'],
): readonly Record<string, string | number | null | undefined>[] {
  if (source && 'rows' in source && Array.isArray(source.rows)) return source.rows
  return []
}

/** Field name a `DimSpec` reads from a raw row. */
export function dimField(d: DimSpec): string {
  return typeof d === 'string' ? d : d.field
}

/** Header / picker label for a `DimSpec` — `field` plain, `field_group` when grouped. */
export function dimLabel(d: DimSpec): string {
  if (typeof d === 'string') return d
  return d.group ? `${d.field}_${d.group}` : d.field
}

function dimGroup(d: DimSpec): DateGroup | undefined {
  return typeof d === 'string' ? undefined : (d.group as DateGroup | undefined)
}

/** Tuple-as-string key for the bucket map; `\x1f` (US) is never a field value. */
const SEP = '\x1f'

function tupleKey(parts: string[]): string {
  return parts.join(SEP)
}

/**
 * Read a field's value as the display string used in headers.
 * Missing / undefined / null → '' (per spec — appears as '' in the tuple).
 */
function dimValue(row: RawRow, field: string): string {
  const v = row[field]
  if (v == null) return ''
  return String(v)
}

/**
 * Sprint 5 — read a dim spec's bucket label from `row`. When the spec is
 * `{field, group}`, the raw value is parsed as a date and bucketed at the
 * requested granularity. Unparseable / missing → '' (same convention as
 * `dimValue`) so the row simply lands in the empty bucket instead of
 * throwing — keeps the engine robust against ragged source data.
 */
function dimBucket(row: RawRow, spec: DimSpec): string {
  const field = dimField(spec)
  const group = dimGroup(spec)
  if (!group) return dimValue(row, field)
  return bucketDate(row[field], group)
}

/**
 * Coerce `v` to a Date and emit the bucket label at the requested
 * granularity. ISO date string ('2024-03-15'), epoch ms (number), Date
 * object — all supported. Unparseable → ''. Week uses ISO week (Mon-start,
 * year boundary follows ISO 8601 so e.g. 2024-12-30 is `2025-W01`).
 *
 * Exported for unit testing; engine uses it internally via dimBucket.
 */
export function bucketDate(v: unknown, group: DateGroup): string {
  if (v == null || v === '') return ''
  const d = v instanceof Date ? v : new Date(typeof v === 'number' ? v : String(v))
  if (Number.isNaN(d.getTime())) return ''
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth() + 1
  const day = d.getUTCDate()
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  switch (group) {
    case 'year':    return String(y)
    case 'quarter': return `${y}-Q${Math.floor((m - 1) / 3) + 1}`
    case 'month':   return `${y}-${pad(m)}`
    case 'day':     return `${y}-${pad(m)}-${pad(day)}`
    case 'week': {
      // ISO 8601 week — Thursday-of-the-week defines the week's year.
      const t = new Date(Date.UTC(y, d.getUTCMonth(), day))
      const dow = t.getUTCDay() || 7
      t.setUTCDate(t.getUTCDate() + 4 - dow)
      const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
      const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
      return `${t.getUTCFullYear()}-W${pad(week)}`
    }
  }
}

/** Coerce a raw field value to a finite number, or null. */
function toNum(v: string | number | null | undefined): number | null {
  if (v == null || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * Aggregate `rows` for one measure. When `isExpr` is true, `fieldOrExpr` is
 * an expression evaluated per row against that row's fields (Sprint 4 —
 * calculated field). Otherwise it's a plain field name (Sprint 1+).
 *
 * For `count` the semantics match Excel:
 *   - field mode: COUNTA over the field (non-null/non-empty values).
 *   - expr  mode: count rows whose expression evaluated to a finite number.
 *     Rows that fail to evaluate (missing field, parse error, div-by-zero,
 *     non-numeric) are silently skipped — same graceful skip the numeric
 *     aggregators use, so count(expr) stays consistent with sum(expr) etc.
 */
function aggregate(
  rows: RawRow[],
  fieldOrExpr: string,
  agg: AggKind,
  isExpr = false,
): number | null {
  // Pre-parse the expression once per call — the same AST is reused for every
  // row. Parse error here means *every* row would fail → return null/0 as
  // appropriate for the aggregator.
  let exprAst: ExprNode | null = null
  if (isExpr) {
    try {
      exprAst = parseExpr(fieldOrExpr)
    } catch {
      // Bad expression → no row can contribute. count=0, others=null.
      return agg === 'count' ? 0 : null
    }
  }

  // count = COUNTA: every non-null value in the field (numeric OR text).
  // For expr mode: count rows where expr evaluates to a finite number.
  if (agg === 'count') {
    let c = 0
    if (isExpr && exprAst) {
      for (const r of rows) {
        const n = evalExprForRow(exprAst, r)
        if (n !== null) c++
      }
      return c
    }
    for (const r of rows) {
      const v = r[fieldOrExpr]
      if (v != null && v !== '') c++
    }
    return c
  }

  // All other aggregators are numeric-only.
  const nums: number[] = []
  if (isExpr && exprAst) {
    for (const r of rows) {
      const n = evalExprForRow(exprAst, r)
      if (n !== null) nums.push(n)
    }
  } else {
    for (const r of rows) {
      const n = toNum(r[fieldOrExpr])
      if (n !== null) nums.push(n)
    }
  }
  if (nums.length === 0) return null

  switch (agg) {
    case 'sum': {
      let s = 0
      for (const n of nums) s += n
      return s
    }
    case 'avg': {
      let s = 0
      for (const n of nums) s += n
      return s / nums.length
    }
    case 'min': {
      let m = nums[0] as number
      for (let i = 1; i < nums.length; i++) {
        const v = nums[i] as number
        if (v < m) m = v
      }
      return m
    }
    case 'max': {
      let m = nums[0] as number
      for (let i = 1; i < nums.length; i++) {
        const v = nums[i] as number
        if (v > m) m = v
      }
      return m
    }
    case 'median': {
      const sorted = [...nums].sort((a, b) => a - b)
      const mid = Math.floor(sorted.length / 2)
      return sorted.length % 2
        ? (sorted[mid] as number)
        : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
    }
    case 'stdev':
    case 'var': {
      if (nums.length < 2) return null
      let mean = 0
      for (const n of nums) mean += n
      mean /= nums.length
      let sq = 0
      for (const n of nums) {
        const d = n - mean
        sq += d * d
      }
      const variance = sq / (nums.length - 1)
      return agg === 'var' ? variance : Math.sqrt(variance)
    }
  }
}

/** Default measure label — must match how `sort.by` references a measure. */
function measureLabel(m: Measure): string {
  if (m.label) return m.label
  // Sprint 4 — expr-based measure: label is `{agg}({expr})` (e.g.
  // `sum(revenue - cost)`). Falls back to field when expr is unset.
  const source = m.expr ?? m.field ?? ''
  return `${m.agg}(${source})`
}

/** Field-or-expr selector for `aggregate` — expr wins when present. */
function measureSource(m: Measure): { src: string; isExpr: boolean } {
  if (m.expr) return { src: m.expr, isExpr: true }
  return { src: m.field ?? '', isExpr: false }
}

// ─────────────────────────────────────────────────────────────────────────
// Sprint 4 — calculated-field expression evaluator.
//
// Grammar (matches the subset users actually need for `revenue - cost` or
// `profit / revenue * 100`):
//
//   expr   := term (('+' | '-') term)*
//   term   := factor (('*' | '/') factor)*
//   factor := ('+' | '-') factor | primary
//   primary:= number | ident | '(' expr ')'
//
// Identifiers reference fields on the raw row (case-sensitive — matches how
// fields appear in source.rows and the rest of the schema). A row whose
// expression evaluation throws (missing field, non-numeric field, parse
// error, division by zero, non-finite result) is silently skipped, the same
// way numeric aggregators silently skip non-numeric field values.
//
// Intentionally separate from spreadsheet/formulaEngine.ts: that engine
// resolves bare idents as A1-style cell refs, which doesn't fit here. The
// shared shape (recursive-descent, ASTNode style) is deliberate so the two
// stay maintainable side-by-side. No function calls (sum/avg/...) — those
// are the *outer* aggregator the measure already has; supporting them inside
// expr would change the contract from "per-row scalar" to "set of rows".
// ─────────────────────────────────────────────────────────────────────────

type ExprNode =
  | { type: 'num'; value: number }
  | { type: 'ref'; name: string }
  | { type: 'unary'; op: '+' | '-'; arg: ExprNode }
  | { type: 'bin'; op: '+' | '-' | '*' | '/'; left: ExprNode; right: ExprNode }

interface ExprToken {
  kind: 'num' | 'ident' | 'op' | 'lp' | 'rp' | 'eof'
  value: string
}

function tokenizeExpr(input: string): ExprToken[] {
  const out: ExprToken[] = []
  let i = 0
  while (i < input.length) {
    const ch = input[i] as string
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++
      continue
    }
    if ((ch >= '0' && ch <= '9') || ch === '.') {
      let j = i
      while (j < input.length && /[0-9.]/.test(input[j] as string)) j++
      out.push({ kind: 'num', value: input.slice(i, j) })
      i = j
      continue
    }
    if ((ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') || ch === '_') {
      let j = i
      while (j < input.length && /[A-Za-z0-9_]/.test(input[j] as string)) j++
      out.push({ kind: 'ident', value: input.slice(i, j) })
      i = j
      continue
    }
    // Sprint 5 — backtick-quoted identifier for calc-item labels that
    // contain spaces, Korean, or `-` (e.g. `\`Q1\`` or `\`January 2024\``).
    // The closing backtick is required; an unterminated literal raises
    // alongside other unexpected-char errors.
    if (ch === '`') {
      const end = input.indexOf('`', i + 1)
      if (end < 0) throw new Error('expr: unterminated backtick identifier')
      out.push({ kind: 'ident', value: input.slice(i + 1, end) })
      i = end + 1
      continue
    }
    if (ch === '(') {
      out.push({ kind: 'lp', value: ch })
      i++
      continue
    }
    if (ch === ')') {
      out.push({ kind: 'rp', value: ch })
      i++
      continue
    }
    if ('+-*/'.includes(ch)) {
      out.push({ kind: 'op', value: ch })
      i++
      continue
    }
    throw new Error('expr: unexpected character ' + JSON.stringify(ch))
  }
  out.push({ kind: 'eof', value: '' })
  return out
}

function parseExpr(src: string): ExprNode {
  const tokens = tokenizeExpr(src)
  let pos = 0
  const peek = (): ExprToken => tokens[pos] as ExprToken
  const eat = (): ExprToken => tokens[pos++] as ExprToken

  // Forward declarations via closures.
  function parseExprTop(): ExprNode {
    let left = parseTerm()
    while (peek().kind === 'op' && (peek().value === '+' || peek().value === '-')) {
      const op = eat().value as '+' | '-'
      const right = parseTerm()
      left = { type: 'bin', op, left, right }
    }
    return left
  }
  function parseTerm(): ExprNode {
    let left = parseFactor()
    while (peek().kind === 'op' && (peek().value === '*' || peek().value === '/')) {
      const op = eat().value as '*' | '/'
      const right = parseFactor()
      left = { type: 'bin', op, left, right }
    }
    return left
  }
  function parseFactor(): ExprNode {
    if (peek().kind === 'op' && (peek().value === '+' || peek().value === '-')) {
      const op = eat().value as '+' | '-'
      const arg = parseFactor()
      return { type: 'unary', op, arg }
    }
    return parsePrimary()
  }
  function parsePrimary(): ExprNode {
    const t = peek()
    if (t.kind === 'num') {
      eat()
      const n = parseFloat(t.value)
      if (!Number.isFinite(n)) throw new Error('expr: bad number ' + t.value)
      return { type: 'num', value: n }
    }
    if (t.kind === 'ident') {
      eat()
      return { type: 'ref', name: t.value }
    }
    if (t.kind === 'lp') {
      eat()
      const inner = parseExprTop()
      if (peek().kind !== 'rp') throw new Error('expr: missing )')
      eat()
      return inner
    }
    throw new Error('expr: unexpected token ' + t.kind + ' ' + JSON.stringify(t.value))
  }

  const ast = parseExprTop()
  if (peek().kind !== 'eof') throw new Error('expr: trailing tokens')
  return ast
}

/**
 * Evaluate `ast` against one row. Returns the numeric result, or null when
 * any field is missing / non-numeric, division-by-zero occurs, or the
 * result is non-finite. null = "skip this row" (same contract as toNum).
 */
function evalExprForRow(ast: ExprNode, row: RawRow): number | null {
  try {
    const v = evalExprNode(ast, row)
    return Number.isFinite(v) ? v : null
  } catch {
    return null
  }
}

function evalExprNode(node: ExprNode, row: RawRow): number {
  switch (node.type) {
    case 'num':
      return node.value
    case 'ref': {
      const raw = row[node.name]
      const n = toNum(raw)
      if (n === null) throw new Error('ref-missing')
      return n
    }
    case 'unary': {
      const v = evalExprNode(node.arg, row)
      return node.op === '-' ? -v : v
    }
    case 'bin': {
      const l = evalExprNode(node.left, row)
      const r = evalExprNode(node.right, row)
      switch (node.op) {
        case '+':
          return l + r
        case '-':
          return l - r
        case '*':
          return l * r
        case '/':
          if (r === 0) throw new Error('div-zero')
          return l / r
      }
    }
  }
}

/** Exported for tests — lets unit tests assert parser behaviour directly. */
export { parseExpr, evalExprForRow }
export type { ExprNode }

/**
 * Drill-down helper — return the raw rows that fall into a single
 * (rowTuple, colTuple) bucket of the pivot.
 *
 * `rowKey` / `colKey` are the dim-value tuples shown in the viewer's
 * row/col headers (i.e. one entry per `block.rows` / `block.cols`, in the
 * same order). For `block.cols=[]` pass an empty array as `colKey` — the
 * "virtual" single-col bucket matches every row.
 *
 * Filters are replayed (same `applyFilters` chain `buildPivot` uses) so
 * top_n / not_in / gt etc. are honoured before dim matching, keeping the
 * drill-down consistent with what the viewer shows.
 *
 * Field comparison uses `dimValue` (same coercion as header construction)
 * so e.g. `2024` (number) and `"2024"` (string) match the `"2024"` header.
 */
export function drillRows(
  block: PivotTableBlock,
  rowKey: string[],
  colKey: string[],
): RawRow[] {
  const rowDims = block.rows as DimSpec[]
  const colDims = block.cols as DimSpec[]
  const rawRows: RawRow[] = sourceRows(block.source) as RawRow[]
  const filtered = applyFilters(rawRows, block.filters)
  return filtered.filter((r) => {
    for (let i = 0; i < rowDims.length; i++) {
      const spec = rowDims[i] as DimSpec
      const want = rowKey[i] ?? ''
      if (dimBucket(r, spec) !== want) return false
    }
    for (let i = 0; i < colDims.length; i++) {
      const spec = colDims[i] as DimSpec
      const want = colKey[i] ?? ''
      if (dimBucket(r, spec) !== want) return false
    }
    return true
  })
}

export type { RawRow }

/**
 * Apply `filters` to the raw rows. Operators applied left-to-right; each
 * shrinks the working set.
 *
 *   in / not_in   — `value` is array; membership test uses string-equal
 *                   on the raw field value coerced to string.
 *   gt / lt       — numeric coercion; non-numeric field values are dropped.
 *   top_n/bot_n   — `value` is positive int; sort rows by the field
 *                   numerically and slice. Stable for ties (first-seen wins).
 */
export function applyFilters(rows: RawRow[], filters: FilterSpec[] | undefined): RawRow[] {
  if (!filters || filters.length === 0) return rows
  let out = rows
  for (const f of filters) {
    switch (f.op) {
      case 'in': {
        const set = new Set((f.value as unknown[]).map((v) => String(v)))
        out = out.filter((r) => {
          const v = r[f.field]
          return v != null && set.has(String(v))
        })
        break
      }
      case 'not_in': {
        const set = new Set((f.value as unknown[]).map((v) => String(v)))
        out = out.filter((r) => {
          const v = r[f.field]
          // null counts as "not in any concrete set" → kept.
          return v == null || !set.has(String(v))
        })
        break
      }
      case 'gt': {
        const t = Number(f.value)
        out = out.filter((r) => {
          const n = toNum(r[f.field])
          return n !== null && n > t
        })
        break
      }
      case 'lt': {
        const t = Number(f.value)
        out = out.filter((r) => {
          const n = toNum(r[f.field])
          return n !== null && n < t
        })
        break
      }
      // G4 — `between` is inclusive on both ends and works for both
      // numeric and string fields (string compare for ISO-date timelines).
      // value MUST be [lo, hi]; out-of-shape inputs no-op.
      case 'between': {
        const v = f.value as unknown
        if (!Array.isArray(v) || v.length !== 2) break
        const lo = v[0] as string | number | null
        const hi = v[1] as string | number | null
        const loN = toNum(lo)
        const hiN = toNum(hi)
        const numeric = loN !== null && hiN !== null
        out = out.filter((r) => {
          const raw = r[f.field]
          if (raw == null) return false
          if (numeric) {
            const n = toNum(raw)
            return n !== null && n >= (loN as number) && n <= (hiN as number)
          }
          const s = String(raw)
          return s >= String(lo) && s <= String(hi)
        })
        break
      }
      case 'top_n':
      case 'bottom_n': {
        const n = Math.max(0, Number(f.value) | 0)
        // Stable sort by numeric coercion of field; rows with null are
        // dropped (can't rank them numerically).
        const indexed = out
          .map((r, i) => ({ r, i, n: toNum(r[f.field]) }))
          .filter((x) => x.n !== null) as { r: RawRow; i: number; n: number }[]
        indexed.sort((a, b) => {
          const cmp = f.op === 'top_n' ? b.n - a.n : a.n - b.n
          return cmp !== 0 ? cmp : a.i - b.i
        })
        out = indexed.slice(0, n).map((x) => x.r)
        break
      }
    }
  }
  return out
}

export function buildPivot(block: PivotTableBlock): PivotResult {
  const rowDims = block.rows as DimSpec[]
  const colDims = block.cols as DimSpec[]
  const measures = block.values
  const rawRows: RawRow[] = sourceRows(block.source) as RawRow[]

  // Sprint 2: filter first — everything below operates on `rows`.
  const rows = applyFilters(rawRows, block.filters)

  // First pass: collect header tuples in first-seen order and bucket the rows.
  const rowOrder: string[] = []
  const rowSeen = new Set<string>()
  const rowTuples = new Map<string, string[]>()
  const colOrder: string[] = []
  const colSeen = new Set<string>()
  const colTuples = new Map<string, string[]>()

  // Buckets keyed by `${rowKey}${SEP}${colKey}` → raw rows.
  const buckets = new Map<string, RawRow[]>()
  // Per-axis buckets used for subtotals (re-aggregated, not agg-of-agg).
  const rowBuckets = new Map<string, RawRow[]>()
  const colBuckets = new Map<string, RawRow[]>()

  // Sentinel col key used when `cols=[]` — single "virtual" col bucket.
  const NO_COL = ''

  for (const r of rows) {
    const rowTuple = rowDims.map((spec) => dimBucket(r, spec))
    const rKey = tupleKey(rowTuple)
    if (!rowSeen.has(rKey)) {
      rowSeen.add(rKey)
      rowOrder.push(rKey)
      rowTuples.set(rKey, rowTuple)
    }

    let cKey: string
    if (colDims.length === 0) {
      cKey = NO_COL
      if (!colSeen.has(cKey)) {
        colSeen.add(cKey)
        colOrder.push(cKey)
        colTuples.set(cKey, [])
      }
    } else {
      const colTuple = colDims.map((spec) => dimBucket(r, spec))
      cKey = tupleKey(colTuple)
      if (!colSeen.has(cKey)) {
        colSeen.add(cKey)
        colOrder.push(cKey)
        colTuples.set(cKey, colTuple)
      }
    }

    const bKey = rKey + SEP + cKey
    let bucket = buckets.get(bKey)
    if (!bucket) {
      bucket = []
      buckets.set(bKey, bucket)
    }
    bucket.push(r)

    let rb = rowBuckets.get(rKey)
    if (!rb) {
      rb = []
      rowBuckets.set(rKey, rb)
    }
    rb.push(r)

    let cb = colBuckets.get(cKey)
    if (!cb) {
      cb = []
      colBuckets.set(cKey, cb)
    }
    cb.push(r)
  }

  // Second pass: materialise values[i][j][k] using current (first-seen) order.
  // We'll sort afterwards by permuting the order arrays.
  let rowHeaders = rowOrder.map((k) => rowTuples.get(k) as string[])
  let colHeaders = colOrder.map((k) => colTuples.get(k) as string[])

  const buildCell = (rKey: string, cKey: string): (number | null)[] => {
    const bucket = buckets.get(rKey + SEP + cKey)
    const cell: (number | null)[] = []
    if (!bucket) {
      for (let k = 0; k < measures.length; k++) cell.push(null)
    } else {
      for (const m of measures) {
        const { src, isExpr } = measureSource(m)
        cell.push(aggregate(bucket, src, m.agg, isExpr))
      }
    }
    return cell
  }

  let values: (number | null)[][][] = rowOrder.map((rKey) =>
    colOrder.map((cKey) => buildCell(rKey, cKey)),
  )

  // Sprint 2 — sort. Permute rowOrder OR colOrder and reapply to headers + values.
  if (block.sort && rowOrder.length > 0 && colOrder.length > 0) {
    const { axis, by, order = 'asc' } = block.sort
    const sign = order === 'desc' ? -1 : 1

    if (axis === 'row') {
      const dimIdx = rowDims.findIndex((d) => dimLabel(d) === by)
      const measureIdx = measures.findIndex((m) => measureLabel(m) === by)

      // Build (idx → sort key) — string for dim, number|null for measure-sum.
      const indices = rowOrder.map((_, i) => i)
      if (dimIdx >= 0) {
        indices.sort((a, b) => {
          const av = rowHeaders[a]?.[dimIdx] ?? ''
          const bv = rowHeaders[b]?.[dimIdx] ?? ''
          const cmp = av < bv ? -1 : av > bv ? 1 : a - b
          return sign * cmp
        })
      } else if (measureIdx >= 0) {
        // Sum the measure across all cols for each row (treating null as -∞/+∞
        // so empty rows land at the bottom regardless of order).
        const rowKey = (i: number): number | null => {
          let s: number | null = null
          for (let j = 0; j < colOrder.length; j++) {
            const v = values[i]?.[j]?.[measureIdx] ?? null
            if (v !== null) s = (s ?? 0) + v
          }
          return s
        }
        const keys = indices.map(rowKey)
        indices.sort((a, b) => {
          const av = keys[a] ?? null
          const bv = keys[b] ?? null
          if (av === null && bv === null) return a - b
          if (av === null) return 1 // nulls last
          if (bv === null) return -1
          const cmp = av < bv ? -1 : av > bv ? 1 : a - b
          return sign * cmp
        })
      }
      // Unknown `by` → no-op (don't reorder).

      rowHeaders = indices.map((i) => rowHeaders[i] as string[])
      values = indices.map((i) => values[i] as (number | null)[][])
      // Reorder rowOrder so totals computation below uses the same sequence.
      const newRowOrder = indices.map((i) => rowOrder[i] as string)
      rowOrder.length = 0
      rowOrder.push(...newRowOrder)
    } else {
      // axis === 'col'
      const dimIdx = colDims.findIndex((d) => dimLabel(d) === by)
      const measureIdx = measures.findIndex((m) => measureLabel(m) === by)

      const indices = colOrder.map((_, j) => j)
      if (dimIdx >= 0) {
        indices.sort((a, b) => {
          const av = colHeaders[a]?.[dimIdx] ?? ''
          const bv = colHeaders[b]?.[dimIdx] ?? ''
          const cmp = av < bv ? -1 : av > bv ? 1 : a - b
          return sign * cmp
        })
      } else if (measureIdx >= 0) {
        const colKey = (j: number): number | null => {
          let s: number | null = null
          for (let i = 0; i < rowOrder.length; i++) {
            const v = values[i]?.[j]?.[measureIdx] ?? null
            if (v !== null) s = (s ?? 0) + v
          }
          return s
        }
        const keys = indices.map(colKey)
        indices.sort((a, b) => {
          const av = keys[a] ?? null
          const bv = keys[b] ?? null
          if (av === null && bv === null) return a - b
          if (av === null) return 1
          if (bv === null) return -1
          const cmp = av < bv ? -1 : av > bv ? 1 : a - b
          return sign * cmp
        })
      }

      colHeaders = indices.map((j) => colHeaders[j] as string[])
      values = values.map(
        (row) => indices.map((j) => row[j] as (number | null)[]),
      )
      const newColOrder = indices.map((j) => colOrder[j] as string)
      colOrder.length = 0
      colOrder.push(...newColOrder)
    }
  }

  const result: PivotResult = {
    rowHeaders,
    colHeaders,
    values,
    rowDims,
    colDims,
    measures,
  }

  // Sprint 2 — totals (re-aggregate from raw rows so avg/median/stdev are
  // correct, not agg-of-agg).
  const totals = block.totals
  if (totals?.row) {
    result.rowTotals = rowOrder.map((rKey) => {
      const bucket = rowBuckets.get(rKey) ?? []
      return measures.map((m) => {
        const { src, isExpr } = measureSource(m)
        return aggregate(bucket, src, m.agg, isExpr)
      })
    })
  }
  if (totals?.col) {
    result.colTotals = colOrder.map((cKey) => {
      const bucket = colBuckets.get(cKey) ?? []
      return measures.map((m) => {
        const { src, isExpr } = measureSource(m)
        return aggregate(bucket, src, m.agg, isExpr)
      })
    })
  }
  if (totals?.grand) {
    result.grandTotals = measures.map((m) => {
      const { src, isExpr } = measureSource(m)
      return aggregate(rows, src, m.agg, isExpr)
    })
  }

  // Sprint 3 — apply showAs per measure. Mutates result.values (and the
  // matching totals slots if present) in place.
  applyShowAs(result)

  // Sprint 5 — synthesize calculated items (virtual rows / cols whose
  // values are arithmetic over other items on the same axis). Applied
  // AFTER showAs so percent / running displays for base items aren't
  // disturbed; the calculated item itself receives raw values that the
  // user can post-process by adding another calculated item if needed.
  applyCalculatedItems(result, block.calculatedItems ?? [])

  return result
}

/**
 * Sum of (non-null) cells along an axis for a single measure. null → skipped
 * (treated as 0 for denominator purposes); empty → 0.
 */
function sumCells(cells: ((number | null)[] | undefined)[], measureIdx: number): number {
  let s = 0
  for (const c of cells) {
    const v = c?.[measureIdx] ?? null
    if (v !== null) s += v
  }
  return s
}

/**
 * Sprint 3 — transform values per-measure according to showAs. Defaults to
 * 'value' (no-op). When a measure has a non-trivial showAs, recompute its
 * slot in rowTotals/colTotals/grandTotals (when present) from the transformed
 * grid so the displayed numbers stay self-consistent.
 */
function applyShowAs(result: PivotResult): void {
  const { values, measures, rowTotals, colTotals, grandTotals } = result
  const nRows = values.length
  const nCols = values[0]?.length ?? 0

  for (let k = 0; k < measures.length; k++) {
    const showAs = measures[k]?.showAs ?? 'value'
    if (showAs === 'value') continue

    if (showAs === 'running') {
      // Row-wise cumulative across cols. null cells produce null in that
      // slot but do not reset the accumulator.
      for (let i = 0; i < nRows; i++) {
        let acc: number | null = null
        const row = values[i] as (number | null)[][]
        for (let j = 0; j < nCols; j++) {
          const cell = row[j] as (number | null)[]
          const v = cell[k] ?? null
          if (v === null) {
            cell[k] = null
          } else {
            acc = (acc ?? 0) + v
            cell[k] = acc
          }
        }
        // rowTotals for running = last running value (= sum of all non-null
        // cells in the row). Matches sum-of-cells semantics.
        if (rowTotals) {
          const rt = rowTotals[i] as (number | null)[]
          rt[k] = acc
        }
      }
      // colTotals / grandTotals: leave the raw re-aggregated values from
      // earlier passes (they remain meaningful for a 'running' measure as a
      // column subtotal). Intentionally a no-op.
      continue
    }

    // pct_* — compute denominators from the value grid (sum of cells).
    const rowDenoms = new Array<number>(nRows)
    for (let i = 0; i < nRows; i++) {
      rowDenoms[i] = sumCells(values[i] ?? [], k)
    }
    const colDenoms = new Array<number>(nCols)
    for (let j = 0; j < nCols; j++) {
      const col: ((number | null)[] | undefined)[] = []
      for (let i = 0; i < nRows; i++) col.push(values[i]?.[j])
      colDenoms[j] = sumCells(col, k)
    }
    let total = 0
    for (let i = 0; i < nRows; i++) total += rowDenoms[i] as number

    for (let i = 0; i < nRows; i++) {
      const row = values[i] as (number | null)[][]
      for (let j = 0; j < nCols; j++) {
        const cell = row[j] as (number | null)[]
        const v = cell[k] ?? null
        if (v === null) {
          cell[k] = null
          continue
        }
        let denom = 0
        if (showAs === 'pct_row') denom = rowDenoms[i] as number
        else if (showAs === 'pct_col') denom = colDenoms[j] as number
        else if (showAs === 'pct_total') denom = total
        cell[k] = denom === 0 ? null : v / denom
      }
    }

    // Recompute totals slots from transformed grid so they stay consistent.
    if (rowTotals) {
      for (let i = 0; i < nRows; i++) {
        const rt = rowTotals[i] as (number | null)[]
        const s = sumCells(values[i] ?? [], k)
        rt[k] = s === 0 ? null : s
      }
    }
    if (colTotals) {
      for (let j = 0; j < nCols; j++) {
        const ct = colTotals[j] as (number | null)[]
        const col: ((number | null)[] | undefined)[] = []
        for (let i = 0; i < nRows; i++) col.push(values[i]?.[j])
        const s = sumCells(col, k)
        ct[k] = s === 0 ? null : s
      }
    }
    if (grandTotals) {
      let s = 0
      for (let i = 0; i < nRows; i++) s += sumCells(values[i] ?? [], k)
      grandTotals[k] = s === 0 ? null : s
    }
  }
}

// ── Sprint 5 — calculated items ───────────────────────────────────────────
type CalcItem = NonNullable<PivotTableBlock['calculatedItems']>[number]

/**
 * Synthesize calculated items as virtual rows/cols. Each item's `formula`
 * references *other items on the same axis* by label; the engine evaluates
 * the arithmetic per (measure × opposite-axis-position) cell.
 *
 *   axis: 'row'  → new entries appended to `rowHeaders` + `values`.
 *   axis: 'col'  → new entries appended to each `values[i]` + `colHeaders`.
 *
 * Reference resolution uses the first dim of each tuple as the label, which
 * matches what the viewer renders at the outermost tier. Backtick-quoted
 * identifiers (``Q1``) handle labels with spaces / Korean / `-`. Unknown /
 * missing labels → null cell.
 *
 * Calculated items are appended in source order so a later item can
 * reference an earlier one (e.g. `H1 = Q1 + Q2`).
 */
function applyCalculatedItems(result: PivotResult, items: readonly CalcItem[]): void {
  if (items.length === 0) return
  const measureCount = result.measures.length
  const rowLabels: string[] = result.rowHeaders.map((t) => t[0] ?? '')
  const colLabels: string[] = result.colHeaders.map((t) => t[0] ?? '')

  for (const item of items) {
    let ast: ExprNode
    try {
      ast = parseExpr(item.formula)
    } catch {
      continue
    }

    if (item.axis === 'row') {
      const newRow: (number | null)[][] = result.colHeaders.map((_, j) => {
        const cell: (number | null)[] = []
        for (let k = 0; k < measureCount; k++) {
          const ctx = new Map<string, number>()
          for (let i = 0; i < rowLabels.length; i++) {
            const v = result.values[i]?.[j]?.[k]
            if (v != null) ctx.set(rowLabels[i] ?? '', v)
          }
          cell.push(evalCalcExpr(ast, ctx))
        }
        return cell
      })
      result.rowHeaders.push([item.name])
      result.values.push(newRow)
      rowLabels.push(item.name)
    } else {
      for (let i = 0; i < result.values.length; i++) {
        const row = result.values[i]
        if (!row) continue
        const cell: (number | null)[] = []
        for (let k = 0; k < measureCount; k++) {
          const ctx = new Map<string, number>()
          for (let j = 0; j < colLabels.length; j++) {
            const v = row[j]?.[k]
            if (v != null) ctx.set(colLabels[j] ?? '', v)
          }
          cell.push(evalCalcExpr(ast, ctx))
        }
        row.push(cell)
      }
      result.colHeaders.push([item.name])
      colLabels.push(item.name)
    }
  }
}

/**
 * Evaluate a calc-item AST against a label→number context. Unknown
 * identifier or any null propagation → null (cell stays blank instead of
 * throwing). Division by zero → null.
 */
function evalCalcExpr(node: ExprNode, ctx: Map<string, number>): number | null {
  switch (node.type) {
    case 'num':
      return Number.isFinite(node.value) ? node.value : null
    case 'ref': {
      const v = ctx.get(node.name)
      return v == null || !Number.isFinite(v) ? null : v
    }
    case 'unary': {
      const a = evalCalcExpr(node.arg, ctx)
      if (a === null) return null
      return node.op === '-' ? -a : a
    }
    case 'bin': {
      const a = evalCalcExpr(node.left, ctx)
      const b = evalCalcExpr(node.right, ctx)
      if (a === null || b === null) return null
      switch (node.op) {
        case '+': return a + b
        case '-': return a - b
        case '*': return a * b
        case '/': return b === 0 ? null : a / b
      }
    }
  }
}

// ── H2 (G5) — ChartBlock aggregator ────────────────────────────────────
//
// Pivot 의 2D cross-tab 과 달리 chart 는 1D — labels (x축) 한 줄 +
// 시리즈 N 개. `aggregateChartData` 는 raw rows 를 받아 labelField 로
// 그룹하고, aggregations[] 각 entry 마다 한 시리즈 (`{name, values}`)
// 를 만들어 chart-engine 이 기대하는 `{labels, series}` shape 으로
// 반환. 이 결과를 ChartBlock 의 `data` 슬롯에 그대로 덮으면 recharts /
// echarts 양쪽 모두 추가 변경 없이 동작한다.
//
// Filter 단계는 `applyFilters` 를 재사용 — boundSlicers (Slicer/Timeline
// 가 만든 between/in 필터) 가 PivotTable 과 동일한 entry point 를 거치게.

export interface ChartAgg {
  field: string
  agg?: AggKind
  name?: string
  color?: string
  yAxisIndex?: 0 | 1
}

export interface ChartSeries {
  name: string
  values: number[]
  color?: string
  yAxisIndex?: 0 | 1
}

export interface ChartAggregateResult {
  labels: string[]
  series: ChartSeries[]
}

export function aggregateChartData(
  rawRows: ReadonlyArray<RawRow>,
  labelField: string,
  aggregations: ReadonlyArray<ChartAgg>,
  filters: ReadonlyArray<FilterSpec> | undefined,
): ChartAggregateResult {
  if (!labelField || aggregations.length === 0) {
    return { labels: [], series: [] }
  }

  // 1) raw filter (block.filters + collected slicer/timeline filters).
  const rows = applyFilters([...rawRows], filters ? [...filters] : undefined)

  // 2) labels = labelField 의 distinct 값 (first-seen 순서). null/undefined skip.
  const labels: string[] = []
  const labelIdx = new Map<string, number>()
  for (const r of rows) {
    const v = r[labelField]
    if (v == null) continue
    const s = String(v)
    if (!labelIdx.has(s)) {
      labelIdx.set(s, labels.length)
      labels.push(s)
    }
  }

  if (labels.length === 0) {
    // labels 가 비어있어도 시리즈 shape 은 유지 (engine 이 빈 차트로 처리).
    return {
      labels: [],
      series: aggregations.map((a) => ({
        name: a.name ?? a.field,
        values: [],
        ...(a.color !== undefined ? { color: a.color } : {}),
        ...(a.yAxisIndex !== undefined ? { yAxisIndex: a.yAxisIndex } : {}),
      })),
    }
  }

  // 3) row 들을 label bucket 으로 묶기.
  const buckets: RawRow[][] = labels.map(() => [])
  for (const r of rows) {
    const v = r[labelField]
    if (v == null) continue
    const idx = labelIdx.get(String(v))
    if (idx === undefined) continue
    buckets[idx]!.push(r)
  }

  // 4) 시리즈마다 bucket 별 aggregate. expression 은 미지원 (raw field 만)
  //    — chart 의 agg 는 의도적으로 단순. 향후 필요시 expr 분기 추가.
  const series: ChartSeries[] = aggregations.map((a) => {
    const aggKind = a.agg ?? 'sum'
    const values: number[] = buckets.map((rowsInBucket) => {
      const n = aggregate(rowsInBucket, a.field, aggKind)
      // chart 의 axis 는 number — null 을 0 으로 coerce. count 는 항상 number.
      return n ?? 0
    })
    return {
      name: a.name ?? a.field,
      values,
      ...(a.color !== undefined ? { color: a.color } : {}),
      ...(a.yAxisIndex !== undefined ? { yAxisIndex: a.yAxisIndex } : {}),
    }
  })

  return { labels, series }
}
