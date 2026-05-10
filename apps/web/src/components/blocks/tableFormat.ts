import type { TableBlock } from '@/types/document'

/**
 * Resolved column metadata used by the renderer/editor. The schema's
 * column entry is loose (everything optional) — we normalize once so
 * downstream code can read align/dtype/width/format with confidence.
 */
export type ColumnSpec = {
  width?: string
  align?: 'left' | 'center' | 'right'
  dtype?: 'text' | 'number' | 'percent' | 'currency' | 'date'
  format?: string
}

export function resolveColumn(
  raw: NonNullable<TableBlock['columns']>[number] | undefined,
): ColumnSpec {
  if (!raw) return {}
  return {
    width: raw.width,
    align: raw.align,
    dtype: raw.dtype,
    format: raw.format,
  }
}

/**
 * Resolve the alignment we'll actually apply to a cell. Order: per-cell
 * override → column default → numeric-aware default (right-align for
 * number/percent/currency) → 'left'.
 */
export function effectiveAlign(
  col: ColumnSpec | undefined,
  cellAlign: 'left' | 'center' | 'right' | undefined,
): 'left' | 'center' | 'right' {
  if (cellAlign) return cellAlign
  if (col?.align) return col.align
  if (col?.dtype === 'number' || col?.dtype === 'percent' || col?.dtype === 'currency') {
    return 'right'
  }
  return 'left'
}

export function alignClass(
  align: 'left' | 'center' | 'right',
): string {
  if (align === 'center') return 'text-center'
  if (align === 'right') return 'text-right'
  return 'text-left'
}

export function densityCellClass(
  density: 'compact' | 'normal' | 'comfortable',
): string {
  if (density === 'compact') return 'px-2 py-1'
  if (density === 'comfortable') return 'px-4 py-3'
  return 'px-3 py-2'
}

export function borderClass(
  border: 'none' | 'horizontal' | 'all',
): string {
  if (border === 'none') return ''
  if (border === 'all') return 'border border-gray-200'
  return 'border-b border-gray-100'
}

/**
 * Parse a cell string to a number for sorting / aggregating.
 * Tolerates: thousand separators (`1,234`), trailing `%` (`12.5%`),
 * leading currency symbols (`$`, `₩`, `€`, `¥`, `£`, ISO code prefix
 * like `KRW 1,000`), and `(123)` accountant negatives. Returns null when
 * the value is empty or unparseable so callers can sink-sort blanks.
 */
export function parseNumericForAggregate(value: string): number | null {
  if (!value) return null
  let s = value.trim()
  if (!s) return null
  let negative = false
  if (s.startsWith('(') && s.endsWith(')')) {
    negative = true
    s = s.slice(1, -1)
  }
  // Strip a known currency prefix or symbol.
  s = s.replace(/^(KRW|USD|EUR|JPY|GBP|CNY|HKD|SGD|AUD|CAD|CHF|INR)\s*/i, '')
  s = s.replace(/^[₩$€¥£]\s*/, '')
  s = s.replace(/[₩$€¥£]/g, '')
  const isPercent = s.endsWith('%')
  if (isPercent) s = s.slice(0, -1)
  s = s.replace(/,/g, '').trim()
  if (!s || s === '-') return null
  const n = Number(s)
  if (!Number.isFinite(n)) return null
  return (negative ? -n : n) * (isPercent ? 1 : 1)
}

const KNOWN_CURRENCY_SYMBOLS: Record<string, string> = {
  KRW: '₩',
  USD: '$',
  EUR: '€',
  JPY: '¥',
  GBP: '£',
  CNY: '¥',
  HKD: 'HK$',
  SGD: 'S$',
}

/**
 * Format a raw cell string per the column dtype + format hint.
 *   - text:   passthrough
 *   - number: thousands separator + N decimal places (format = "0".."6")
 *   - percent: same as number, append '%'
 *   - currency: same as number, prefix configured symbol/ISO
 *   - date:   passthrough today (YYYY-MM-DD reformatting requires a date
 *             library — out of scope for v1; falls back to the raw text)
 *
 * If the value is not parseable as a number for numeric dtypes the raw
 * text is returned so user-entered annotations like "—" or "N/A" survive.
 */
export function formatCellByDtype(
  raw: string,
  col: ColumnSpec | undefined,
): string {
  if (!col || !col.dtype || col.dtype === 'text') return raw
  if (col.dtype === 'date') return raw
  const n = parseNumericForAggregate(raw)
  if (n == null) return raw
  const decimals = parseDecimals(col.format)
  if (col.dtype === 'percent') {
    return formatNumber(n, decimals) + '%'
  }
  if (col.dtype === 'currency') {
    const sym = currencySymbol(col.format)
    return `${sym}${formatNumber(n, decimals)}`
  }
  return formatNumber(n, decimals)
}

function parseDecimals(format: string | undefined): number {
  if (!format) return 0
  // accept '2', '0.00', '#,##0.00' — count digits after the dot.
  const m = format.match(/\.(\d+)/)
  if (m && m[1]) return Math.min(6, m[1].length)
  if (/^\d+$/.test(format)) return Math.min(6, Number(format))
  return 0
}

function currencySymbol(format: string | undefined): string {
  if (!format) return ''
  const u = format.toUpperCase()
  if (KNOWN_CURRENCY_SYMBOLS[u]) return KNOWN_CURRENCY_SYMBOLS[u]
  // user passed a literal symbol or unknown ISO — append a space so the
  // result reads naturally either way.
  return format.endsWith(' ') ? format : `${format} `
}

function formatNumber(n: number, decimals: number): string {
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

/**
 * Aggregate a column's cells using the requested kind. Returns formatted
 * string ready for display (so the footer cell shows '1,234.56' not 1234.56).
 * 'count' returns the number of non-empty cells regardless of dtype.
 * For sum/avg/min/max we drop unparseable cells.
 */
export function rowAggregate(
  cells: string[],
  kind: 'sum' | 'avg' | 'count' | 'min' | 'max' | '',
  col: ColumnSpec | undefined,
): string {
  if (!kind) return ''
  if (kind === 'count') {
    return String(cells.filter((c) => c.trim() !== '').length)
  }
  const nums: number[] = []
  for (const c of cells) {
    const n = parseNumericForAggregate(c)
    if (n != null) nums.push(n)
  }
  if (nums.length === 0) return ''
  let value: number
  if (kind === 'sum') value = nums.reduce((a, b) => a + b, 0)
  else if (kind === 'avg') value = nums.reduce((a, b) => a + b, 0) / nums.length
  else if (kind === 'min') value = Math.min(...nums)
  else value = Math.max(...nums)
  return formatCellByDtype(String(value), col ?? { dtype: 'number' })
}
