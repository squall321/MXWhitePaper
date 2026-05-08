import { describe, it, expect } from 'vitest'
import { documentJsonToBlockNote, blockNoteToDocumentJson } from '../adapters'
import type { Block } from '@/types/document'

const sampleBlocks: Block[] = [
  { type: 'paragraph', id: '01ABCDEF000000000000000001', text: '안녕하세요' },
  { type: 'heading-4', id: '01ABCDEF000000000000000002', title: '제목 4' },
  {
    type: 'list',
    id: '01ABCDEF000000000000000003',
    style: 'bullet',
    items: ['첫째', '둘째', '셋째'],
  },
  {
    type: 'callout',
    id: '01ABCDEF000000000000000004',
    variant: 'warn',
    title: '주의',
    text: '조심하세요',
  },
  {
    type: 'code',
    id: '01ABCDEF000000000000000005',
    language: 'python',
    code: 'print("hi")',
  },
  {
    type: 'quote',
    id: '01ABCDEF000000000000000006',
    text: '인용문',
    cite: '저자',
  },
  // A type that BlockNote can't render — should round-trip via docJsonRaw.
  {
    type: 'chart',
    id: '01ABCDEF000000000000000007',
    chartType: 'bar',
    data: { labels: ['A', 'B'], series: [{ name: 's', values: [1, 2] }] },
  },
]

describe('editor/adapters', () => {
  it('round-trips paragraph / heading-4 / list / callout / code / quote', () => {
    const bn = documentJsonToBlockNote(sampleBlocks.slice(0, 6))
    const back = blockNoteToDocumentJson(bn)
    expect(back).toHaveLength(6)
    expect(back[0]).toMatchObject({ type: 'paragraph', text: '안녕하세요' })
    expect(back[1]).toMatchObject({ type: 'heading-4', title: '제목 4' })
    expect(back[2]).toMatchObject({ type: 'list', style: 'bullet' })
    // The list adapter is greedy; first item content survives.
    expect((back[2] as { items: string[] }).items[0]).toBe('첫째')
    expect(back[3]).toMatchObject({ type: 'callout', variant: 'warn', text: '조심하세요' })
    expect(back[4]).toMatchObject({ type: 'code', language: 'python' })
    expect(back[5]).toMatchObject({ type: 'quote', cite: '저자' })
  })

  it('preserves placeholder block types via docJsonRaw round-trip', () => {
    const bn = documentJsonToBlockNote([sampleBlocks[6]!])
    const back = blockNoteToDocumentJson(bn)
    expect(back[0]).toEqual(sampleBlocks[6])
  })

  it('produces a non-empty BlockNote tree from a non-empty doc', () => {
    const bn = documentJsonToBlockNote(sampleBlocks)
    expect(bn.length).toBeGreaterThan(0)
    // Each emitted node carries an id so React keys remain stable.
    for (const n of bn) expect(typeof n.id).toBe('string')
  })

  it('handles an empty input', () => {
    expect(documentJsonToBlockNote([])).toEqual([])
    expect(blockNoteToDocumentJson([])).toEqual([])
  })
})
