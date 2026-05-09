/**
 * Tiny LCS-based line/word differ — used by the version-diff JSON view and the
 * inline text-block diff. Pure, no dependency. Big-O is O(N*M) which is fine
 * for the document sizes we ship (a single section's text or a few-hundred
 * line JSON dump).
 *
 * The return shape is a flat list of "ops" so the caller can render them in
 * order with whatever colours / strikethroughs the design calls for.
 */

export type DiffOp =
  | { kind: 'equal'; value: string }
  | { kind: 'add'; value: string }
  | { kind: 'remove'; value: string }

/** Compute LCS table (lengths only). */
function lcs(a: readonly string[], b: readonly string[]): number[][] {
  const m = a.length
  const n = b.length
  const t: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  )
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (a[i] === b[j]) t[i]![j] = (t[i + 1]?.[j + 1] ?? 0) + 1
      else t[i]![j] = Math.max(t[i + 1]?.[j] ?? 0, t[i]?.[j + 1] ?? 0)
    }
  }
  return t
}

/** Walk the LCS table and emit ops for each token. */
function lcsOps(a: readonly string[], b: readonly string[]): DiffOp[] {
  const t = lcs(a, b)
  const ops: DiffOp[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push({ kind: 'equal', value: a[i]! })
      i++
      j++
    } else if ((t[i + 1]?.[j] ?? 0) >= (t[i]?.[j + 1] ?? 0)) {
      ops.push({ kind: 'remove', value: a[i]! })
      i++
    } else {
      ops.push({ kind: 'add', value: b[j]! })
      j++
    }
  }
  while (i < a.length) ops.push({ kind: 'remove', value: a[i++]! })
  while (j < b.length) ops.push({ kind: 'add', value: b[j++]! })
  return ops
}

/** Diff two blobs by line. Includes a newline marker so we can render later. */
export function diffLines(a: string, b: string): DiffOp[] {
  return lcsOps(a.split('\n'), b.split('\n'))
}

/**
 * Word-level diff. We split on whitespace boundaries but keep the whitespace
 * as its own token so the rendered output preserves spacing.
 *
 *   "안녕 하세요" → ["안녕", " ", "하세요"]
 */
export function diffWords(a: string, b: string): DiffOp[] {
  return lcsOps(tokenize(a), tokenize(b))
}

function tokenize(s: string): string[] {
  if (s === '') return []
  // Split into runs of whitespace OR runs of non-whitespace.
  return s.match(/\s+|\S+/g) ?? []
}
