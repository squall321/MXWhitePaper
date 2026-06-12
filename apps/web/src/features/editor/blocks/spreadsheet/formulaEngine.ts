/**
 * Pure formula engine for the spreadsheet block.
 *
 * Supports a small Excel-like subset:
 *   - operators: + - * / % and parentheses
 *   - cell refs:  A1, B12 (uppercase, A..Z only — cap at 26 cols)
 *   - ranges:     A1:B3 (used inside SUM/AVG/MIN/MAX/COUNT)
 *   - functions:  SUM, AVG (alias AVERAGE), MIN, MAX, COUNT,
 *                 IF(cond, a, b), ROUND(n, digits?), CONCAT(...)
 *
 * Errors are surfaced as `{error: '#REF!' | '#CYCLE!' | '#DIV/0!' | '#ERR!' | '#VALUE!'}`.
 *
 * No dependencies — recursive-descent parser. Designed to be tree-shakable
 * and unit-testable in isolation.
 */

export interface CellResult {
  value: number | string
  error?: string
}

const MAX_DEPTH = 50
const MAX_COLS = 26

export const FN_NAMES = new Set([
  'SUM',
  'AVG',
  'AVERAGE',
  'MIN',
  'MAX',
  'COUNT',
  'IF',
  'ROUND',
  'CONCAT',
  // Batch A — descriptive stats (STATS-01)
  'MEDIAN',
  'MODE',
  'STDEV',
  'STDEVP',
  'VAR',
  'VARP',
  'QUARTILE',
  'PERCENTILE',
  'LARGE',
  'SMALL',
  'PERCENTRANK',
  'RANK',
  // Batch B — correlation / regression (STATS-04)
  'CORREL',
  'PEARSON',
  'RSQ',
  'SLOPE',
  'INTERCEPT',
  'STEYX',
  // Batch C — lookup (STATS-12)
  'VLOOKUP',
  'HLOOKUP',
  'INDEX',
  'MATCH',
  'XLOOKUP',
  'XMATCH',
  'CHOOSE',
])

/**
 * Dotted Excel aliases (e.g. `STDEV.S`) — the tokenizer does not accept `.`
 * inside identifiers, so we rewrite the source text before tokenizing. Map
 * each alias to its primary FN_NAMES entry.
 */
export const DOTTED_ALIASES: ReadonlyArray<[string, string]> = [
  ['STDEV.S', 'STDEV'],
  ['STDEV.P', 'STDEVP'],
  ['VAR.S', 'VAR'],
  ['VAR.P', 'VARP'],
  ['MODE.SNGL', 'MODE'],
  ['QUARTILE.INC', 'QUARTILE'],
  ['PERCENTILE.INC', 'PERCENTILE'],
  ['PERCENTRANK.INC', 'PERCENTRANK'],
  ['RANK.EQ', 'RANK'],
]

function preprocessAliases(src: string): string {
  let out = src
  for (const [alias, target] of DOTTED_ALIASES) {
    // Word-boundary-ish: only replace when followed by '(' to avoid mangling
    // bare identifiers. Case-insensitive.
    const re = new RegExp(
      alias.replace(/\./g, '\\.') + '(?=\\s*\\()',
      'gi',
    )
    out = out.replace(re, target)
  }
  return out
}

/** Convert e.g. 'A1' → {col: 0, row: 0}. Returns null if unparseable / col > Z. */
export function parseRef(ref: string): { col: number; row: number } | null {
  if (typeof ref !== 'string') return null
  const m = /^([A-Z]+)(\d+)$/.exec(ref.trim())
  if (!m) return null
  // Regex with two capturing groups always yields strings when the
  // overall match succeeds; assert to satisfy noUncheckedIndexedAccess.
  const colStr = m[1] as string
  const rowStr = m[2] as string
  if (colStr.length > 1) return null // cap at single letter A..Z (26 cols)
  const col = colStr.charCodeAt(0) - 65
  if (col < 0 || col >= MAX_COLS) return null
  const row = parseInt(rowStr, 10) - 1
  if (!Number.isFinite(row) || row < 0) return null
  return { col, row }
}

/** Build the cell label from zero-based indices: (0,0) → 'A1'. */
export function refOf(col: number, row: number): string {
  return String.fromCharCode(65 + col) + String(row + 1)
}

/**
 * Expand a range like 'A1:B3' into a flat list of cell refs in row-major
 * order. Returns null if either endpoint is not a valid ref.
 */
export function expandRange(start: string, end: string): string[] | null {
  const a = parseRef(start)
  const b = parseRef(end)
  if (!a || !b) return null
  const minCol = Math.min(a.col, b.col)
  const maxCol = Math.max(a.col, b.col)
  const minRow = Math.min(a.row, b.row)
  const maxRow = Math.max(a.row, b.row)
  const refs: string[] = []
  for (let r = minRow; r <= maxRow; r++) {
    for (let c = minCol; c <= maxCol; c++) {
      refs.push(refOf(c, r))
    }
  }
  return refs
}

// ---------------------------------------------------------------------------
// Tokeniser
// ---------------------------------------------------------------------------

type TokenKind =
  | 'num'
  | 'str'
  | 'ident'
  | 'op'
  | 'lp'
  | 'rp'
  | 'comma'
  | 'colon'
  | 'eof'

interface Token {
  kind: TokenKind
  value: string
}

function tokenize(input: string): Token[] {
  const out: Token[] = []
  let i = 0
  while (i < input.length) {
    // `i < input.length` guards every indexed read; assert non-null to
    // satisfy noUncheckedIndexedAccess.
    const ch = input[i] as string
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++
      continue
    }
    if (ch === '"') {
      // Quoted string for CONCAT etc. Supports backslash escapes minimally.
      let j = i + 1
      let s = ''
      while (j < input.length && input[j] !== '"') {
        if (input[j] === '\\' && j + 1 < input.length) {
          s += input[j + 1] as string
          j += 2
          continue
        }
        s += input[j++] as string
      }
      if (j >= input.length) throw new Error('#ERR!')
      out.push({ kind: 'str', value: s })
      i = j + 1
      continue
    }
    if (ch >= '0' && ch <= '9') {
      let j = i
      while (j < input.length && /[0-9.]/.test(input[j] as string)) j++
      out.push({ kind: 'num', value: input.slice(i, j) })
      i = j
      continue
    }
    if ((ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') || ch === '_') {
      let j = i
      while (j < input.length && /[A-Za-z0-9_]/.test(input[j] as string)) j++
      out.push({ kind: 'ident', value: input.slice(i, j).toUpperCase() })
      i = j
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
    if (ch === ',') {
      out.push({ kind: 'comma', value: ch })
      i++
      continue
    }
    if (ch === ':') {
      out.push({ kind: 'colon', value: ch })
      i++
      continue
    }
    if ('+-*/%'.includes(ch)) {
      out.push({ kind: 'op', value: ch })
      i++
      continue
    }
    throw new Error('#ERR!')
  }
  out.push({ kind: 'eof', value: '' })
  return out
}

// ---------------------------------------------------------------------------
// Parser + evaluator (combined for simplicity)
// ---------------------------------------------------------------------------

/** Node kinds in the parse tree. Kept small & flat. */
type ASTNode =
  | { type: 'num'; value: number }
  | { type: 'str'; value: string }
  | { type: 'ref'; ref: string }
  | { type: 'range'; start: string; end: string }
  | { type: 'fn'; name: string; args: ASTNode[] }
  | { type: 'unary'; op: '+' | '-'; arg: ASTNode }
  | { type: 'bin'; op: '+' | '-' | '*' | '/' | '%'; left: ASTNode; right: ASTNode }

class Parser {
  private pos = 0
  constructor(private readonly tokens: Token[]) {}

  private peek(): Token {
    // tokenize() always pushes an EOF sentinel, so `this.pos` never
    // outruns the array. assert non-null for noUncheckedIndexedAccess.
    return this.tokens[this.pos] as Token
  }

  private eat(): Token {
    return this.tokens[this.pos++] as Token
  }

  parse(): ASTNode {
    const expr = this.parseExpr()
    if (this.peek().kind !== 'eof') throw new Error('#ERR!')
    return expr
  }

  // expr := term (('+' | '-') term)*
  private parseExpr(): ASTNode {
    let left = this.parseTerm()
    while (this.peek().kind === 'op' && (this.peek().value === '+' || this.peek().value === '-')) {
      const op = this.eat().value as '+' | '-'
      const right = this.parseTerm()
      left = { type: 'bin', op, left, right }
    }
    return left
  }

  // term := factor (('*' | '/' | '%') factor)*
  private parseTerm(): ASTNode {
    let left = this.parseFactor()
    while (
      this.peek().kind === 'op' &&
      (this.peek().value === '*' || this.peek().value === '/' || this.peek().value === '%')
    ) {
      const op = this.eat().value as '*' | '/' | '%'
      const right = this.parseFactor()
      left = { type: 'bin', op, left, right }
    }
    return left
  }

  // factor := ('+' | '-') factor | primary
  private parseFactor(): ASTNode {
    if (this.peek().kind === 'op' && (this.peek().value === '+' || this.peek().value === '-')) {
      const op = this.eat().value as '+' | '-'
      const arg = this.parseFactor()
      return { type: 'unary', op, arg }
    }
    return this.parsePrimary()
  }

  // primary := number | string | ident( '(' args ')' | (':' ident)? ) | '(' expr ')'
  private parsePrimary(): ASTNode {
    const t = this.peek()
    if (t.kind === 'num') {
      this.eat()
      const n = parseFloat(t.value)
      if (!Number.isFinite(n)) throw new Error('#ERR!')
      return { type: 'num', value: n }
    }
    if (t.kind === 'str') {
      this.eat()
      return { type: 'str', value: t.value }
    }
    if (t.kind === 'lp') {
      this.eat()
      const inner = this.parseExpr()
      if (this.peek().kind !== 'rp') throw new Error('#ERR!')
      this.eat()
      return inner
    }
    if (t.kind === 'ident') {
      this.eat()
      const name = t.value
      // Function call?
      if (this.peek().kind === 'lp') {
        this.eat() // (
        const args: ASTNode[] = []
        if (this.peek().kind !== 'rp') {
          args.push(this.parseExpr())
          while (this.peek().kind === 'comma') {
            this.eat()
            args.push(this.parseExpr())
          }
        }
        if (this.peek().kind !== 'rp') throw new Error('#ERR!')
        this.eat() // )
        if (!FN_NAMES.has(name)) throw new Error('#ERR!')
        return { type: 'fn', name, args }
      }
      // Bare ident — must look like a cell ref or be the start of a range.
      if (!parseRef(name)) throw new Error('#REF!')
      // Range like A1:B3?
      if (this.peek().kind === 'colon') {
        this.eat()
        const next = this.peek()
        if (next.kind !== 'ident') throw new Error('#ERR!')
        this.eat()
        if (!parseRef(next.value)) throw new Error('#REF!')
        return { type: 'range', start: name, end: next.value }
      }
      return { type: 'ref', ref: name }
    }
    throw new Error('#ERR!')
  }
}

interface EvalCtx {
  cells: Record<string, string>
  depth: number
}

/** Coerce an evaluator output to a number; '' / null → 0; anything else → NaN. */
function toNumber(v: number | string | undefined): number {
  if (typeof v === 'number') return v
  if (v == null) return 0
  if (typeof v === 'string') {
    const t = v.trim()
    if (t === '') return 0
    const n = Number(t)
    if (Number.isFinite(n)) return n
    return NaN
  }
  return NaN
}

function evalNode(node: ASTNode, ctx: EvalCtx): number | string {
  switch (node.type) {
    case 'num':
      return node.value
    case 'str':
      return node.value
    case 'ref': {
      const r = evaluateCell(ctx.cells[node.ref] ?? '', ctx.cells, ctx.depth + 1)
      if (r.error) throw new Error(r.error)
      return r.value
    }
    case 'range':
      // Ranges only make sense as function args; bare range outside a function
      // is treated as #VALUE! per Excel.
      throw new Error('#VALUE!')
    case 'unary': {
      const v = evalNode(node.arg, ctx)
      const n = toNumber(v)
      if (!Number.isFinite(n)) throw new Error('#VALUE!')
      return node.op === '-' ? -n : n
    }
    case 'bin': {
      const l = toNumber(evalNode(node.left, ctx))
      const r = toNumber(evalNode(node.right, ctx))
      if (!Number.isFinite(l) || !Number.isFinite(r)) throw new Error('#VALUE!')
      switch (node.op) {
        case '+':
          return l + r
        case '-':
          return l - r
        case '*':
          return l * r
        case '/':
          if (r === 0) throw new Error('#DIV/0!')
          return l / r
        case '%':
          if (r === 0) throw new Error('#DIV/0!')
          return l % r
      }
      return 0
    }
    case 'fn':
      return evalFn(node, ctx)
  }
}

function flattenArgValues(args: ASTNode[], ctx: EvalCtx): (number | string)[] {
  // Expand ranges into the corresponding cell refs; bare refs / numbers /
  // strings are evaluated normally. Used by SUM/AVG/MIN/MAX/COUNT/CONCAT.
  const out: (number | string)[] = []
  for (const a of args) {
    if (a.type === 'range') {
      const refs = expandRange(a.start, a.end)
      if (!refs) throw new Error('#REF!')
      for (const ref of refs) {
        const r = evaluateCell(ctx.cells[ref] ?? '', ctx.cells, ctx.depth + 1)
        if (r.error) throw new Error(r.error)
        out.push(r.value)
      }
    } else {
      out.push(evalNode(a, ctx))
    }
  }
  return out
}

/**
 * Numeric-only flattener for statistical functions. Empty cells / blank
 * strings are skipped (Excel-compatible — STDEV etc. ignore blanks but error
 * on non-numeric text).
 */
function flattenNumerics(args: ASTNode[], ctx: EvalCtx): number[] {
  const vals = flattenArgValues(args, ctx)
  const out: number[] = []
  for (const v of vals) {
    if (v === '' || v == null) continue
    const n = toNumber(v)
    if (!Number.isFinite(n)) throw new Error('#VALUE!')
    out.push(n)
  }
  return out
}

/**
 * Expand a single AST arg expected to be a range/ref into a 2D matrix of
 * raw cell values (row-major). Single ref → 1x1 matrix; literal num/str →
 * 1x1 matrix wrapping that value.
 */
function expand2D(arg: ASTNode, ctx: EvalCtx): (number | string)[][] {
  if (arg.type === 'range') {
    const a = parseRef(arg.start)
    const b = parseRef(arg.end)
    if (!a || !b) throw new Error('#REF!')
    const minCol = Math.min(a.col, b.col)
    const maxCol = Math.max(a.col, b.col)
    const minRow = Math.min(a.row, b.row)
    const maxRow = Math.max(a.row, b.row)
    const mat: (number | string)[][] = []
    for (let r = minRow; r <= maxRow; r++) {
      const row: (number | string)[] = []
      for (let c = minCol; c <= maxCol; c++) {
        const ref = refOf(c, r)
        const cell = evaluateCell(ctx.cells[ref] ?? '', ctx.cells, ctx.depth + 1)
        if (cell.error) throw new Error(cell.error)
        row.push(cell.value)
      }
      mat.push(row)
    }
    return mat
  }
  return [[evalNode(arg, ctx)]]
}

/** Flatten a 2D matrix to a 1D row-major list of raw values. */
function matToList(mat: (number | string)[][]): (number | string)[] {
  const out: (number | string)[] = []
  for (const row of mat) for (const v of row) out.push(v)
  return out
}

/** Loose equality used by lookups — number↔string coerced, case-insensitive. */
function eqLoose(a: number | string, b: number | string): boolean {
  if (typeof a === 'number' && typeof b === 'number') return a === b
  const as = String(a).trim().toLowerCase()
  const bs = String(b).trim().toLowerCase()
  return as === bs
}

/**
 * Linear regression helper. Returns slope, intercept, r (Pearson), and
 * residual standard error. xs/ys must be same length and ≥ 2 finite points.
 * Throws on insufficient data or zero variance in x.
 */
function linearFit(
  xs: number[],
  ys: number[],
): { slope: number; intercept: number; r: number; sxx: number; syy: number; sxy: number; n: number } {
  if (xs.length !== ys.length) throw new Error('#N/A')
  const n = xs.length
  if (n < 2) throw new Error('#DIV/0!')
  let mx = 0
  let my = 0
  for (let i = 0; i < n; i++) {
    mx += xs[i] as number
    my += ys[i] as number
  }
  mx /= n
  my /= n
  let sxx = 0
  let syy = 0
  let sxy = 0
  for (let i = 0; i < n; i++) {
    const dx = (xs[i] as number) - mx
    const dy = (ys[i] as number) - my
    sxx += dx * dx
    syy += dy * dy
    sxy += dx * dy
  }
  if (sxx === 0) throw new Error('#DIV/0!')
  const slope = sxy / sxx
  const intercept = my - slope * mx
  const denom = Math.sqrt(sxx * syy)
  const r = denom === 0 ? 0 : sxy / denom
  return { slope, intercept, r, sxx, syy, sxy, n }
}

/** Collect aligned (x, y) numeric pairs from two range args; skip blanks. */
function pairNumerics(
  argX: ASTNode,
  argY: ASTNode,
  ctx: EvalCtx,
): { xs: number[]; ys: number[] } {
  const xList = matToList(expand2D(argX, ctx))
  const yList = matToList(expand2D(argY, ctx))
  if (xList.length !== yList.length) throw new Error('#N/A')
  const xs: number[] = []
  const ys: number[] = []
  for (let i = 0; i < xList.length; i++) {
    const xv = xList[i] as number | string
    const yv = yList[i] as number | string
    if (xv === '' || xv == null || yv === '' || yv == null) continue
    const x = toNumber(xv)
    const y = toNumber(yv)
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('#VALUE!')
    xs.push(x)
    ys.push(y)
  }
  return { xs, ys }
}

function evalFn(node: { name: string; args: ASTNode[] }, ctx: EvalCtx): number | string {
  const name = node.name
  if (name === 'SUM') {
    const vals = flattenArgValues(node.args, ctx)
    let s = 0
    for (const v of vals) {
      if (v === '' || v == null) continue
      const n = toNumber(v)
      if (!Number.isFinite(n)) throw new Error('#VALUE!')
      s += n
    }
    return s
  }
  if (name === 'AVG' || name === 'AVERAGE') {
    const vals = flattenArgValues(node.args, ctx)
    let s = 0
    let count = 0
    for (const v of vals) {
      if (v === '' || v == null) continue
      const n = toNumber(v)
      if (!Number.isFinite(n)) throw new Error('#VALUE!')
      s += n
      count++
    }
    if (count === 0) throw new Error('#DIV/0!')
    return s / count
  }
  if (name === 'MIN' || name === 'MAX') {
    const vals = flattenArgValues(node.args, ctx)
    const nums: number[] = []
    for (const v of vals) {
      if (v === '' || v == null) continue
      const n = toNumber(v)
      if (!Number.isFinite(n)) throw new Error('#VALUE!')
      nums.push(n)
    }
    if (nums.length === 0) throw new Error('#VALUE!')
    return name === 'MIN' ? Math.min(...nums) : Math.max(...nums)
  }
  if (name === 'COUNT') {
    const vals = flattenArgValues(node.args, ctx)
    let c = 0
    for (const v of vals) {
      if (v === '' || v == null) continue
      const n = toNumber(v)
      if (Number.isFinite(n)) c++
    }
    return c
  }
  if (name === 'IF') {
    if (node.args.length < 2 || node.args.length > 3) throw new Error('#ERR!')
    const cond = evalNode(node.args[0] as ASTNode, ctx)
    const truthy =
      typeof cond === 'number'
        ? cond !== 0 && Number.isFinite(cond)
        : typeof cond === 'string'
          ? cond.trim() !== '' && cond.trim().toLowerCase() !== 'false'
          : false
    if (truthy) return evalNode(node.args[1] as ASTNode, ctx)
    if (node.args[2]) return evalNode(node.args[2] as ASTNode, ctx)
    return ''
  }
  if (name === 'ROUND') {
    if (node.args.length < 1 || node.args.length > 2) throw new Error('#ERR!')
    const n = toNumber(evalNode(node.args[0] as ASTNode, ctx))
    const d = node.args[1] ? toNumber(evalNode(node.args[1] as ASTNode, ctx)) : 0
    if (!Number.isFinite(n) || !Number.isFinite(d)) throw new Error('#VALUE!')
    const f = Math.pow(10, Math.trunc(d))
    return Math.round(n * f) / f
  }
  if (name === 'CONCAT') {
    const vals = flattenArgValues(node.args, ctx)
    return vals.map((v) => (v == null ? '' : String(v))).join('')
  }

  // -------------------------------------------------------------------------
  // Batch A — descriptive statistics
  // -------------------------------------------------------------------------

  if (name === 'MEDIAN') {
    const nums = flattenNumerics(node.args, ctx)
    if (nums.length === 0) throw new Error('#NUM!')
    const sorted = [...nums].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    return sorted.length % 2
      ? (sorted[mid] as number)
      : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
  }
  if (name === 'MODE') {
    const nums = flattenNumerics(node.args, ctx)
    if (nums.length === 0) throw new Error('#N/A')
    const counts = new Map<number, number>()
    let best = -Infinity
    let bestVal: number | null = null
    let firstIndexOfBest = Infinity
    for (let i = 0; i < nums.length; i++) {
      const v = nums[i] as number
      const c = (counts.get(v) ?? 0) + 1
      counts.set(v, c)
      if (c > best || (c === best && i < firstIndexOfBest)) {
        best = c
        bestVal = v
        firstIndexOfBest = i
      }
    }
    // Excel: MODE returns #N/A if no value repeats.
    if (best < 2 || bestVal === null) throw new Error('#N/A')
    return bestVal
  }
  if (name === 'STDEV' || name === 'STDEVP' || name === 'VAR' || name === 'VARP') {
    const nums = flattenNumerics(node.args, ctx)
    const isSample = name === 'STDEV' || name === 'VAR'
    const minN = isSample ? 2 : 1
    if (nums.length < minN) throw new Error('#DIV/0!')
    let mean = 0
    for (const n of nums) mean += n
    mean /= nums.length
    let sq = 0
    for (const n of nums) {
      const d = n - mean
      sq += d * d
    }
    const variance = sq / (isSample ? nums.length - 1 : nums.length)
    return name === 'VAR' || name === 'VARP' ? variance : Math.sqrt(variance)
  }
  if (name === 'QUARTILE' || name === 'PERCENTILE') {
    if (node.args.length !== 2) throw new Error('#ERR!')
    const nums = flattenNumerics([node.args[0] as ASTNode], ctx)
    const arg2 = toNumber(evalNode(node.args[1] as ASTNode, ctx))
    if (!Number.isFinite(arg2)) throw new Error('#VALUE!')
    if (nums.length === 0) throw new Error('#NUM!')
    const p = name === 'QUARTILE' ? arg2 / 4 : arg2
    if (p < 0 || p > 1) throw new Error('#NUM!')
    if (name === 'QUARTILE' && (arg2 < 0 || arg2 > 4 || Math.trunc(arg2) !== arg2)) {
      throw new Error('#NUM!')
    }
    const sorted = [...nums].sort((a, b) => a - b)
    // Excel PERCENTILE.INC — linear interpolation between order stats.
    const pos = p * (sorted.length - 1)
    const lo = Math.floor(pos)
    const hi = Math.ceil(pos)
    if (lo === hi) return sorted[lo] as number
    const frac = pos - lo
    return (sorted[lo] as number) * (1 - frac) + (sorted[hi] as number) * frac
  }
  if (name === 'LARGE' || name === 'SMALL') {
    if (node.args.length !== 2) throw new Error('#ERR!')
    const nums = flattenNumerics([node.args[0] as ASTNode], ctx)
    const kRaw = toNumber(evalNode(node.args[1] as ASTNode, ctx))
    if (!Number.isFinite(kRaw)) throw new Error('#VALUE!')
    const k = Math.trunc(kRaw)
    if (nums.length === 0 || k < 1 || k > nums.length) throw new Error('#NUM!')
    const sorted = [...nums].sort((a, b) => (name === 'LARGE' ? b - a : a - b))
    return sorted[k - 1] as number
  }
  if (name === 'PERCENTRANK') {
    if (node.args.length < 2 || node.args.length > 3) throw new Error('#ERR!')
    const nums = flattenNumerics([node.args[0] as ASTNode], ctx)
    const x = toNumber(evalNode(node.args[1] as ASTNode, ctx))
    if (!Number.isFinite(x)) throw new Error('#VALUE!')
    if (nums.length === 0) throw new Error('#NUM!')
    const sorted = [...nums].sort((a, b) => a - b)
    if (x < (sorted[0] as number) || x > (sorted[sorted.length - 1] as number)) {
      throw new Error('#N/A')
    }
    // Find bracketing positions for x.
    let lo = -1
    for (let i = 0; i < sorted.length; i++) {
      if ((sorted[i] as number) === x) {
        return i / (sorted.length - 1 || 1)
      }
      if ((sorted[i] as number) < x) lo = i
      else break
    }
    if (lo < 0 || lo >= sorted.length - 1) throw new Error('#N/A')
    const a = sorted[lo] as number
    const b = sorted[lo + 1] as number
    const frac = (x - a) / (b - a)
    return (lo + frac) / (sorted.length - 1)
  }
  if (name === 'RANK') {
    if (node.args.length < 2 || node.args.length > 3) throw new Error('#ERR!')
    const x = toNumber(evalNode(node.args[0] as ASTNode, ctx))
    if (!Number.isFinite(x)) throw new Error('#VALUE!')
    const nums = flattenNumerics([node.args[1] as ASTNode], ctx)
    const order = node.args[2]
      ? toNumber(evalNode(node.args[2] as ASTNode, ctx))
      : 0
    if (!Number.isFinite(order)) throw new Error('#VALUE!')
    if (!nums.some((n) => n === x)) throw new Error('#N/A')
    const sorted = [...nums].sort((a, b) => (order === 0 ? b - a : a - b))
    return sorted.indexOf(x) + 1
  }

  // -------------------------------------------------------------------------
  // Batch B — correlation / regression
  // -------------------------------------------------------------------------

  if (name === 'CORREL' || name === 'PEARSON') {
    if (node.args.length !== 2) throw new Error('#ERR!')
    const { xs, ys } = pairNumerics(
      node.args[0] as ASTNode,
      node.args[1] as ASTNode,
      ctx,
    )
    if (xs.length < 2) throw new Error('#DIV/0!')
    return linearFit(xs, ys).r
  }
  if (name === 'RSQ') {
    if (node.args.length !== 2) throw new Error('#ERR!')
    // Excel: RSQ(known_y, known_x). Same calculation either way.
    const { xs, ys } = pairNumerics(
      node.args[1] as ASTNode,
      node.args[0] as ASTNode,
      ctx,
    )
    if (xs.length < 2) throw new Error('#DIV/0!')
    const r = linearFit(xs, ys).r
    return r * r
  }
  if (name === 'SLOPE' || name === 'INTERCEPT') {
    if (node.args.length !== 2) throw new Error('#ERR!')
    // Args order: (known_y, known_x).
    const { xs, ys } = pairNumerics(
      node.args[1] as ASTNode,
      node.args[0] as ASTNode,
      ctx,
    )
    if (xs.length < 2) throw new Error('#DIV/0!')
    const fit = linearFit(xs, ys)
    return name === 'SLOPE' ? fit.slope : fit.intercept
  }
  if (name === 'STEYX') {
    if (node.args.length !== 2) throw new Error('#ERR!')
    const { xs, ys } = pairNumerics(
      node.args[1] as ASTNode,
      node.args[0] as ASTNode,
      ctx,
    )
    if (xs.length < 3) throw new Error('#DIV/0!')
    const fit = linearFit(xs, ys)
    // STEYX = sqrt( (syy - slope*sxy) / (n - 2) )
    const num = fit.syy - fit.slope * fit.sxy
    return Math.sqrt(Math.max(0, num) / (fit.n - 2))
  }

  // -------------------------------------------------------------------------
  // Batch C — lookup
  // -------------------------------------------------------------------------

  if (name === 'VLOOKUP' || name === 'HLOOKUP') {
    if (node.args.length < 3 || node.args.length > 4) throw new Error('#ERR!')
    const lookup = evalNode(node.args[0] as ASTNode, ctx)
    const table = expand2D(node.args[1] as ASTNode, ctx)
    const idxRaw = toNumber(evalNode(node.args[2] as ASTNode, ctx))
    if (!Number.isFinite(idxRaw)) throw new Error('#VALUE!')
    const idx = Math.trunc(idxRaw)
    // 4th arg: FALSE/0 → exact; TRUE/1/omitted → approximate.
    let exact = false
    if (node.args[3]) {
      const v = evalNode(node.args[3] as ASTNode, ctx)
      const n =
        typeof v === 'number' ? v : v === '' ? 0 : toNumber(v)
      exact = n === 0
    }
    if (table.length === 0) throw new Error('#N/A')
    if (name === 'VLOOKUP') {
      const rows = table.length
      const cols = (table[0] as (number | string)[]).length
      if (idx < 1 || idx > cols) throw new Error('#REF!')
      if (exact) {
        for (let r = 0; r < rows; r++) {
          const row = table[r] as (number | string)[]
          if (eqLoose(row[0] as number | string, lookup)) {
            return row[idx - 1] as number | string
          }
        }
        throw new Error('#N/A')
      }
      // Approximate: assume first column sorted ascending; find largest ≤ lookup.
      let found = -1
      for (let r = 0; r < rows; r++) {
        const row = table[r] as (number | string)[]
        const k = row[0] as number | string
        const lookupN = toNumber(lookup)
        const kN = toNumber(k)
        if (Number.isFinite(lookupN) && Number.isFinite(kN)) {
          if (kN <= lookupN) found = r
          else break
        }
      }
      if (found < 0) throw new Error('#N/A')
      return (table[found] as (number | string)[])[idx - 1] as number | string
    }
    // HLOOKUP
    const cols = (table[0] as (number | string)[]).length
    if (idx < 1 || idx > table.length) throw new Error('#REF!')
    const headerRow = table[0] as (number | string)[]
    if (exact) {
      for (let c = 0; c < cols; c++) {
        if (eqLoose(headerRow[c] as number | string, lookup)) {
          return (table[idx - 1] as (number | string)[])[c] as number | string
        }
      }
      throw new Error('#N/A')
    }
    let found = -1
    for (let c = 0; c < cols; c++) {
      const k = headerRow[c] as number | string
      const lookupN = toNumber(lookup)
      const kN = toNumber(k)
      if (Number.isFinite(lookupN) && Number.isFinite(kN)) {
        if (kN <= lookupN) found = c
        else break
      }
    }
    if (found < 0) throw new Error('#N/A')
    return (table[idx - 1] as (number | string)[])[found] as number | string
  }
  if (name === 'INDEX') {
    if (node.args.length < 2 || node.args.length > 3) throw new Error('#ERR!')
    const arr = expand2D(node.args[0] as ASTNode, ctx)
    const rRaw = toNumber(evalNode(node.args[1] as ASTNode, ctx))
    if (!Number.isFinite(rRaw)) throw new Error('#VALUE!')
    const r = Math.trunc(rRaw)
    const rows = arr.length
    const cols = (arr[0] as (number | string)[] | undefined)?.length ?? 0
    // 1D vector handling: if single row or single col and only one numeric idx,
    // treat as index into the vector.
    if (node.args.length === 2) {
      if (rows === 1) {
        if (r < 1 || r > cols) throw new Error('#REF!')
        return (arr[0] as (number | string)[])[r - 1] as number | string
      }
      if (cols === 1) {
        if (r < 1 || r > rows) throw new Error('#REF!')
        return (arr[r - 1] as (number | string)[])[0] as number | string
      }
      throw new Error('#REF!')
    }
    const cRaw = toNumber(evalNode(node.args[2] as ASTNode, ctx))
    if (!Number.isFinite(cRaw)) throw new Error('#VALUE!')
    const c = Math.trunc(cRaw)
    if (r < 1 || r > rows || c < 1 || c > cols) throw new Error('#REF!')
    return (arr[r - 1] as (number | string)[])[c - 1] as number | string
  }
  if (name === 'MATCH') {
    if (node.args.length < 2 || node.args.length > 3) throw new Error('#ERR!')
    const lookup = evalNode(node.args[0] as ASTNode, ctx)
    const list = matToList(expand2D(node.args[1] as ASTNode, ctx))
    const mt = node.args[2]
      ? toNumber(evalNode(node.args[2] as ASTNode, ctx))
      : 1
    if (!Number.isFinite(mt)) throw new Error('#VALUE!')
    if (mt === 0) {
      for (let i = 0; i < list.length; i++) {
        if (eqLoose(list[i] as number | string, lookup)) return i + 1
      }
      throw new Error('#N/A')
    }
    const lookupN = toNumber(lookup)
    if (!Number.isFinite(lookupN)) throw new Error('#N/A')
    if (mt === 1) {
      // Largest value ≤ lookup, array sorted asc.
      let found = -1
      for (let i = 0; i < list.length; i++) {
        const v = toNumber(list[i] as number | string)
        if (!Number.isFinite(v)) continue
        if (v <= lookupN) found = i
        else break
      }
      if (found < 0) throw new Error('#N/A')
      return found + 1
    }
    // mt === -1: smallest value ≥ lookup, array sorted desc.
    let found = -1
    for (let i = 0; i < list.length; i++) {
      const v = toNumber(list[i] as number | string)
      if (!Number.isFinite(v)) continue
      if (v >= lookupN) found = i
      else break
    }
    if (found < 0) throw new Error('#N/A')
    return found + 1
  }
  if (name === 'XLOOKUP') {
    if (node.args.length < 3 || node.args.length > 4) throw new Error('#ERR!')
    const lookup = evalNode(node.args[0] as ASTNode, ctx)
    const lookList = matToList(expand2D(node.args[1] as ASTNode, ctx))
    const retList = matToList(expand2D(node.args[2] as ASTNode, ctx))
    if (lookList.length !== retList.length) throw new Error('#VALUE!')
    for (let i = 0; i < lookList.length; i++) {
      if (eqLoose(lookList[i] as number | string, lookup)) {
        return retList[i] as number | string
      }
    }
    if (node.args[3]) return evalNode(node.args[3] as ASTNode, ctx)
    throw new Error('#N/A')
  }
  if (name === 'XMATCH') {
    if (node.args.length < 2 || node.args.length > 3) throw new Error('#ERR!')
    const lookup = evalNode(node.args[0] as ASTNode, ctx)
    const list = matToList(expand2D(node.args[1] as ASTNode, ctx))
    const mm = node.args[2]
      ? toNumber(evalNode(node.args[2] as ASTNode, ctx))
      : 0
    if (!Number.isFinite(mm)) throw new Error('#VALUE!')
    // Only exact (0) implemented; -1/1 mirror MATCH semantics.
    if (mm === 0) {
      for (let i = 0; i < list.length; i++) {
        if (eqLoose(list[i] as number | string, lookup)) return i + 1
      }
      throw new Error('#N/A')
    }
    const lookupN = toNumber(lookup)
    if (!Number.isFinite(lookupN)) throw new Error('#N/A')
    if (mm === 1 || mm === -1) {
      // Next larger (1) / next smaller (-1).
      let best = -1
      let bestDiff = Infinity
      for (let i = 0; i < list.length; i++) {
        const v = toNumber(list[i] as number | string)
        if (!Number.isFinite(v)) continue
        const diff = mm === 1 ? v - lookupN : lookupN - v
        if (diff >= 0 && diff < bestDiff) {
          best = i
          bestDiff = diff
        }
      }
      if (best < 0) throw new Error('#N/A')
      return best + 1
    }
    throw new Error('#N/A')
  }
  if (name === 'CHOOSE') {
    if (node.args.length < 2) throw new Error('#ERR!')
    const idxRaw = toNumber(evalNode(node.args[0] as ASTNode, ctx))
    if (!Number.isFinite(idxRaw)) throw new Error('#VALUE!')
    const idx = Math.trunc(idxRaw)
    if (idx < 1 || idx >= node.args.length) throw new Error('#VALUE!')
    return evalNode(node.args[idx] as ASTNode, ctx)
  }

  throw new Error('#ERR!')
}

/**
 * Evaluate one cell. `raw` is the cell's source text (e.g. "42", "hello",
 * "=A1+B2"). Non-formula text returns as a number when parseable, else a
 * string. Errors propagate as `{error}` and never throw.
 */
export function evaluateCell(
  raw: string,
  allCells: Record<string, string>,
  depth = 0,
): CellResult {
  if (depth > MAX_DEPTH) return { value: '', error: '#CYCLE!' }
  const text = raw == null ? '' : String(raw)
  if (text === '') return { value: '' }
  if (text[0] !== '=') {
    // Try numeric parse — purely visual; the raw is still kept as a string.
    const n = Number(text)
    if (Number.isFinite(n) && text.trim() !== '') return { value: n }
    return { value: text }
  }
  // Formula path — feed the body to the parser.
  try {
    const tokens = tokenize(preprocessAliases(text.slice(1)))
    const ast = new Parser(tokens).parse()
    const ctx: EvalCtx = {
      cells: allCells,
      depth,
    }
    const v = evalNode(ast, ctx)
    return { value: v }
  } catch (err) {
    const msg = (err as Error).message
    if (msg && msg.startsWith('#')) return { value: '', error: msg }
    return { value: '', error: '#ERR!' }
  }
}

/**
 * Evaluate every populated cell in `cells`. Cycles are caught by the depth
 * cap inside `evaluateCell` — when recursion exceeds MAX_DEPTH (default 50),
 * the engine returns `{error: '#CYCLE!'}` and unwinds, which contains the
 * loop without poisoning unrelated cells.
 */
export function evaluateAll(
  cells: Record<string, string>,
): Record<string, CellResult> {
  const out: Record<string, CellResult> = {}
  for (const ref of Object.keys(cells)) {
    out[ref] = evaluateCell(cells[ref] ?? '', cells)
  }
  return out
}
