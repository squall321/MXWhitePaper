/**
 * CSV / TSV paste detection + parsing.
 *
 * Used by the editor surface to intercept `paste` events: if the clipboard
 * text matches a CSV-ish shape (≥2 lines, ≥2 cells per line, comma- or
 * tab-separated), we surface a "표로 변환?" affordance. The parser supports
 * RFC-4180 quoted fields with embedded commas / newlines / escaped quotes.
 *
 * Pure module. No DOM, no React.
 */

export interface CsvParseResult {
  /** Detected delimiter — `,` or `\t`. */
  delimiter: ',' | '\t'
  /** Header row (first line). */
  headers: string[]
  /** Data rows; padded to header length when necessary. */
  rows: string[][]
}

/**
 * Heuristic — return true when `text` looks like a CSV/TSV worth offering as a
 * table. Conservative on purpose: 2+ lines AND 2+ cells per line AND the
 * delimiter count is consistent across the first 5 lines (allow ±1 drift for
 * trailing-empty rows from spreadsheets).
 */
export function looksLikeCsv(text: string): boolean {
  const sample = text.replace(/\r\n/g, '\n').split('\n').filter((l) => l.length > 0)
  if (sample.length < 2) return false
  const head = sample.slice(0, 5)

  const probe = (delim: string): boolean => {
    const counts = head.map((l) => countDelimUnquoted(l, delim))
    if (counts[0] === undefined || counts[0] < 1) return false
    // Require ≥2 lines (header + one body row) sharing the SAME delim count.
    // This is conservative — a 2-line prose snippet with commas only on the
    // first line will fail, while a real header+row CSV passes.
    const matchesHeader = counts.filter((c) => c === counts[0]).length
    return matchesHeader >= 2
  }
  return probe('\t') || probe(',')
}

/**
 * RFC-4180-ish parser. Returns null when the text fails the `looksLikeCsv`
 * check (so callers can fall through to the default paste).
 */
export function parseCsv(text: string): CsvParseResult | null {
  if (!looksLikeCsv(text)) return null
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  // Prefer tab when both are present and tab actually splits cells.
  const head = normalized.split('\n').filter((l) => l.length > 0).slice(0, 5)
  const tabCount = head.map((l) => countDelimUnquoted(l, '\t'))[0] ?? 0
  const commaCount = head.map((l) => countDelimUnquoted(l, ','))[0] ?? 0
  const delimiter: ',' | '\t' = tabCount >= 1 && tabCount >= commaCount ? '\t' : ','

  const rows = parseRows(normalized, delimiter)
  if (rows.length < 2) return null

  const headers = rows[0]!.map((c) => c.trim())
  const dataRows = rows.slice(1).map((r) => {
    if (r.length === headers.length) return r
    if (r.length < headers.length) {
      return [...r, ...Array(headers.length - r.length).fill('')]
    }
    return r.slice(0, headers.length)
  })
  return { delimiter, headers, rows: dataRows }
}

/* ── Internal helpers ──────────────────────────────────────────────────── */

function countDelimUnquoted(line: string, delim: string): number {
  let inQuote = false
  let n = 0
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') {
      if (inQuote && line[i + 1] === '"') {
        i++
        continue
      }
      inQuote = !inQuote
    } else if (!inQuote && c === delim) {
      n++
    }
  }
  return n
}

function parseRows(text: string, delim: string): string[][] {
  const rows: string[][] = []
  let cur: string[] = []
  let cell = ''
  let inQuote = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuote) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i++
        } else {
          inQuote = false
        }
      } else {
        cell += c
      }
      continue
    }
    if (c === '"') {
      inQuote = true
      continue
    }
    if (c === delim) {
      cur.push(cell)
      cell = ''
      continue
    }
    if (c === '\n') {
      cur.push(cell)
      cell = ''
      // Skip emitting empty rows (e.g. trailing newline).
      if (cur.length > 1 || (cur[0] ?? '').length > 0) {
        rows.push(cur)
      }
      cur = []
      continue
    }
    cell += c
  }
  if (cell.length > 0 || cur.length > 0) {
    cur.push(cell)
    if (cur.length > 1 || (cur[0] ?? '').length > 0) {
      rows.push(cur)
    }
  }
  return rows
}
