/**
 * Helpers for "paste a spreadsheet selection into a table cell" flow.
 *
 * Excel / Google Sheets / Numbers serialize a multi-cell selection as
 * tab-separated values with `\n` row separators (some browsers replace
 * `\n` with `\r\n`). We treat anything containing a tab OR a real newline
 * as a candidate; pure CSV is also recognized when the user explicitly
 * pastes a comma-separated multiline blob (rarer but useful).
 */

export type ParsedPaste = {
  /** rows[r][c] — already trimmed of trailing newline. */
  rows: string[][]
  /** widest row width — used to size the destination table. */
  cols: number
}

/**
 * Decide whether a clipboard string looks like tabular data we should
 * expand into the table. Plain single-line text — even with commas —
 * goes through the normal cell-text path.
 */
export function looksLikeTabular(text: string): boolean {
  if (!text) return false
  const trimmed = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '')
  if (!trimmed.includes('\n') && !trimmed.includes('\t')) return false
  // Multi-line: yes; single-line with at least one tab: yes.
  // Multi-line with only commas needs a sniff (avoid hijacking prose with
  // one or two commas). Require at least 2 commas on every non-empty line.
  if (trimmed.includes('\t')) return true
  if (trimmed.includes('\n')) {
    const lines = trimmed.split('\n').filter((l) => l.length > 0)
    if (lines.length < 2) return false
    return lines.every((l) => (l.match(/,/g) ?? []).length >= 1)
  }
  return false
}

/**
 * Parse the pasted blob. TSV (tab) takes priority — Excel always emits
 * tabs even when the source columns were comma-separated. Falls back to
 * naive CSV split (no quote handling, deliberately) when there are no
 * tabs but at least one comma per line.
 */
export function parseTabular(text: string): ParsedPaste {
  const normalized = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '')
  const useTabs = normalized.includes('\t')
  const lines = normalized.split('\n')
  const rows = lines.map((line) =>
    useTabs ? line.split('\t') : splitCsvLine(line),
  )
  const cols = rows.reduce((m, r) => Math.max(m, r.length), 0)
  // Right-pad short rows so the table doesn't end up jagged.
  for (const r of rows) while (r.length < cols) r.push('')
  return { rows, cols }
}

/**
 * Naive CSV row split. We DO NOT honor quoted fields with embedded commas
 * — the goal is "good enough for spreadsheet exports" and Excel always
 * uses tabs anyway. If users hit this in practice we can swap in a real
 * RFC-4180 parser later.
 */
function splitCsvLine(line: string): string[] {
  return line.split(',').map((c) => c.trim())
}

/**
 * Apply a tabular paste to a flat table at the focused cell. Grows the
 * table headers/rows so the entire pasted area lands inside; the first
 * pasted row stays as data (does NOT replace headers — the user can
 * promote it to header by editing if they want).
 */
export function applyTabularPasteToFlat(
  block: { headers: string[]; rows: string[][] },
  startRow: number,
  startCol: number,
  paste: ParsedPaste,
): { headers: string[]; rows: string[][] } {
  // Grow column count if needed.
  const neededCols = startCol + paste.cols
  const headers = [...block.headers]
  while (headers.length < neededCols) {
    headers.push(`열 ${headers.length + 1}`)
  }
  // Grow row count if needed.
  const neededRows = startRow + paste.rows.length
  const rows = block.rows.map((r) => {
    const out = [...r]
    while (out.length < headers.length) out.push('')
    return out
  })
  while (rows.length < neededRows) {
    rows.push(headers.map(() => ''))
  }
  // Splat the paste in.
  for (let r = 0; r < paste.rows.length; r++) {
    for (let c = 0; c < paste.cols; c++) {
      const dst = rows[startRow + r]
      if (!dst) continue
      dst[startCol + c] = paste.rows[r]?.[c] ?? ''
    }
  }
  return { headers, rows }
}
