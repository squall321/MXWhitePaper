/**
 * Cycle Z — promote/demote helpers for sparse table cells. These are pure
 * functions (no React, no DOM) so the tests live alongside the existing
 * tableCells.test.ts as a separate file purely for topical grouping.
 */
import { describe, it, expect } from 'vitest'
import {
  type SparseCell,
  demoteToText,
  demoteWouldLoseData,
  promoteToBlocks,
} from '../tableCells'

type CellBlock = NonNullable<SparseCell['blocks']>[number]

describe('tableCells.promoteToBlocks', () => {
  it('converts a text cell to a single-paragraph blocks cell', () => {
    const cell: SparseCell = { r: 0, c: 0, text: 'hi' }
    const out = promoteToBlocks(cell)
    expect(out.text).toBeUndefined()
    expect(out.blocks).toBeDefined()
    expect(out.blocks).toHaveLength(1)
    expect(out.blocks![0]!.type).toBe('paragraph')
    expect((out.blocks![0] as Extract<CellBlock, { type: 'paragraph' }>).text).toBe('hi')
  })

  it('is a no-op on a cell already in blocks mode', () => {
    const existing: CellBlock = { type: 'paragraph', id: 'p1', text: 'kept' }
    const cell: SparseCell = { r: 1, c: 2, blocks: [existing] }
    const out = promoteToBlocks(cell)
    expect(out).toBe(cell)
    expect(out.blocks).toEqual([existing])
  })

  it('emits an empty paragraph when text is empty', () => {
    const cell: SparseCell = { r: 0, c: 0, text: '' }
    const out = promoteToBlocks(cell)
    expect(out.blocks).toHaveLength(1)
    expect((out.blocks![0] as Extract<CellBlock, { type: 'paragraph' }>).text).toBe('')
    expect(out.text).toBeUndefined()
  })

  it('emits an empty paragraph when text is undefined', () => {
    const cell: SparseCell = { r: 0, c: 0 }
    const out = promoteToBlocks(cell)
    expect(out.blocks).toHaveLength(1)
    expect((out.blocks![0] as Extract<CellBlock, { type: 'paragraph' }>).text).toBe('')
  })
})

describe('tableCells.demoteToText', () => {
  it('joins paragraph text and list items with newlines', () => {
    const cell: SparseCell = {
      r: 0,
      c: 0,
      blocks: [
        { type: 'paragraph', id: 'p1', text: 'a' },
        { type: 'list', id: 'l1', style: 'bullet', items: ['b', 'c'] },
      ] as NonNullable<SparseCell['blocks']>,
    }
    const out = demoteToText(cell)
    expect(out.blocks).toBeUndefined()
    expect(out.text).toBe('a\nb\nc')
  })

  it('drops image blocks (lossy)', () => {
    const cell: SparseCell = {
      r: 0,
      c: 0,
      blocks: [
        { type: 'paragraph', id: 'p1', text: 'a' },
        { type: 'image', id: 'i1', imageId: 'x' },
        { type: 'paragraph', id: 'p2', text: 'b' },
      ] as NonNullable<SparseCell['blocks']>,
    }
    const out = demoteToText(cell)
    expect(out.text).toBe('a\nb')
    expect(out.text).not.toContain('x')
    expect(out.blocks).toBeUndefined()
  })

  it('is a no-op on a text cell (no blocks)', () => {
    const cell: SparseCell = { r: 0, c: 0, text: 'plain' }
    const out = demoteToText(cell)
    expect(out).toBe(cell)
    expect(out.text).toBe('plain')
    expect(out.blocks).toBeUndefined()
  })
})

describe('tableCells.demoteWouldLoseData', () => {
  it('returns true when an image block is present', () => {
    const cell: SparseCell = {
      r: 0,
      c: 0,
      blocks: [
        { type: 'paragraph', id: 'p1', text: 'a' },
        { type: 'image', id: 'i1', imageId: 'x' },
      ] as NonNullable<SparseCell['blocks']>,
    }
    expect(demoteWouldLoseData(cell)).toBe(true)
  })

  it('returns false for text-only blocks (paragraph + list)', () => {
    const cell: SparseCell = {
      r: 0,
      c: 0,
      blocks: [
        { type: 'paragraph', id: 'p1', text: 'a' },
        { type: 'list', id: 'l1', style: 'bullet', items: ['b'] },
      ] as NonNullable<SparseCell['blocks']>,
    }
    expect(demoteWouldLoseData(cell)).toBe(false)
  })

  it('returns false when cell has no blocks at all', () => {
    const cell: SparseCell = { r: 0, c: 0, text: 'plain' }
    expect(demoteWouldLoseData(cell)).toBe(false)
  })
})
