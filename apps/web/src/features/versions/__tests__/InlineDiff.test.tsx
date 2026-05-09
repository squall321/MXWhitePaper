import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type {
  DocumentJSONV10,
  ParagraphBlock,
  SectionLevel1,
} from '@/types/document'
import { InlineDiff } from '../InlineDiff'
import { diffWords, diffLines } from '../lineDiff'

const SEC_A = '01TESTSECAAAAAAAAAAAAAAAA1' as const
const SEC_B = '01TESTSECBBBBBBBBBBBBBBBB2' as const
const BLK_1 = '01TESTBLK1111111111111111X' as const
const BLK_2 = '01TESTBLK2222222222222222Y' as const
const BLK_NEW = '01TESTBLKNNNNNNNNNNNNNNNNW' as const

function p(id: string, text: string): ParagraphBlock {
  return { type: 'paragraph', id, text }
}
function sec(id: string, title: string, blocks: ParagraphBlock[]): SectionLevel1 {
  return { id, level: 1, title, blocks, subsections: [] }
}
function doc(sections: SectionLevel1[]): DocumentJSONV10 {
  return {
    schema_version: '1.0',
    id: '01ROOTROOTROOTROOTROOTROOT',
    slug: 'd',
    title: 'T',
    metadata: {
      division: 'MX',
      owners: ['a'],
      tags: [],
      confidentiality: 'internal',
    },
    sections,
  }
}

describe('lineDiff/diffWords', () => {
  it('marks added words as add', () => {
    const ops = diffWords('hello world', 'hello brave world')
    expect(ops.some((o) => o.kind === 'add' && o.value === 'brave')).toBe(true)
    expect(ops.some((o) => o.kind === 'remove')).toBe(false)
  })
  it('marks removed words as remove', () => {
    const ops = diffWords('hello brave world', 'hello world')
    expect(ops.some((o) => o.kind === 'remove' && o.value === 'brave')).toBe(true)
  })
  it('keeps equal tokens', () => {
    const ops = diffWords('a b c', 'a b c')
    expect(ops.every((o) => o.kind === 'equal')).toBe(true)
  })
})

describe('lineDiff/diffLines', () => {
  it('detects changed line', () => {
    const ops = diffLines('a\nb\nc', 'a\nB\nc')
    expect(ops.some((o) => o.kind === 'remove' && o.value === 'b')).toBe(true)
    expect(ops.some((o) => o.kind === 'add' && o.value === 'B')).toBe(true)
  })
})

describe('<InlineDiff />', () => {
  function render(node: React.ReactNode): string {
    return renderToStaticMarkup(<>{node}</>)
  }

  it('renders empty state when nothing changed', () => {
    const a = doc([sec(SEC_A, 'A', [p(BLK_1, 'hello')])])
    const html = render(<InlineDiff before={a} after={a} />)
    expect(html).toContain('변경 사항이 없습니다')
  })

  it('marks an added block with green background and [+]', () => {
    const before = doc([sec(SEC_A, 'A', [p(BLK_1, 'hello')])])
    const after = doc([
      sec(SEC_A, 'A', [p(BLK_1, 'hello'), p(BLK_NEW, 'brand new')]),
    ])
    const html = render(<InlineDiff before={before} after={after} />)
    expect(html).toContain('data-status="added"')
    expect(html).toContain('brand new')
    expect(html).toContain('[+]')
  })

  it('marks a removed block with strikethrough and [-]', () => {
    const before = doc([
      sec(SEC_A, 'A', [p(BLK_1, 'one'), p(BLK_2, 'two')]),
    ])
    const after = doc([sec(SEC_A, 'A', [p(BLK_1, 'one')])])
    const html = render(<InlineDiff before={before} after={after} />)
    expect(html).toContain('data-status="removed"')
    expect(html).toContain('line-through')
    expect(html).toContain('two')
    expect(html).toContain('[-]')
  })

  it('marks a modified block with yellow background and word-level diff', () => {
    const before = doc([sec(SEC_A, 'A', [p(BLK_1, 'hello world')])])
    const after = doc([sec(SEC_A, 'A', [p(BLK_1, 'hello brave world')])])
    const html = render(<InlineDiff before={before} after={after} />)
    expect(html).toContain('data-status="changed"')
    expect(html).toContain('data-testid="word-diff"')
    // The added word "brave" carries data-op="add"
    expect(html).toContain('data-op="add"')
    expect(html).toContain('brave')
  })

  it('renders an added section with all its blocks marked added', () => {
    const before = doc([sec(SEC_A, 'A', [p(BLK_1, 'one')])])
    const after = doc([
      sec(SEC_A, 'A', [p(BLK_1, 'one')]),
      sec(SEC_B, 'B', [p(BLK_NEW, 'fresh')]),
    ])
    const html = render(<InlineDiff before={before} after={after} />)
    // The new section heading carries the added marker (the text "B" appears
    // after the [+] tag in the same heading element)
    expect(html).toContain('[+]')
    expect(html).toContain('>B</h2>')
    expect(html).toContain('fresh')
  })

  it('renders a removed section even though it is absent in after', () => {
    const before = doc([
      sec(SEC_A, 'A', [p(BLK_1, 'one')]),
      sec(SEC_B, 'B', [p(BLK_NEW, 'doomed')]),
    ])
    const after = doc([sec(SEC_A, 'A', [p(BLK_1, 'one')])])
    const html = render(<InlineDiff before={before} after={after} />)
    expect(html).toContain('doomed')
    expect(html).toContain('data-status="removed"')
  })
})
