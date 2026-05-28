/**
 * Spreadsheet → CSV/TSV serializer (pure helper).
 *
 * 사용 맥락: SpreadsheetBlockEditor 의 toolbar "CSV/TSV 내보내기" 가 호출.
 * Excel/Google Sheets 가 그대로 paste 받도록 *평가된 값* 을 우선 출력하고
 * (formula 자체가 아니라 결과), 옵션으로 `raw` 모드를 두어 formula 원문을
 * 보존할 수도 있다.
 *
 * 알고리즘:
 *   - cols × rows 의 dense grid 로 직렬화 (sparse map 펼침).
 *   - 각 cell:
 *       * `raw=false` (default): computed[ref].value → 문자열, error 가 있으면
 *         error 코드 (`#REF!` 등) 그대로 출력.
 *       * `raw=true`: cells[ref] 원본 문자열 (formula 포함).
 *       * 없으면 빈 문자열.
 *   - CSV (RFC 4180): 콤마/큰따옴표/CR/LF 가 포함된 셀은 `"..."` 로 감싸고
 *     큰따옴표는 `""` 로 escape.
 *   - TSV: 탭/CR/LF 를 escape 할 표준이 없어서 *탭/CR/LF 만 공백으로 치환*
 *     하는 안전한 방식 (Excel/Google Sheets 가 둘 다 받아줌).
 *   - 줄 구분자는 CRLF (Excel for Windows 가 LF-only 를 깨는 케이스 회피).
 */

import type { CellResult } from './formulaEngine'
import { refOf } from './formulaEngine'

export type CsvDialect = 'csv' | 'tsv'

export interface SerializeOptions {
  cols: number
  rows: number
  cells: Record<string, string>
  computed?: Record<string, CellResult>
  /** true → formula 원문 보존. 기본 false → 평가된 값. */
  raw?: boolean
  dialect: CsvDialect
}

/** Default-export-friendly entry point. */
export function spreadsheetToDelimited(opts: SerializeOptions): string {
  const { cols, rows, cells, computed, raw = false, dialect } = opts
  const sep = dialect === 'tsv' ? '\t' : ','
  const escape = dialect === 'tsv' ? escapeTsvCell : escapeCsvCell
  const lines: string[] = []
  for (let r = 0; r < rows; r++) {
    const row: string[] = []
    for (let c = 0; c < cols; c++) {
      const ref = refOf(c, r)
      const text = resolveCell(ref, cells, computed, raw)
      row.push(escape(text))
    }
    lines.push(row.join(sep))
  }
  return lines.join('\r\n')
}

function resolveCell(
  ref: string,
  cells: Record<string, string>,
  computed: Record<string, CellResult> | undefined,
  raw: boolean,
): string {
  if (raw) return cells[ref] ?? ''
  const result = computed?.[ref]
  if (result) {
    if (result.error) return result.error
    if (result.value === '') return ''
    return String(result.value)
  }
  // computed 가 없는 셀 (= 비어 있거나 formula 미평가) — raw 텍스트 그대로
  return cells[ref] ?? ''
}

function escapeCsvCell(s: string): string {
  if (s === '') return ''
  // RFC 4180: ", , CR, LF → 큰따옴표로 감싸기 + 내부 " 는 "" 로 escape.
  const needsQuote = /[",\r\n]/.test(s)
  if (!needsQuote) return s
  return '"' + s.replace(/"/g, '""') + '"'
}

function escapeTsvCell(s: string): string {
  if (s === '') return ''
  // TSV 표준 escape 가 없어서 탭/CR/LF 를 공백으로 강제 치환.
  // (Excel/Google Sheets 도 동일한 안전 fallback 을 권장한다.)
  return s.replace(/[\t\r\n]/g, ' ')
}
