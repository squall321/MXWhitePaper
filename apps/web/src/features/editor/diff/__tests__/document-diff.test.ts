import { describe, it, expect } from 'vitest'
import {
  diffDocument,
  threeWayDiff,
  autoMerge,
  applyResolutions,
  deepEqual,
} from '../document-diff'
import type { DocumentJSONV10, ParagraphBlock, SectionLevel1 } from '@/types/document'

const SEC_A = '01TESTSECAAAAAAAAAAAAAAAA1' as const
const SEC_B = '01TESTSECBBBBBBBBBBBBBBBB2' as const
const BLK_1 = '01TESTBLK1111111111111111X' as const
const BLK_2 = '01TESTBLK2222222222222222Y' as const
const BLK_3 = '01TESTBLK3333333333333333Z' as const

function paragraph(id: string, text: string): ParagraphBlock {
  return { type: 'paragraph', id, text }
}

function section(id: string, title: string, blocks: ParagraphBlock[] = []): SectionLevel1 {
  return { id, level: 1, title, blocks, subsections: [] }
}

function baseDoc(): DocumentJSONV10 {
  return {
    schema_version: '1.0',
    id: '01ROOTROOTROOTROOTROOTROOT',
    slug: 'doc',
    title: 'Original Title',
    metadata: {
      division: 'MX',
      owners: ['alice'],
      tags: ['phase-1'],
      confidentiality: 'internal',
    },
    sections: [
      section(SEC_A, 'A', [paragraph(BLK_1, 'hello'), paragraph(BLK_2, 'world')]),
      section(SEC_B, 'B', [paragraph(BLK_3, 'foo')]),
    ],
  }
}

function getSec(doc: DocumentJSONV10, id: string): SectionLevel1 {
  const s = doc.sections.find((x) => x.id === id)
  if (!s) throw new Error(`section ${id} not found`)
  return s
}

describe('diff/deepEqual', () => {
  it('handles primitives, arrays, nested objects', () => {
    expect(deepEqual({ a: [1, 2, { b: 3 }] }, { a: [1, 2, { b: 3 }] })).toBe(true)
    expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false)
    expect(deepEqual([1, 2], [1, 2, 3])).toBe(false)
    expect(deepEqual(null, undefined)).toBe(false)
    expect(deepEqual(undefined, undefined)).toBe(true)
  })
})

describe('diff/diffDocument (2-way)', () => {
  it('identical documents produce an empty diff', () => {
    const d = diffDocument(baseDoc(), baseDoc())
    expect(d.scalars).toHaveLength(0)
    expect(d.metadata).toHaveLength(0)
    expect(d.infobox).toHaveLength(0)
    expect(d.sections).toHaveLength(0)
  })

  it('detects metadata key change', () => {
    const a = baseDoc()
    const b = baseDoc()
    b.metadata.tags = ['phase-2']
    const d = diffDocument(a, b)
    expect(d.metadata).toHaveLength(1)
    expect(d.metadata[0]?.key).toBe('tags')
    expect(d.metadata[0]?.status).toBe('changed')
  })

  it('detects section title change', () => {
    const a = baseDoc()
    const b = baseDoc()
    getSec(b, SEC_A).title = 'A — renamed'
    const d = diffDocument(a, b)
    expect(d.sections).toHaveLength(1)
    expect(d.sections[0]?.id).toBe(SEC_A)
    expect(d.sections[0]?.titleChanged).toBe(true)
  })

  it('detects section added on next side', () => {
    const a = baseDoc()
    const b = baseDoc()
    b.sections.push(section('01NEWSECNEWSECNEWSEC000001', 'C'))
    const d = diffDocument(a, b)
    const added = d.sections.filter((s) => s.status === 'added')
    expect(added).toHaveLength(1)
  })

  it('detects section removed on next side', () => {
    const a = baseDoc()
    const b = baseDoc()
    b.sections = [getSec(b, SEC_A)] // drop SEC_B
    const d = diffDocument(a, b)
    const removed = d.sections.filter((s) => s.status === 'removed')
    expect(removed).toHaveLength(1)
    expect(removed[0]?.id).toBe(SEC_B)
  })

  it('detects block field change inside a section', () => {
    const a = baseDoc()
    const b = baseDoc()
    getSec(b, SEC_A).blocks[0] = paragraph(BLK_1, 'hello — edited')
    const d = diffDocument(a, b)
    const sec = d.sections.find((s) => s.id === SEC_A)
    expect(sec?.blocksChanged).toBe(true)
    expect(sec?.blockDiffs[0]?.fieldChanges).toContain('text')
  })

  it('list diff: glossary added/removed/changed', () => {
    const a = baseDoc()
    a.glossary = [{ term: 'DPS', definition: 'Defects Per Million' }]
    const b = baseDoc()
    b.glossary = [
      { term: 'DPS', definition: 'Defects Per Sample' }, // changed
      { term: 'OEE', definition: 'Overall Equipment Effectiveness' }, // added
    ]
    const d = diffDocument(a, b)
    expect(d.glossary.added.map((g) => g.term)).toEqual(['OEE'])
    expect(d.glossary.changed.map((c) => c.key)).toEqual(['DPS'])
    expect(d.glossary.removed).toHaveLength(0)
  })
})

describe('diff/threeWayDiff', () => {
  it('only mine changed → no conflict, theirs autoMergeable empty', () => {
    const base = baseDoc()
    const mine = baseDoc()
    mine.title = 'Mine title'
    const theirs = baseDoc()
    const tw = threeWayDiff(base, mine, theirs)
    expect(tw.conflicts).toHaveLength(0)
    expect(tw.autoMergeableConflictIds).toHaveLength(0)
  })

  it('only theirs changed → no conflict, theirs change is autoMergeable', () => {
    const base = baseDoc()
    const mine = baseDoc()
    const theirs = baseDoc()
    theirs.metadata.tags = ['phase-3']
    const tw = threeWayDiff(base, mine, theirs)
    expect(tw.conflicts).toHaveLength(0)
    expect(tw.autoMergeableConflictIds).toContain('metadata::tags')
  })

  it('both changed same section title → conflict surfaced', () => {
    const base = baseDoc()
    const mine = baseDoc()
    getSec(mine, SEC_A).title = 'A from me'
    const theirs = baseDoc()
    getSec(theirs, SEC_A).title = 'A from them'
    const tw = threeWayDiff(base, mine, theirs)
    expect(tw.conflicts.some((c) => c.scope === 'section.title')).toBe(true)
  })

  it('both changed same block text → block-scope conflict', () => {
    const base = baseDoc()
    const mine = baseDoc()
    getSec(mine, SEC_A).blocks[0] = paragraph(BLK_1, 'mine text')
    const theirs = baseDoc()
    getSec(theirs, SEC_A).blocks[0] = paragraph(BLK_1, 'theirs text')
    const tw = threeWayDiff(base, mine, theirs)
    expect(tw.conflicts.some((c) => c.scope === 'block' && c.path === `block/${BLK_1}`)).toBe(true)
  })

  it('both changed metadata.tags differently → metadata conflict', () => {
    const base = baseDoc()
    const mine = baseDoc()
    mine.metadata.tags = ['phase-2']
    const theirs = baseDoc()
    theirs.metadata.tags = ['phase-3']
    const tw = threeWayDiff(base, mine, theirs)
    expect(tw.conflicts.some((c) => c.scope === 'metadata' && c.path === 'metadata.tags')).toBe(true)
  })

  it('mine removes section that theirs edited → presence conflict', () => {
    const base = baseDoc()
    const mine = baseDoc()
    mine.sections = [getSec(mine, SEC_A)] // drop SEC_B
    const theirs = baseDoc()
    getSec(theirs, SEC_B).title = 'B edited'
    const tw = threeWayDiff(base, mine, theirs)
    expect(tw.conflicts.some((c) => c.scope === 'section.presence')).toBe(true)
  })

  it('infobox key conflict surfaces', () => {
    const base = baseDoc()
    base.infobox = { '담당': '홍길동' }
    const mine = baseDoc()
    mine.infobox = { '담당': '김철수' }
    const theirs = baseDoc()
    theirs.infobox = { '담당': '이영희' }
    const tw = threeWayDiff(base, mine, theirs)
    expect(tw.conflicts.some((c) => c.scope === 'infobox' && c.path === 'infobox.담당')).toBe(true)
  })
})

describe('diff/autoMerge', () => {
  it('applies theirs-only metadata change onto mine', () => {
    const base = baseDoc()
    const mine = baseDoc()
    mine.title = 'Mine title' // mine changes title
    const theirs = baseDoc()
    theirs.metadata.tags = ['phase-3'] // theirs changes tags
    const tw = threeWayDiff(base, mine, theirs)
    const merged = autoMerge(tw)
    expect(merged.title).toBe('Mine title')
    expect(merged.metadata.tags).toEqual(['phase-3'])
  })

  it('replaces a theirs-only-changed block onto mine', () => {
    const base = baseDoc()
    const mine = baseDoc()
    getSec(mine, SEC_A).blocks[1] = paragraph(BLK_2, 'mine edit world')
    const theirs = baseDoc()
    getSec(theirs, SEC_A).blocks[0] = paragraph(BLK_1, 'theirs edit hello')
    const tw = threeWayDiff(base, mine, theirs)
    const merged = autoMerge(tw)
    expect(tw.conflicts).toHaveLength(0)
    const blk1 = getSec(merged, SEC_A).blocks.find((b) => b.id === BLK_1) as ParagraphBlock
    const blk2 = getSec(merged, SEC_A).blocks.find((b) => b.id === BLK_2) as ParagraphBlock
    expect(blk1.text).toBe('theirs edit hello')
    expect(blk2.text).toBe('mine edit world')
  })

  it('does NOT touch a block that mine also changed', () => {
    const base = baseDoc()
    const mine = baseDoc()
    getSec(mine, SEC_A).blocks[0] = paragraph(BLK_1, 'mine')
    const theirs = baseDoc()
    getSec(theirs, SEC_A).blocks[0] = paragraph(BLK_1, 'theirs')
    const tw = threeWayDiff(base, mine, theirs)
    const merged = autoMerge(tw)
    // block stays at mine's version because conflict
    const blk1 = getSec(merged, SEC_A).blocks.find((b) => b.id === BLK_1) as ParagraphBlock
    expect(blk1.text).toBe('mine')
  })
})

describe('diff/applyResolutions', () => {
  it('user picks "theirs" for a block conflict → final doc has theirs value', () => {
    const base = baseDoc()
    const mine = baseDoc()
    getSec(mine, SEC_A).blocks[0] = paragraph(BLK_1, 'mine')
    const theirs = baseDoc()
    getSec(theirs, SEC_A).blocks[0] = paragraph(BLK_1, 'theirs')
    const tw = threeWayDiff(base, mine, theirs)
    const conflictId = tw.conflicts[0]?.conflictId ?? ''
    const resolved = applyResolutions(tw, autoMerge(tw), {
      [conflictId]: { kind: 'theirs' },
    })
    const blk1 = getSec(resolved, SEC_A).blocks.find((b) => b.id === BLK_1) as ParagraphBlock
    expect(blk1.text).toBe('theirs')
  })

  it('user picks "mine" for metadata → metadata stays as mine', () => {
    const base = baseDoc()
    const mine = baseDoc()
    mine.metadata.tags = ['from-me']
    const theirs = baseDoc()
    theirs.metadata.tags = ['from-them']
    const tw = threeWayDiff(base, mine, theirs)
    const cId = tw.conflicts[0]?.conflictId ?? ''
    const resolved = applyResolutions(tw, autoMerge(tw), {
      [cId]: { kind: 'mine' },
    })
    expect(resolved.metadata.tags).toEqual(['from-me'])
  })
})
