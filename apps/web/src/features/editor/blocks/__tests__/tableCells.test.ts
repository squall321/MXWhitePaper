import { describe, it, expect } from 'vitest'
import {
  type SparseCell,
  cellsToFlat,
  findNeighbor,
  flatToCells,
  isAllUnitCells,
  mergeWith,
  splitMerge,
} from '../tableCells'

const cellsFromGrid = (grid: string[][]): SparseCell[] => {
  const out: SparseCell[] = []
  grid.forEach((row, r) =>
    row.forEach((text, c) => {
      const cell: SparseCell = { r, c, text }
      if (r === 0) cell.header = true
      out.push(cell)
    }),
  )
  return out
}

describe('tableCells.flatToCells / cellsToFlat', () => {
  it('round-trips a 2×3 plain table', () => {
    const headers = ['A', 'B', 'C']
    const rows = [['1', '2', '3'], ['4', '5', '6']]
    const cells = flatToCells(headers, rows)
    expect(cells).toHaveLength(9)
    const back = cellsToFlat(cells)
    expect(back.headers).toEqual(headers)
    expect(back.rows).toEqual(rows)
  })
})

describe('tableCells.findNeighbor', () => {
  const cells: SparseCell[] = cellsFromGrid([
    ['A', 'B', 'C'],
    ['1', '2', '3'],
  ])
  it('finds the right neighbour of B', () => {
    const b = cells.find((c) => c.text === 'B')!
    const right = findNeighbor(cells, b, 'right')
    expect(right?.text).toBe('C')
  })
  it('finds the cell below A', () => {
    const a = cells.find((c) => c.text === 'A')!
    const below = findNeighbor(cells, a, 'down')
    expect(below?.text).toBe('1')
  })
  it('returns null when no neighbour shares the full edge', () => {
    // First, merge "A" + "B" into a 1×2; now "A1B" has no plain right
    // neighbour because C is a 1×1 and edge layouts mismatch — actually
    // they DO match (A1B ends at c=2, C starts at c=2, both span row 0).
    // Verify the inverse: from a row-1 cell, looking up at the merged
    // row-0 cell, the column band differs ⇒ null.
    const merged = mergeWith(cells, cells.find((c) => c.text === 'A')!, 'right')!
    const cellAB = merged.find((c) => c.text === 'A\nB')!
    const cell1 = merged.find((c) => c.text === '1')!
    expect(findNeighbor(merged, cell1, 'up')?.text).toBeUndefined()
    // But cellAB has a clean down neighbour at "1"+"2" combined? No, those
    // are still separate 1×1 cells, so the column band doesn't match.
    expect(findNeighbor(merged, cellAB, 'down')).toBeNull()
  })
})

describe('tableCells.mergeWith / splitMerge', () => {
  const cells = cellsFromGrid([
    ['A', 'B', 'C'],
    ['1', '2', '3'],
  ])

  it('merges A and B horizontally, preserving both texts', () => {
    const a = cells.find((c) => c.text === 'A')!
    const merged = mergeWith(cells, a, 'right')!
    const ab = merged.find((c) => c.text === 'A\nB')
    expect(ab).toBeDefined()
    expect(ab?.colSpan).toBe(2)
    expect(ab?.rowSpan).toBeUndefined()
    expect(ab?.r).toBe(0)
    expect(ab?.c).toBe(0)
    expect(ab?.header).toBe(true)
  })

  it('merges A and 1 vertically', () => {
    const a = cells.find((c) => c.text === 'A')!
    const merged = mergeWith(cells, a, 'down')!
    const a1 = merged.find((c) => c.text === 'A\n1')
    expect(a1).toBeDefined()
    expect(a1?.rowSpan).toBe(2)
    expect(a1?.colSpan).toBeUndefined()
  })

  it('splits a merged cell back into 1×1 slots', () => {
    const a = cells.find((c) => c.text === 'A')!
    const merged = mergeWith(cells, a, 'right')!
    const ab = merged.find((c) => c.text === 'A\nB')!
    const split = splitMerge(merged, ab)
    // After split: 6 cells (the original 1×1 grid worth).
    expect(split).toHaveLength(6)
    expect(isAllUnitCells(split)).toBe(true)
    // Anchor text lands on (0,0); the second slot gets "" — text fan-out
    // is intentionally lossy: merging concatenates, splitting can't reverse it.
    const top = split.filter((c) => c.r === 0).sort((x, y) => x.c - y.c)
    expect(top[0]?.text).toBe('A\nB')
    expect(top[1]?.text).toBe('')
  })

  it('returns null when no neighbour exists in the requested direction', () => {
    const c = cells.find((cell) => cell.text === 'C')!
    expect(mergeWith(cells, c, 'right')).toBeNull()
  })
})
