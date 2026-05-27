import { parseRef, refOf } from './formulaEngine'

/**
 * Formula reference shifter — pure string-level rewriter for row/col
 * insert/delete.
 *
 * 사용 맥락: spreadsheet 행/열을 삽입/삭제했을 때, 다른 cell 의 formula
 * 가 가리키던 참조가 깨지지 않도록 정수 인덱스를 보정한다.
 * formulaEngine 는 AST 가 있지만 다시 string 으로 직렬화하는 경로가 없어서,
 * 여기서는 일관되게 *문자열 정규식 치환* 으로 처리한다 (engine 과 같은 ref
 * 정규식 사용).
 *
 * 알고리즘:
 *   - axis='row', delta=+1, insertAt=N:
 *       ref.row >= N  →  ref.row + 1
 *       ref.row <  N  →  변경 없음
 *   - axis='row', delta=-1, deletedIndex=N:
 *       ref.row == N  →  '#REF!'
 *       ref.row >  N  →  ref.row - 1
 *       ref.row <  N  →  변경 없음
 *   - axis='col' 동일 규칙을 col 에 적용
 *   - 범위 (`A1:B5`) 는 양 끝점 각각 독립적으로 적용. 둘 다 '#REF!' 가
 *     되거나 하나라도 '#REF!' 가 되면 전체 범위가 '#REF!' 가 된다 (Excel
 *     동작).
 *   - 절대 참조 (`$A$1`, `$A1`, `A$1`) 의 `$` 는 그대로 보존하면서 인덱스
 *     만 shift. 엑셀과 동일 — `$` 는 *복사/이동* 시 lock 의미일 뿐, 행/열
 *     insert/delete 에서는 항상 shift 된다.
 *   - formula 가 '=' 로 시작하지 않으면 (= 일반 텍스트/숫자) 변경 없음.
 */

export type ShiftAxis = 'row' | 'col'

interface ShiftOptions {
  axis: ShiftAxis
  insertAt: number
  delta: 1 | -1
  /** delta=-1 일 때 삭제된 인덱스. delta=+1 일 때는 무시. */
  deletedIndex?: number
}

const REF_RE = /(\$?)([A-Z]+)(\$?)(\d+)/g

interface ParsedRef {
  colDollar: string
  colLetters: string
  rowDollar: string
  rowDigits: string
  col: number
  row: number
}

function parseRefMatch(
  colDollar: string,
  colLetters: string,
  rowDollar: string,
  rowDigits: string,
): ParsedRef | null {
  if (colLetters.length > 1) return null // A..Z only (MAX_COLS=26)
  const col = colLetters.charCodeAt(0) - 65
  if (col < 0 || col >= 26) return null
  const row = parseInt(rowDigits, 10) - 1
  if (!Number.isFinite(row) || row < 0) return null
  return { colDollar, colLetters, rowDollar, rowDigits, col, row }
}

/**
 * 한 ref 를 shift. 반환값:
 *   - string: shift 된 ref (예: 'A2', '$B$3')
 *   - '#REF!': 삭제된 행/열을 가리킨 경우
 *   - null: 입력이 ref 가 아니라 그대로 유지해야 하는 경우 (multi-letter 등)
 */
function shiftSingleRef(parsed: ParsedRef, opts: ShiftOptions): string | '#REF!' {
  const idx = opts.axis === 'row' ? parsed.row : parsed.col
  let newIdx = idx
  if (opts.delta === 1) {
    if (idx >= opts.insertAt) newIdx = idx + 1
  } else {
    // delta === -1
    if (opts.deletedIndex == null) return rebuildRef(parsed)
    if (idx === opts.deletedIndex) return '#REF!'
    if (idx > opts.deletedIndex) newIdx = idx - 1
  }
  if (opts.axis === 'row') {
    return `${parsed.colDollar}${parsed.colLetters}${parsed.rowDollar}${newIdx + 1}`
  } else {
    return `${parsed.colDollar}${String.fromCharCode(65 + newIdx)}${parsed.rowDollar}${parsed.rowDigits}`
  }
}

function rebuildRef(parsed: ParsedRef): string {
  return `${parsed.colDollar}${parsed.colLetters}${parsed.rowDollar}${parsed.rowDigits}`
}

/**
 * Formula 문자열의 모든 ref 와 range 를 shift 한다.
 *
 * 토큰화 없이 *정규식 패스 1회* + range colon 후처리로 처리:
 *   1. 첫 패스에서 모든 ref 매치를 추출 (offset 기록).
 *   2. 인접한 두 ref 사이에 `:` 가 있으면 range 로 인식 → 양쪽 모두
 *      shift 결과를 합쳐 '#REF!' 룰 적용.
 *   3. 그 외 ref 는 단일 ref 로 shift.
 *
 * non-formula (= 로 시작하지 않음) 는 그대로 반환.
 */
export function shiftReferences(formula: string, options: ShiftOptions): string {
  if (typeof formula !== 'string') return formula
  if (formula === '' || formula[0] !== '=') return formula

  interface Match {
    start: number
    end: number
    parsed: ParsedRef | null
    raw: string
  }
  const matches: Match[] = []
  REF_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = REF_RE.exec(formula)) !== null) {
    const colDollar = m[1] ?? ''
    const colLetters = m[2] as string
    const rowDollar = m[3] ?? ''
    const rowDigits = m[4] as string
    const parsed = parseRefMatch(colDollar, colLetters, rowDollar, rowDigits)
    matches.push({
      start: m.index,
      end: m.index + m[0].length,
      parsed,
      raw: m[0],
    })
  }

  if (matches.length === 0) return formula

  // Detect ranges: M[i] 와 M[i+1] 사이에 `:` 만 (whitespace 허용) 있으면 range.
  const isRangePair = new Set<number>() // index of the *first* ref of a range pair
  for (let i = 0; i < matches.length - 1; i++) {
    const cur = matches[i] as Match
    const nxt = matches[i + 1] as Match
    const between = formula.slice(cur.end, nxt.start)
    if (/^\s*:\s*$/.test(between)) {
      isRangePair.add(i)
    }
  }

  // Build output by replacing matches from left to right.
  let out = ''
  let cursor = 0
  let i = 0
  while (i < matches.length) {
    const cur = matches[i] as Match
    out += formula.slice(cursor, cur.start)

    if (isRangePair.has(i)) {
      const nxt = matches[i + 1] as Match
      const between = formula.slice(cur.end, nxt.start)
      if (cur.parsed && nxt.parsed) {
        const a = shiftSingleRef(cur.parsed, options)
        const b = shiftSingleRef(nxt.parsed, options)
        if (a === '#REF!' || b === '#REF!') {
          out += '#REF!'
        } else {
          out += `${a}${between}${b}`
        }
      } else {
        // Non-parseable refs (e.g. multi-letter) — leave the range untouched.
        out += `${cur.raw}${between}${nxt.raw}`
      }
      cursor = nxt.end
      i += 2
      continue
    }

    if (cur.parsed) {
      const r = shiftSingleRef(cur.parsed, options)
      out += r
    } else {
      out += cur.raw
    }
    cursor = cur.end
    i += 1
  }
  out += formula.slice(cursor)
  return out
}

/**
 * cells 맵 (key='A1' 등) 을 한 행/열 insert 또는 delete 후의 상태로 재구성.
 *
 * insert 시: 키의 좌표 인덱스가 idx 이상이면 +1 shift. 값(formula)도 함께
 * shiftReferences 로 보정.
 * delete 시: 좌표 인덱스가 idx 인 셀은 drop. idx 초과는 -1 shift. 값의
 * formula 참조 중 삭제된 행/열을 가리키는 것은 '#REF!' 가 된다.
 */
export function remapCells(
  cells: Record<string, string>,
  axis: ShiftAxis,
  idx: number,
  mode: 'insert' | 'delete',
): Record<string, string> {
  const next: Record<string, string> = {}
  const opts: ShiftOptions =
    mode === 'insert'
      ? { axis, insertAt: idx, delta: 1 }
      : { axis, insertAt: idx, delta: -1, deletedIndex: idx }
  for (const [k, v] of Object.entries(cells)) {
    const pos = parseRef(k)
    if (!pos) {
      next[k] = v
      continue
    }
    const target = axis === 'row' ? pos.row : pos.col
    let newCol = pos.col
    let newRow = pos.row
    if (mode === 'insert') {
      if (target >= idx) {
        if (axis === 'row') newRow = pos.row + 1
        else newCol = pos.col + 1
      }
    } else {
      if (target === idx) continue
      if (target > idx) {
        if (axis === 'row') newRow = pos.row - 1
        else newCol = pos.col - 1
      }
    }
    next[refOf(newCol, newRow)] = shiftReferences(v, opts)
  }
  return next
}
