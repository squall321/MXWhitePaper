import { describe, it, expect } from 'vitest'
import { estimateReadingTimeMinutes } from '../readingTime'
import type { DocumentJSONV10 } from '@/types/document'

function doc(over: Partial<DocumentJSONV10>): DocumentJSONV10 {
  return {
    schema_version: '1.0',
    id: '01HX0000000000000000000001',
    slug: 't',
    title: '',
    summary: '',
    metadata: {
      division: 'mx',
      owners: ['demo@local'] as [string, ...string[]],
      tags: [],
      confidentiality: 'internal',
    },
    sections: [],
    ...over,
  }
}

describe('estimateReadingTimeMinutes', () => {
  it('returns 0 for an empty document', () => {
    expect(estimateReadingTimeMinutes(doc({}))).toBe(0)
  })

  it('handles pure Korean prose at ~500 chars/min', () => {
    const block = '한'.repeat(2500) // 2500 chars / 500 = 5 min
    const d = doc({
      sections: [
        {
          id: '01HX0000000000000000000010',
          level: 1,
          title: '',
          blocks: [
            {
              type: 'paragraph',
              id: '01HX0000000000000000000011',
              text: block,
            },
          ],
          subsections: [],
        },
      ],
    })
    expect(estimateReadingTimeMinutes(d)).toBe(5)
  })

  it('handles pure English prose at ~200 wpm', () => {
    const words = Array.from({ length: 600 }, () => 'foo').join(' ')
    const d = doc({
      sections: [
        {
          id: '01HX0000000000000000000020',
          level: 1,
          title: '',
          blocks: [
            { type: 'paragraph', id: '01HX0000000000000000000021', text: words },
          ],
          subsections: [],
        },
      ],
    })
    // 600 words / 200 = 3 min
    expect(estimateReadingTimeMinutes(d)).toBe(3)
  })

  it('mixes Korean + English in proportion', () => {
    // 1000 한글 chars (= 2 min Korean) + 200 English words (= 1 min English) = 3 min
    const ko = '가'.repeat(1000)
    const en = Array.from({ length: 200 }, () => 'bar').join(' ')
    const d = doc({
      sections: [
        {
          id: '01HX0000000000000000000030',
          level: 1,
          title: '',
          blocks: [
            { type: 'paragraph', id: '01HX0000000000000000000031', text: `${ko} ${en}` },
          ],
          subsections: [],
        },
      ],
    })
    expect(estimateReadingTimeMinutes(d)).toBe(3)
  })

  it('rounds up tiny prose to at least 1 minute', () => {
    const d = doc({
      sections: [
        {
          id: '01HX0000000000000000000040',
          level: 1,
          title: '짧은 문서',
          blocks: [{ type: 'paragraph', id: '01HX0000000000000000000041', text: '안녕' }],
          subsections: [],
        },
      ],
    })
    expect(estimateReadingTimeMinutes(d)).toBe(1)
  })

  it('walks nested subsections', () => {
    const en = Array.from({ length: 400 }, () => 'baz').join(' ')
    const d = doc({
      sections: [
        {
          id: '01HX0000000000000000000050',
          level: 1,
          title: '',
          blocks: [],
          subsections: [
            {
              id: '01HX0000000000000000000051',
              level: 2,
              title: '',
              blocks: [
                { type: 'paragraph', id: '01HX0000000000000000000052', text: en },
              ],
              subsections: [],
            },
          ],
        },
      ],
    })
    // 400 words / 200 = 2 min
    expect(estimateReadingTimeMinutes(d)).toBe(2)
  })

  it('counts list items, headings, callouts, and quotes', () => {
    const ko = '가'.repeat(500) // 1 min worth
    const d = doc({
      sections: [
        {
          id: '01HX0000000000000000000060',
          level: 1,
          title: '',
          blocks: [
            { type: 'heading-4', id: '01HX0000000000000000000061', title: ko },
            {
              type: 'list',
              id: '01HX0000000000000000000062',
              style: 'bullet',
              items: [ko, ko],
            },
            {
              type: 'callout',
              id: '01HX0000000000000000000063',
              variant: 'info',
              title: ko,
              text: ko,
            },
            {
              type: 'quote',
              id: '01HX0000000000000000000064',
              text: ko,
            },
          ],
          subsections: [],
        },
      ],
    })
    // 6 chunks * 500 chars / 500 cpm = 6 minutes total
    expect(estimateReadingTimeMinutes(d)).toBe(6)
  })

  it('ignores chart / table / code blocks', () => {
    const d = doc({
      sections: [
        {
          id: '01HX0000000000000000000070',
          level: 1,
          title: '',
          blocks: [
            {
              type: 'code',
              id: '01HX0000000000000000000071',
              language: 'python',
              code: 'print("hello world ".repeat(1000))',
            },
            {
              type: 'table',
              id: '01HX0000000000000000000072',
              headers: ['x', 'y'],
              rows: [['1', '2']],
            },
          ],
          subsections: [],
        },
      ],
    })
    expect(estimateReadingTimeMinutes(d)).toBe(0)
  })
})
