import { describe, it, expect } from 'vitest'
import { textToBlocks, looksLikeStructuredText } from '../textToBlocks'
import type { Heading4Block, ListBlock, ParagraphBlock } from '@/types/document'

/** Every block carries a fresh ULID id. */
function expectAllHaveIds(blocks: { id: string }[]): void {
  for (const b of blocks) {
    expect(b.id).toBeTruthy()
    expect(typeof b.id).toBe('string')
  }
}

describe('textToBlocks — list parsing', () => {
  it('numbered list (3 lines) → single list block, style number, 3 items', () => {
    const { blocks } = textToBlocks('1. first\n2. second\n3. third')
    expect(blocks).toHaveLength(1)
    const list = blocks[0] as ListBlock
    expect(list.type).toBe('list')
    expect(list.style).toBe('number')
    expect(list.items).toEqual(['first', 'second', 'third'])
    expectAllHaveIds(blocks)
  })

  it('numbered list with ") " separator → style number', () => {
    const { blocks } = textToBlocks('1) alpha\n2) beta')
    const list = blocks[0] as ListBlock
    expect(list.style).toBe('number')
    expect(list.items).toEqual(['alpha', 'beta'])
  })

  it('bullet list → style bullet', () => {
    const { blocks } = textToBlocks('- one\n* two\n• three')
    expect(blocks).toHaveLength(1)
    const list = blocks[0] as ListBlock
    expect(list.type).toBe('list')
    expect(list.style).toBe('bullet')
    expect(list.items).toEqual(['one', 'two', 'three'])
  })

  it('checkbox list → style check', () => {
    const { blocks } = textToBlocks('[ ] todo\n[x] done\n[X] also done')
    expect(blocks).toHaveLength(1)
    const list = blocks[0] as ListBlock
    expect(list.type).toBe('list')
    expect(list.style).toBe('check')
    expect(list.items).toEqual(['todo', 'done', 'also done'])
  })

  it('nested indentation with tab → "  " prefix per depth', () => {
    const { blocks } = textToBlocks('- parent\n\t- child\n\t\t- grandchild')
    const list = blocks[0] as ListBlock
    expect(list.items).toEqual(['parent', '  child', '    grandchild'])
  })

  it('nested indentation with 2-space → "  " prefix per depth', () => {
    const { blocks } = textToBlocks('- parent\n  - child\n    - grandchild')
    const list = blocks[0] as ListBlock
    expect(list.items).toEqual(['parent', '  child', '    grandchild'])
  })
})

describe('textToBlocks — heading parsing', () => {
  it('markdown ATX headings → heading-4 blocks with level 2/2/3/4', () => {
    const { blocks } = textToBlocks('# h1\n## h2\n### h3\n#### h4')
    expect(blocks).toHaveLength(4)
    const levels = blocks.map((b) => (b as Heading4Block).level)
    const titles = blocks.map((b) => (b as Heading4Block).title)
    expect(blocks.every((b) => b.type === 'heading-4')).toBe(true)
    expect(levels).toEqual([2, 2, 3, 4])
    expect(titles).toEqual(['h1', 'h2', 'h3', 'h4'])
    expectAllHaveIds(blocks)
  })
})

describe('textToBlocks — paragraphs & boundaries', () => {
  it('two blank-line-separated paragraphs → 2 paragraph blocks', () => {
    const { blocks } = textToBlocks('first para line one\nfirst para line two\n\nsecond para')
    expect(blocks).toHaveLength(2)
    expect(blocks.every((b) => b.type === 'paragraph')).toBe(true)
    expect((blocks[0] as ParagraphBlock).text).toBe('first para line one\nfirst para line two')
    expect((blocks[1] as ParagraphBlock).text).toBe('second para')
  })

  it('numbered list + blank line + bullet list → 2 list blocks, different style', () => {
    const { blocks } = textToBlocks('1. n1\n2. n2\n\n- b1\n- b2')
    expect(blocks).toHaveLength(2)
    expect((blocks[0] as ListBlock).style).toBe('number')
    expect((blocks[1] as ListBlock).style).toBe('bullet')
    expect((blocks[0] as ListBlock).items).toEqual(['n1', 'n2'])
    expect((blocks[1] as ListBlock).items).toEqual(['b1', 'b2'])
  })

  it('number → bullet style switch without blank line → 2 list blocks', () => {
    const { blocks } = textToBlocks('1. n1\n2. n2\n- b1\n- b2')
    expect(blocks).toHaveLength(2)
    expect((blocks[0] as ListBlock).style).toBe('number')
    expect((blocks[1] as ListBlock).style).toBe('bullet')
  })

  it('single plain text line → 1 paragraph', () => {
    const { blocks } = textToBlocks('just a single line of text')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.type).toBe('paragraph')
    expect((blocks[0] as ParagraphBlock).text).toBe('just a single line of text')
    expectAllHaveIds(blocks)
  })

  it('empty string → 1 paragraph, no crash', () => {
    const { blocks } = textToBlocks('')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.type).toBe('paragraph')
    expectAllHaveIds(blocks)
  })

  it('whitespace-only string → 1 paragraph, no crash', () => {
    const { blocks } = textToBlocks('   \n  \n\t')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.type).toBe('paragraph')
    expectAllHaveIds(blocks)
  })
})

describe('looksLikeStructuredText', () => {
  it('returns true for a list', () => {
    expect(looksLikeStructuredText('- one\n- two')).toBe(true)
    expect(looksLikeStructuredText('1. one\n2. two')).toBe(true)
    expect(looksLikeStructuredText('[ ] todo')).toBe(true)
  })

  it('returns true for a markdown heading', () => {
    expect(looksLikeStructuredText('# Title\nsome body')).toBe(true)
  })

  it('returns true for 2+ blank-separated paragraphs', () => {
    expect(looksLikeStructuredText('para one\n\npara two')).toBe(true)
  })

  it('returns false for a single plain line', () => {
    expect(looksLikeStructuredText('just one line')).toBe(false)
  })

  it('returns false for a single multi-line paragraph (no blank line)', () => {
    expect(looksLikeStructuredText('line one\nline two\nline three')).toBe(false)
  })
})
