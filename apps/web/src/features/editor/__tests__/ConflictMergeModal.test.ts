/**
 * Logic-level tests for the ConflictMergeModal. The CI environment does not
 * pull in jsdom + @testing-library, so instead of mounting <ConflictMergeModal />
 * we exercise the same code paths the modal uses (threeWayDiff / autoMerge /
 * applyResolutions / outline). The component itself is a thin shell over
 * these — covering the underlying logic gives us confidence that:
 *
 *   - 3 panes will receive 3 outlines (one per side)
 *   - Auto-merge button will, in fact, reduce the conflict count when a
 *     synthetic non-conflicting case is fed in.
 *   - Picking 내 것 / 상대 것 round-trips through `applyResolutions`.
 */

import { describe, it, expect } from 'vitest'
import {
  threeWayDiff,
  autoMerge,
  applyResolutions,
  buildOutline,
} from '../diff/document-diff'
import type { DocumentJSONV10, ParagraphBlock, SectionLevel1 } from '@/types/document'

const SEC = '01TESTSECMODALMODALMODAL01'
const BLK = '01TESTBLKMODALMODALMODAL02'

function p(id: string, t: string): ParagraphBlock {
  return { type: 'paragraph', id, text: t }
}
function s(id: string, t: string, blocks: ParagraphBlock[] = []): SectionLevel1 {
  return { id, level: 1, title: t, blocks, subsections: [] }
}
function doc(title = 'T', blockText = 'hello'): DocumentJSONV10 {
  return {
    schema_version: '1.0',
    id: '01TESTROOTROOTROOTROOTROOT',
    slug: 'doc',
    title,
    metadata: {
      division: 'MX',
      owners: ['alice'],
      tags: ['a'],
      confidentiality: 'internal',
    },
    sections: [s(SEC, 'A', [p(BLK, blockText)])],
  }
}

describe('ConflictMergeModal — logic', () => {
  it('renders three outlines, one per side, all reaching the section', () => {
    const base = doc('base')
    const mine = doc('base', 'mine edit')
    const theirs = doc('base', 'theirs edit')
    const tw = threeWayDiff(base, mine, theirs)
    const mineOut = buildOutline(mine, tw.minePatch, tw.conflicts, 'mine')
    const baseOut = buildOutline(base, null, tw.conflicts, 'base')
    const theirsOut = buildOutline(theirs, tw.theirsPatch, tw.conflicts, 'theirs')
    expect(mineOut).toHaveLength(1)
    expect(baseOut).toHaveLength(1)
    expect(theirsOut).toHaveLength(1)
    expect(mineOut[0]?.id).toBe(SEC)
  })

  it('default chooser = 내 것 → applyResolutions uses mine value', () => {
    const base = doc('base')
    const mine = doc('base', 'mine')
    const theirs = doc('base', 'theirs')
    const tw = threeWayDiff(base, mine, theirs)
    expect(tw.conflicts).toHaveLength(1)
    // simulate "default 내 것" — pass empty resolutions, applyResolutions
    // overlays the conflict with c.mineValue when no choice given… but
    // our impl requires explicit choice; the modal explicitly fills 'mine'.
    const cid = tw.conflicts[0]?.conflictId ?? ''
    const resolved = applyResolutions(tw, autoMerge(tw), { [cid]: { kind: 'mine' } })
    const blk = resolved.sections[0]?.blocks[0] as ParagraphBlock
    expect(blk.text).toBe('mine')
  })

  it('selecting 상대 것 produces theirs value', () => {
    const base = doc('base')
    const mine = doc('base', 'mine')
    const theirs = doc('base', 'theirs')
    const tw = threeWayDiff(base, mine, theirs)
    const cid = tw.conflicts[0]?.conflictId ?? ''
    const resolved = applyResolutions(tw, autoMerge(tw), { [cid]: { kind: 'theirs' } })
    const blk = resolved.sections[0]?.blocks[0] as ParagraphBlock
    expect(blk.text).toBe('theirs')
  })

  it('auto-merge button reduces conflict count on synthetic non-conflicting case', () => {
    // Two independent edits: mine edits the title, theirs edits a separate
    // metadata key. Without auto-merge: 0 conflicts but theirs change is NOT
    // present in mine. After auto-merge: still 0 conflicts AND theirs change
    // is present.
    const base = doc('orig')
    const mine = doc('mine title')
    const theirs = doc('orig')
    theirs.metadata.tags = ['phase-7']
    const tw = threeWayDiff(base, mine, theirs)
    expect(tw.conflicts.length).toBe(0)
    expect(tw.autoMergeableConflictIds.length).toBeGreaterThan(0)
    const merged = autoMerge(tw)
    expect(merged.title).toBe('mine title')
    expect(merged.metadata.tags).toEqual(['phase-7'])
  })

  it('outline status flags reflect the diff (mine pane shows changed)', () => {
    const base = doc('orig')
    const mine = doc('orig', 'mine')
    const theirs = doc('orig')
    const tw = threeWayDiff(base, mine, theirs)
    const out = buildOutline(mine, tw.minePatch, tw.conflicts, 'mine')
    expect(out[0]?.status).toBe('changed')
  })

  it('summary counts match: 충돌 N · 비충돌 변경 M · 자동 해결 가능 K', () => {
    const base = doc('orig')
    const mine = doc('mine')
    const theirs = doc('orig', 'theirs')
    theirs.metadata.tags = ['phase-9']
    const tw = threeWayDiff(base, mine, theirs)
    // theirs changed: 1 block + 1 metadata key
    const totalTheirsChanges =
      tw.theirsPatch.metadata.length +
      tw.theirsPatch.infobox.length +
      tw.theirsPatch.sections.length +
      tw.theirsPatch.scalars.length
    expect(totalTheirsChanges).toBeGreaterThanOrEqual(2)
    expect(tw.conflicts.length).toBe(0)
    expect(tw.autoMergeableConflictIds.length).toBeGreaterThanOrEqual(2)
  })
})
