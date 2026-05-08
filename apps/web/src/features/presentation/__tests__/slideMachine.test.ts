import { describe, expect, it } from 'vitest'
import { buildSlides, keyToNav, navigate } from '../slideMachine'
import type { DocumentJSONV10 } from '@/types/document'

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
    ['n', 'next'],
    ['PageDown', 'next'],
    ['ArrowLeft', 'prev'],
    ['p', 'prev'],
    ['PageUp', 'prev'],
    ['Home', 'first'],
    ['End', 'last'],
  ] as const)('maps %s → %s', (key, expected) => {
    expect(keyToNav({ key })?.type).toBe(expected)
  })

  it('ignores plain alphabet keys', () => {
    expect(keyToNav({ key: 'a' })).toBeNull()
    expect(keyToNav({ key: 'Enter' })).toBeNull()
  })

  it('ignores when modifier key is held (so Cmd-R still reloads)', () => {
    expect(keyToNav({ key: 'ArrowRight', metaKey: true })).toBeNull()
    expect(keyToNav({ key: 'ArrowRight', ctrlKey: true })).toBeNull()
    expect(keyToNav({ key: 'n', altKey: true })).toBeNull()
  })
})
