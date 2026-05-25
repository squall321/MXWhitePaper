import { describe, expect, it } from 'vitest'
import {
  buildSlides,
  chunkBlocksForSlides,
  keyToNav,
  navigate,
  speakerNotesFor,
  splitSpeakerNotes,
} from '../slideMachine'
import type { Block, DocumentJSONV10 } from '@/types/document'

function makeDoc(overrides: Partial<DocumentJSONV10> = {}): DocumentJSONV10 {
  return {
    schema_version: '1.0',
    id: '01TESTDOC0000000000000000Z',
    slug: 'fixture',
    title: '테스트 덱',
    summary: 'summary',
    metadata: {
      division: 'MX',
      owners: ['x@example.com'],
      tags: ['t1', 't2'],
      confidentiality: 'internal',
    },
    sections: [
      {
        id: '01SEC00000000000000000000A',
        number: '1',
        level: 1,
        title: '섹션 1',
        blocks: [
          { type: 'paragraph', id: '01P000000000000000000000A1', text: 'p1' },
        ],
        subsections: [
          {
            id: '01SUB00000000000000000001',
            number: '1.1',
            level: 2,
            title: '섹션 1.1',
            blocks: [],
            subsections: [],
          },
        ],
      },
      {
        id: '01SEC00000000000000000000B',
        number: '2',
        level: 1,
        title: '섹션 2',
        blocks: [],
        subsections: [],
      },
    ],
    ...overrides,
  }
}

describe('buildSlides', () => {
  it('always emits a title slide first', () => {
    const slides = buildSlides(makeDoc())
    const first = slides[0]
    expect(first?.kind).toBe('title')
    if (first && first.kind === 'title') {
      expect(first.title).toBe('테스트 덱')
      expect(first.meta.tags).toEqual(['t1', 't2'])
    }
  })

  it('flat mode: 1 title + 1 per level-1 section', () => {
    const slides = buildSlides(makeDoc())
    expect(slides).toHaveLength(3)
    expect(slides.slice(1).every((s) => s.kind === 'section')).toBe(true)
  })

  it('nested mode: skips empty level-2 subsections (presentation-layout cycle)', () => {
    // sec 1.1 has empty blocks → was previously a blank "에디터 파트 R&R" slide
    // (audit captured slide 3). After A1 fix: empty nested subsections are
    // dropped. Result: title + sec1 + sec2 = 3.
    const slides = buildSlides(makeDoc(), { nested: true })
    expect(slides).toHaveLength(3)
    const numbers = slides
      .filter((s): s is Extract<(typeof slides)[number], { kind: 'section' }> => s.kind === 'section')
      .map((s) => s.number)
    expect(numbers).toEqual(['1', '2'])
  })

  it('nested mode: level-2 subsection with body content still emitted', () => {
    const doc = makeDoc()
    doc.sections[0]!.subsections![0]!.blocks = [
      { type: 'paragraph', id: '01P000000000000000000000S1', text: 'sub content' },
    ]
    const slides = buildSlides(doc, { nested: true })
    // title + sec1 + sec1.1 (has content now) + sec2 = 4
    expect(slides).toHaveLength(4)
    const numbers = slides
      .filter((s): s is Extract<(typeof slides)[number], { kind: 'section' }> => s.kind === 'section')
      .map((s) => s.number)
    expect(numbers).toEqual(['1', '1.1', '2'])
  })

  it('flat mode: level-1 section with empty blocks still gets a slide (chapter divider)', () => {
    // sec 2 has empty blocks but is level 1 — should remain as a chapter
    // divider slide. Only level-2 empty subsections are skipped.
    const slides = buildSlides(makeDoc())
    expect(slides).toHaveLength(3)
    const sectionSlides = slides.filter(
      (s): s is Extract<(typeof slides)[number], { kind: 'section' }> => s.kind === 'section',
    )
    expect(sectionSlides.map((s) => s.number)).toEqual(['1', '2'])
  })

  it('handles empty section trees', () => {
    const slides = buildSlides(
      makeDoc({ sections: [] as DocumentJSONV10['sections'] }),
    )
    expect(slides).toHaveLength(1)
    expect(slides[0]?.kind).toBe('title')
  })
})

describe('navigate', () => {
  it('clamps next at last index, prev at 0', () => {
    expect(navigate(0, 3, { type: 'next' })).toBe(1)
    expect(navigate(2, 3, { type: 'next' })).toBe(2)
    expect(navigate(0, 3, { type: 'prev' })).toBe(0)
    expect(navigate(2, 3, { type: 'prev' })).toBe(1)
  })

  it('first / last jump to bounds', () => {
    expect(navigate(2, 5, { type: 'first' })).toBe(0)
    expect(navigate(2, 5, { type: 'last' })).toBe(4)
  })

  it('goto clamps within range', () => {
    expect(navigate(0, 5, { type: 'goto', index: -3 })).toBe(0)
    expect(navigate(0, 5, { type: 'goto', index: 99 })).toBe(4)
    expect(navigate(0, 5, { type: 'goto', index: 2 })).toBe(2)
  })

  it('handles total = 0 / 1 without going negative', () => {
    expect(navigate(0, 0, { type: 'next' })).toBe(0)
    expect(navigate(0, 1, { type: 'next' })).toBe(0)
    expect(navigate(0, 1, { type: 'last' })).toBe(0)
  })
})

describe('keyToNav', () => {
  it.each([
    ['ArrowRight', 'next'],
    [' ', 'next'],
    ['PageDown', 'next'],
    ['ArrowLeft', 'prev'],
    ['PageUp', 'prev'],
    ['Home', 'first'],
    ['End', 'last'],
  ] as const)('maps %s → %s', (key, expected) => {
    expect(keyToNav({ key })?.type).toBe(expected)
  })

  it('digit 1..9 maps to goto N-1', () => {
    const result = keyToNav({ key: '1' })
    expect(result?.type).toBe('goto')
    if (result?.type === 'goto') expect(result.index).toBe(0)
    const r5 = keyToNav({ key: '5' })
    if (r5?.type === 'goto') expect(r5.index).toBe(4)
  })

  it('does not treat n/p as navigation (reserved for notes pane)', () => {
    expect(keyToNav({ key: 'n' })).toBeNull()
    expect(keyToNav({ key: 'N' })).toBeNull()
    expect(keyToNav({ key: 'p' })).toBeNull()
    expect(keyToNav({ key: 'P' })).toBeNull()
  })

  it('ignores plain alphabet keys', () => {
    expect(keyToNav({ key: 'a' })).toBeNull()
    expect(keyToNav({ key: 'Enter' })).toBeNull()
  })

  it('ignores when modifier key is held (so Cmd-R still reloads)', () => {
    expect(keyToNav({ key: 'ArrowRight', metaKey: true })).toBeNull()
    expect(keyToNav({ key: 'ArrowRight', ctrlKey: true })).toBeNull()
    expect(keyToNav({ key: '1', altKey: true })).toBeNull()
  })
})

describe('speaker notes', () => {
  function para(id: string, text: string, note?: string): Block {
    return { type: 'paragraph', id: id as Block extends { id: infer I } ? I : never, text, ...(note ? { meta: { note } } : {}) } as Block
  }

  it('splitSpeakerNotes separates body and notes preserving order', () => {
    const blocks: Block[] = [
      para('01P000000000000000000000A1', 'visible 1'),
      para('01P000000000000000000000A2', 'note 1', 'speaker:1'),
      para('01P000000000000000000000A3', 'visible 2'),
      para('01P000000000000000000000A4', 'note 2', 'speaker-note'),
    ]
    const { body, notes } = splitSpeakerNotes(blocks)
    expect(body.map((b) => (b.type === 'paragraph' ? b.text : ''))).toEqual([
      'visible 1',
      'visible 2',
    ])
    expect(notes.map((b) => (b.type === 'paragraph' ? b.text : ''))).toEqual([
      'note 1',
      'note 2',
    ])
  })

  it('splitSpeakerNotes ignores other meta.note values (e.g., page-break-before)', () => {
    const blocks: Block[] = [
      para('01P000000000000000000000B1', 'visible'),
      para('01P000000000000000000000B2', '', 'page-break-before'),
      para('01P000000000000000000000B3', 'note', 'speaker:5'),
    ]
    const { body, notes } = splitSpeakerNotes(blocks)
    expect(body.length).toBe(2)
    expect(notes.length).toBe(1)
  })

  it('speakerNotesFor concatenates notes with blank-line separators', () => {
    const doc = makeDoc({
      sections: [
        {
          id: '01SEC00000000000000000000A',
          number: '1',
          level: 1,
          title: 'sec',
          blocks: [
            para('01P000000000000000000000C1', 'body'),
            para('01P000000000000000000000C2', 'first', 'speaker:1'),
            para('01P000000000000000000000C3', 'second', 'speaker:2'),
          ],
          subsections: [],
        },
      ] as DocumentJSONV10['sections'],
    })
    const slides = buildSlides(doc)
    const sectionSlide = slides.find((s) => s.kind === 'section')!
    expect(speakerNotesFor(sectionSlide)).toBe('first\n\nsecond')
  })

  it('speakerNotesFor returns "" for title slides', () => {
    const slides = buildSlides(makeDoc())
    const titleSlide = slides[0]!
    expect(speakerNotesFor(titleSlide)).toBe('')
  })
})

/* ── 자동 분할 (autoSplit) ────────────────────────────────────────────────── */

describe('chunkBlocksForSlides', () => {
  // 헬퍼: 긴 paragraph (charLen 글자) 생성.
  const longPara = (id: string, charLen: number): Block => ({
    type: 'paragraph',
    id,
    text: 'x'.repeat(charLen),
  })
  const chart = (id: string): Block => ({
    type: 'chart',
    id,
    data: { columns: [{ key: 'a', label: 'A', type: 'number' }], rows: [] },
  } as unknown as Block)

  it('빈 입력은 빈 배열', () => {
    expect(chunkBlocksForSlides([])).toEqual([])
  })

  it('작은 본문은 1 청크로 유지 (기존 동작 보존)', () => {
    const blocks = [longPara('p1', 50), longPara('p2', 100)]
    const out = chunkBlocksForSlides(blocks)
    expect(out).toHaveLength(1)
    expect(out[0]).toHaveLength(2)
  })

  it('누적 weight 가 budget 초과하면 새 청크', () => {
    // 각 ~300 글자 paragraph 5 개 → 누적 ~1500 — 2 개 이상 청크.
    const blocks = Array.from({ length: 5 }, (_, i) => longPara(`p${i}`, 300))
    const out = chunkBlocksForSlides(blocks)
    expect(out.length).toBeGreaterThan(1)
    // 모든 블록이 정확히 한 번씩 등장.
    expect(out.flat()).toHaveLength(5)
  })

  it('solo-visual (chart 등) 은 자기만의 청크', () => {
    const blocks = [longPara('p1', 50), chart('c1'), longPara('p2', 50)]
    const out = chunkBlocksForSlides(blocks)
    // 3 청크: [p1+c1 캡션], [p2] ... 실제론 chart 가 자기 청크, 직전 p1 캡션처럼 같이.
    // 결과: [[p1, c1], [p2]] 또는 [[p1, c1], [p2]] 형태.
    expect(out).toEqual([[blocks[0], blocks[1]], [blocks[2]]])
  })

  it('solo-visual 직전이 paragraph 아니면 단독으로', () => {
    const blocks = [chart('c1'), chart('c2')]
    const out = chunkBlocksForSlides(blocks)
    expect(out).toEqual([[blocks[0]], [blocks[1]]])
  })

  it('단일 블록이 budget 초과해도 분할 안 함', () => {
    // 한 블록만 있으면 무게 무관하게 단독 청크.
    const huge = longPara('p1', 5000)
    const out = chunkBlocksForSlides([huge])
    expect(out).toHaveLength(1)
    expect(out[0]).toEqual([huge])
  })

  it('solo-visual 직전 heading-4 도 캡션으로 흡수 (slide-3 follow-up)', () => {
    const heading = { type: 'heading-4', id: 'h1', title: '에디터 파트 R&R' } as unknown as Block
    const c = chart('c1')
    const out = chunkBlocksForSlides([heading, c])
    expect(out).toEqual([[heading, c]])
  })

  it('solo-visual 직전 (heading-4 + paragraph) 페어도 함께 (소제목 + 한 줄 + 시각자료)', () => {
    const heading = { type: 'heading-4', id: 'h1', title: '제목' } as unknown as Block
    const p: Block = { type: 'paragraph', id: 'p1', text: '짧은 설명' } as Block
    const c = chart('c1')
    const out = chunkBlocksForSlides([heading, p, c])
    expect(out).toEqual([[heading, p, c]])
  })
})

describe('buildSlides — autoSplit 통합', () => {
  // 큰 섹션 본문 → 여러 SectionSlide 로.
  const para = (id: string, charLen: number): Block => ({
    type: 'paragraph',
    id,
    text: 'x'.repeat(charLen),
  })

  it('autoSplit (기본 true) — 본문이 길면 continuation 슬라이드 생성', () => {
    const doc: DocumentJSONV10 = {
      schema_version: '1.0',
      id: '01TESTDOC0000000000000000Z',
      slug: 'fixture',
      title: '덱',
      summary: '',
      metadata: {
        division: 'MX',
        owners: ['x@example.com'],
        tags: [],
        confidentiality: 'internal',
      },
      sections: [
        {
          id: '01SEC00000000000000000000A',
          number: '1',
          level: 1,
          title: '긴 섹션',
          blocks: Array.from({ length: 8 }, (_, i) => para(`p${i}`, 300)),
          subsections: [],
        },
      ] as DocumentJSONV10['sections'],
    }
    const slides = buildSlides(doc)
    const sectionSlides = slides.filter((s) => s.kind === 'section')
    expect(sectionSlides.length).toBeGreaterThan(1)
    // 각각 totalContinuations 가 동일해야.
    const totals = new Set(
      sectionSlides
        .map((s) => (s.kind === 'section' ? s.totalContinuations : null))
        .filter(Boolean),
    )
    expect(totals.size).toBe(1)
    // 첫 번째는 continuation=0, 그 다음 1, 2... 순차.
    sectionSlides.forEach((s, i) => {
      if (s.kind === 'section') {
        expect(s.continuation).toBe(i)
        expect(Array.isArray(s.bodyBlocks)).toBe(true)
      }
    })
  })

  it('autoSplit=false 면 한 섹션은 1 슬라이드 (legacy)', () => {
    const doc: DocumentJSONV10 = {
      schema_version: '1.0',
      id: '01TESTDOC0000000000000000Z',
      slug: 'fixture',
      title: '덱',
      summary: '',
      metadata: {
        division: 'MX',
        owners: ['x@example.com'],
        tags: [],
        confidentiality: 'internal',
      },
      sections: [
        {
          id: '01SEC00000000000000000000A',
          number: '1',
          level: 1,
          title: '긴 섹션',
          blocks: Array.from({ length: 8 }, (_, i) => para(`p${i}`, 300)),
          subsections: [],
        },
      ] as DocumentJSONV10['sections'],
    }
    const slides = buildSlides(doc, { autoSplit: false })
    expect(slides.filter((s) => s.kind === 'section')).toHaveLength(1)
  })

  it('작은 섹션은 분할 없이 1 슬라이드 (bodyBlocks 미정 = legacy 렌더)', () => {
    const doc: DocumentJSONV10 = {
      schema_version: '1.0',
      id: '01TESTDOC0000000000000000Z',
      slug: 'fixture',
      title: '덱',
      summary: '',
      metadata: {
        division: 'MX',
        owners: ['x@example.com'],
        tags: [],
        confidentiality: 'internal',
      },
      sections: [
        {
          id: '01SEC00000000000000000000A',
          number: '1',
          level: 1,
          title: '짧은 섹션',
          blocks: [para('p1', 50), para('p2', 80)],
          subsections: [],
        },
      ] as DocumentJSONV10['sections'],
    }
    const slides = buildSlides(doc)
    const sectionSlides = slides.filter((s) => s.kind === 'section')
    expect(sectionSlides).toHaveLength(1)
    // 분할 없음 → bodyBlocks / continuation 미정 (legacy 호환).
    const s = sectionSlides[0]!
    if (s.kind === 'section') {
      expect(s.bodyBlocks).toBeUndefined()
      expect(s.continuation).toBeUndefined()
    }
  })
})
