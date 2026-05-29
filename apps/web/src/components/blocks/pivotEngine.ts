import type { PivotTableBlock } from '@/types/document'

/**
 * Pure cross-tab pivot engine.
 *
 * Sprint 1: rows × cols cross-tab + 8 aggregators
 *   (sum / count / avg / min / max / median / stdev / var).
 *
 * Output shape:
 *   - rowHeaders[i] = dim-value tuple identifying row i (one entry per `rowDims`)
 *   - colHeaders[j] = dim-value tuple identifying col j (one entry per `colDims`)
 *   - values[i][j][k] = aggregated value of measures[k] over raw rows that
 *     match rowHeaders[i] and colHeaders[j]; `null` if the (row, col) bucket
 *     has zero raw rows.
 *
 * Header ordering is the first-seen order from the raw rows (stable).
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
  /** One tuple per output row, in first-seen order. */
  rowHeaders: string[][]
  /** One tuple per output col, in first-seen order. Empty when `cols=[]`. */
  colHeaders: string[][]
  /** values[rowIdx][colIdx][measureIdx] — null = empty bucket. */
  values: (number | null)[][][]
  /** Echoed from the block — handy for renderers. */
  rowDims: string[]
  colDims: string[]
  measures: PivotTableBlock['values']
}

type RawRow = PivotTableBlock['source']['rows'][number]

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

/** Coerce a raw field value to a finite number, or null. */
function toNum(v: string | number | null | undefined): number | null {
  if (v == null || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function aggregate(rows: RawRow[], field: string, agg: AggKind): number | null {
  // count = COUNTA: every non-null value in the field (numeric OR text).
  if (agg === 'count') {
    let c = 0
    for (const r of rows) {
      const v = r[field]
      if (v != null && v !== '') c++
    }
    return c
  }

  // All other aggregators are numeric-only.
  const nums: number[] = []
  for (const r of rows) {
    const n = toNum(r[field])
    if (n !== null) nums.push(n)
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

export function buildPivot(block: PivotTableBlock): PivotResult {
  const rowDims = block.rows
  const colDims = block.cols
  const measures = block.values
  const rows: RawRow[] = block.source?.rows ?? []

  // First pass: collect header tuples in first-seen order and bucket the rows.
  const rowOrder: string[] = []
  const rowSeen = new Set<string>()
  const rowTuples = new Map<string, string[]>()
  const colOrder: string[] = []
  const colSeen = new Set<string>()
  const colTuples = new Map<string, string[]>()

  // Buckets keyed by `${rowKey}${SEP}${colKey}` → raw rows.
  const buckets = new Map<string, RawRow[]>()

  // Sentinel col key used when `cols=[]` — single "virtual" col bucket.
  const NO_COL = ''

  for (const r of rows) {
    const rowTuple = rowDims.map((f) => dimValue(r, f))
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
      const colTuple = colDims.map((f) => dimValue(r, f))
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
  }

  // Second pass: materialise values[i][j][k].
  const rowHeaders = rowOrder.map((k) => rowTuples.get(k) as string[])
  const colHeaders = colOrder.map((k) => colTuples.get(k) as string[])

  const values: (number | null)[][][] = []
  for (const rKey of rowOrder) {
    const rowOut: (number | null)[][] = []
    for (const cKey of colOrder) {
      const bucket = buckets.get(rKey + SEP + cKey)
      const cell: (number | null)[] = []
      if (!bucket) {
        for (let k = 0; k < measures.length; k++) cell.push(null)
      } else {
        for (const m of measures) cell.push(aggregate(bucket, m.field, m.agg))
      }
      rowOut.push(cell)
    }
    values.push(rowOut)
  }

  return { rowHeaders, colHeaders, values, rowDims, colDims, measures }
}
