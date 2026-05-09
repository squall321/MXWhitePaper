import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DocDiff } from '@/features/editor/diff/document-diff'
import { DiffSummary } from '../DiffSummary'

function diff(): DocDiff {
  return {
    scalars: [],
    metadata: [],
    infobox: [],
    sections: [
      {
        id: '01SECADDED11111111111111111',
        status: 'added',
        level: 1,
        newTitle: '새 섹션',
        titleChanged: true,
        levelChanged: false,
        blocksChanged: true,
        blockDiffs: [
          {
            id: '01BLKADDED1111111111111111X',
            status: 'added',
            newType: 'paragraph',
            fieldChanges: [],
            baseIndex: -1,
            newIndex: 0,
          },
        ],
        childDiffs: [],
        baseIndex: -1,
        newIndex: 0,
      },
      {
        id: '01SECCHANGED111111111111111',
        status: 'changed',
        level: 1,
        baseTitle: '기존',
        newTitle: '바뀐',
        titleChanged: true,
        levelChanged: false,
        blocksChanged: true,
        blockDiffs: [
          {
            id: '01BLKCHANGED11111111111111X',
            status: 'changed',
            baseType: 'paragraph',
            newType: 'paragraph',
            fieldChanges: ['text'],
            baseIndex: 0,
            newIndex: 0,
          },
          {
            id: '01BLKREMOVED11111111111111X',
            status: 'removed',
            baseType: 'paragraph',
            fieldChanges: [],
            baseIndex: 1,
            newIndex: -1,
          },
        ],
        childDiffs: [],
        baseIndex: 1,
        newIndex: 1,
      },
    ],
    related_documents: { added: [], removed: [], changed: [] },
    glossary: { added: [], removed: [], changed: [] },
    references: { added: [], removed: [], changed: [] },
    see_also: { added: [], removed: [], changed: [] },
  }
}

describe('<DiffSummary />', () => {
  it('renders header + counts of section/block changes', () => {
    const html = renderToStaticMarkup(<DiffSummary diff={diff()} />)
    expect(html).toContain('두 문서 사이의 차이')
    expect(html).toContain('1개 섹션 추가')
    expect(html).toContain('0개 섹션 삭제')
    expect(html).toContain('1개 블록 변경')
  })

  it('lists per-section rows with status glyph', () => {
    const html = renderToStaticMarkup(<DiffSummary diff={diff()} />)
    expect(html).toContain('cross-doc-diff-summary-rows')
    expect(html).toContain('새 섹션')
    expect(html).toContain('바뀐')
    // glyph reflects status
    expect(html).toMatch(/data-row-status="added"/)
    expect(html).toMatch(/data-row-status="changed"/)
  })

  it('renders an empty state when there are no section diffs', () => {
    const empty: DocDiff = {
      scalars: [],
      metadata: [],
      infobox: [],
      sections: [],
      related_documents: { added: [], removed: [], changed: [] },
      glossary: { added: [], removed: [], changed: [] },
      references: { added: [], removed: [], changed: [] },
      see_also: { added: [], removed: [], changed: [] },
    }
    const html = renderToStaticMarkup(<DiffSummary diff={empty} />)
    expect(html).toContain('cross-doc-diff-summary-empty')
    expect(html).toContain('섹션 단위 변경이 없습니다')
  })
})
