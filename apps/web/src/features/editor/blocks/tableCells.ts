/**
 * Pure helpers that operate on a TableBlock's sparse `cells` list. Kept
 * outside the React component so the merge math is unit-testable and easy
 * to reason about — every helper takes immutable input and returns a new
 * cells array.
 *
 * Cell coordinates are 0-indexed grid slots:
 *   - `r` / `c`     — anchor's top-left cell on the virtual grid
 *   - `rowSpan`     — number of rows the cell occupies (default 1)
 *   - `colSpan`     — number of columns the cell occupies (default 1)
 *   - `header`      — true ⇒ rendered as a `<th>`, only on row 0 normally
 *
 * Merges only happen between *anchor* cells; covered slots have no entry.
 */
import type { TableBlock } from '@/types/document'

export type SparseCell = NonNullable<TableBlock['cells']>[number]

export function rsOf(cell: SparseCell): number {
  return Math.max(1, cell.rowSpan ?? 1)
}
export function csOf(cell: SparseCell): number {
  return Math.max(1, cell.colSpan ?? 1)
}

/** Inclusive-exclusive bounding box of a cell on the grid. */
export function bbox(cell: SparseCell): { r0: number; r1: number; c0: number; c1: number } {
  return {
    r0: cell.r,
    r1: cell.r + rsOf(cell),
    c0: cell.c,
    c1: cell.c + csOf(cell),
  }
}

/**
 * True when `b` sits exactly on the right edge of `a` and they share the
 * same row band (so they can be merged horizontally without leaving holes
 * in the grid).
 */
export function isRightNeighbor(a: SparseCell, b: SparseCell): boolean {
  const A = bbox(a)
  const B = bbox(b)
  return A.r0 === B.r0 && A.r1 === B.r1 && A.c1 === B.c0
}

/** Mirror of isRightNeighbor for vertical adjacency. */
export function isBelowNeighbor(a: SparseCell, b: SparseCell): boolean {
  const A = bbox(a)
  const B = bbox(b)
  return A.c0 === B.c0 && A.c1 === B.c1 && A.r1 === B.r0
}

/**
 * Find the cell directly to the LEFT / RIGHT / ABOVE / BELOW of `anchor`,
 * if any. Returns null when no neighbour shares the full edge (i.e.
 * merging would tear a hole in the grid).
 */
export function findNeighbor(
  cells: readonly SparseCell[],
  anchor: SparseCell,
  side: 'left' | 'right' | 'up' | 'down',
): SparseCell | null {
  for (const c of cells) {
    if (c === anchor) continue
    if (side === 'right' && isRightNeighbor(anchor, c)) return c
    if (side === 'left' && isRightNeighbor(c, anchor)) return c
    if (side === 'down' && isBelowNeighbor(anchor, c)) return c
    if (side === 'up' && isBelowNeighbor(c, anchor)) return c
  }
  return null
}

/**
 * Combine `anchor` and `other` into a single anchor that covers both
 * bounding boxes. The merged cell's text concatenates both texts (newline
 * separated) so user content isn't silently dropped. The returned list
 * preserves the original ordering minus the absorbed neighbour.
 */
export function mergeWith(
  cells: readonly SparseCell[],
  anchor: SparseCell,
  side: 'left' | 'right' | 'up' | 'down',
): SparseCell[] | null {
  const neighbor = findNeighbor(cells, anchor, side)
  if (!neighbor) return null
  const A = bbox(anchor)
  const N = bbox(neighbor)
  const r0 = Math.min(A.r0, N.r0)
  const c0 = Math.min(A.c0, N.c0)
  const r1 = Math.max(A.r1, N.r1)
  const c1 = Math.max(A.c1, N.c1)
  // Keep the upper-left cell as the merge anchor — that's where the text
  // and header flag should live after the merge.
  const upperLeft = anchor.r < neighbor.r || anchor.c < neighbor.c ? anchor : neighbor
  const otherText = upperLeft === anchor ? neighbor.text : anchor.text
  const newText = combineText(upperLeft.text ?? '', otherText ?? '')
  // Mixed-content (`blocks`) wins over plain text on merge — if either side
  // has rich content, concatenate the blocks arrays (upper-left first) so
  // nothing is silently dropped. Otherwise fall back to text-merge.
  const anchorBlocks = anchor.blocks
  const neighborBlocks = neighbor.blocks
  const newBlocks: SparseCell['blocks'] | undefined =
    anchorBlocks || neighborBlocks
      ? ([
          ...(upperLeft === anchor ? (anchorBlocks ?? []) : (neighborBlocks ?? [])),
          ...(upperLeft === anchor ? (neighborBlocks ?? []) : (anchorBlocks ?? [])),
        ] as SparseCell['blocks'])
      : undefined
  const merged: SparseCell = newBlocks && newBlocks.length > 0
    ? { r: r0, c: c0, blocks: newBlocks }
    : { r: r0, c: c0, text: newText }
  if (r1 - r0 > 1) merged.rowSpan = r1 - r0
  if (c1 - c0 > 1) merged.colSpan = c1 - c0
  if (upperLeft.header) merged.header = true
  return cells
    .filter((c) => c !== anchor && c !== neighbor)
    .concat(merged)
}

function combineText(a: string, b: string): string {
  if (!a) return b
  if (!b) return a
  return `${a}\n${b}`
}

/**
 * Break `anchor` (rowSpan/colSpan > 1) into 1×1 cells covering its
 * bounding box. The original text stays on the upper-left; the freshly
 * uncovered slots get empty strings. Covered slots that already had
 * sibling content (impossible by invariant — sparse list) are ignored.
 */
export function splitMerge(
  cells: readonly SparseCell[],
  anchor: SparseCell,
): SparseCell[] {
  if (rsOf(anchor) === 1 && csOf(anchor) === 1) return cells.slice()
  const out = cells.filter((c) => c !== anchor)
  const { r0, r1, c0, c1 } = bbox(anchor)
  for (let r = r0; r < r1; r++) {
    for (let c = c0; c < c1; c++) {
      const cell: SparseCell = { r, c, text: r === r0 && c === c0 ? anchor.text : '' }
      if (anchor.header && r === 0) cell.header = true
      out.push(cell)
    }
  }
  return out
}

/**
 * Convert a flat headers/rows pair into a sparse cells list with no
 * merges yet. Used when the user fires their first merge action on a
 * legacy table — the editor switches to cells mode under the hood.
 */
export function flatToCells(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
): SparseCell[] {
  const out: SparseCell[] = []
  headers.forEach((h, c) => {
    out.push({ r: 0, c, text: h, header: true })
  })
  rows.forEach((row, r) => {
    row.forEach((text, c) => {
      out.push({ r: r + 1, c, text })
    })
  })
  return out
}

/**
 * Reverse of `flatToCells` — rebuilds headers/rows by walking each grid
 * slot. Used by the "표 평탄화" button. Cells with rowSpan/colSpan > 1
 * keep their text on the anchor and leave covered slots empty (merge
 * info is intentionally lost).
 */
export function cellsToFlat(
  cells: readonly SparseCell[],
): { headers: string[]; rows: string[][] } {
  if (cells.length === 0) return { headers: [], rows: [] }
  let maxR = 0
  let maxC = 0
  for (const cell of cells) {
    const { r1, c1 } = bbox(cell)
    if (r1 - 1 > maxR) maxR = r1 - 1
    if (c1 - 1 > maxC) maxC = c1 - 1
  }
  const grid: string[][] = Array.from({ length: maxR + 1 }, () =>
    Array(maxC + 1).fill(''),
  )
  // Mixed-content cells (`blocks`) collapse to '' here — flat mode is a
  // headers/rows string grid by definition and can't hold rich content.
  // This is a deliberate lossy fallback used by "표 평탄화"; rich content
  // must be edited in sparse mode.
  for (const cell of cells) grid[cell.r]![cell.c] = cell.text ?? ''
  return { headers: grid[0] ?? [], rows: grid.slice(1) }
}

/**
 * True when every cell in `cells` is a plain 1×1. Used by the editor to
 * decide whether to drop back to the flat representation after the user
 * has split every merge in the table.
 */
export function isAllUnitCells(cells: readonly SparseCell[]): boolean {
  return cells.every((c) => rsOf(c) === 1 && csOf(c) === 1)
}
