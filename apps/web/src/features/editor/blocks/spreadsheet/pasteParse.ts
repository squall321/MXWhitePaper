/**
 * Excel/Google Sheets 멀티셀 paste 파서 (pure helper).
 *
 * 사용 맥락: SpreadsheetBlockEditor 의 셀 input onPaste. 클립보드 text/plain
 * 에 탭 또는 개행이 있으면 2차원 그리드로 해석해 anchor 셀부터 채운다.
 * Excel 은 멀티셀 선택을 항상 탭 구분 + 개행 행 구분으로 직렬화하므로 탭이
 * 하나라도 있으면 TSV 로 우선 처리하고, 탭 없는 multi-line 텍스트는
 * quote-aware CSV (RFC 4180: `"..."` 안의 콤마/개행/`""` escape) 로 처리.
 *
 * 반환 계약:
 *   - string[][] (row-major, 최대 행 너비로 right-pad) — 호출부가
 *     preventDefault 후 그리드를 직접 채워야 한다.
 *   - null — 단일 토큰 (탭/개행 없음, 또는 trailing 개행 제거 후 1x1).
 *     브라우저 기본 paste 동작을 유지하라는 신호. Excel 은 단일 셀 복사에도
 *     trailing CRLF 를 붙이므로 1x1 까지 단일 토큰으로 취급한다.
 */

export function parseSpreadsheetPaste(text: string): string[][] | null {
  if (!text) return null
  const normalized = text.replace(/\r\n?/g, '\n')
  if (!normalized.includes('\t') && !normalized.includes('\n')) return null
  const delim = normalized.includes('\t') ? '\t' : ','
  const rows = parseDelimited(normalized, delim)
  // trailing 빈 행 제거 — Excel/Sheets 가 마지막에 개행을 붙여 보낸다.
  while (
    rows.length > 0 &&
    (rows[rows.length - 1] as string[]).every((c) => c === '')
  ) {
    rows.pop()
  }
  if (rows.length === 0) return null
  if (rows.length === 1 && (rows[0] as string[]).length === 1) return null
  // Right-pad jagged rows so the grid is rectangular.
  const width = rows.reduce((m, r) => Math.max(m, r.length), 0)
  for (const r of rows) while (r.length < width) r.push('')
  return rows
}

/**
 * Quote-aware delimited parse — 탭/콤마 공용. 필드 시작의 `"` 만 quote 로
 * 인식 (`a"b` 는 literal), quote 안의 `""` 는 escape, quote 안의 개행/구분자
 * 는 필드 내용으로 보존.
 */
function parseDelimited(text: string, delim: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0
  while (i < text.length) {
    const ch = text[i] as string
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      field += ch
      i++
      continue
    }
    if (ch === '"' && field === '') {
      inQuotes = true
      i++
      continue
    }
    if (ch === delim) {
      row.push(field)
      field = ''
      i++
      continue
    }
    if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i++
      continue
    }
    field += ch
    i++
  }
  row.push(field)
  rows.push(row)
  return rows
}
