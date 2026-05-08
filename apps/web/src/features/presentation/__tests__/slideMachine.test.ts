import { describe, expect, it } from 'vitest'
import {
  buildSlides,
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

  it('nested mode: also includes level-2 subsections', () => {
    const slides = buildSlides(makeDoc(), { nested: true })
    // title + sec1 + sec1.1 + sec2 = 4
    expect(slides).toHaveLength(4)
    const numbers = slides
      .filter((s): s is Extract<(typeof slides)[number], { kind: 'section' }> => s.kind === 'section')
      .map((s) => s.number)
    expect(numbers).toEqual(['1', '1.1', '2'])
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
