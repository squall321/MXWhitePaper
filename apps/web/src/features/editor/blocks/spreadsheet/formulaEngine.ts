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

const FN_NAMES = new Set([
  'SUM',
  'AVG',
  'AVERAGE',
  'MIN',
  'MAX',
  'COUNT',
  'IF',
  'ROUND',
  'CONCAT',
])

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
    const tokens = tokenize(text.slice(1))
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
