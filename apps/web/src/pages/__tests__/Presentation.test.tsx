import { describe, it, expect } from 'vitest'
import { buildSlides } from '@/features/presentation/slideMachine'
import type { DocumentJSONV10 } from '@/types/document'

/**
 * The Presentation page itself depends on react-router's `useParams` and a
 * fully-wired `useDocument`; running it through SSR would require stubbing
 * everything those touch. The robustness rules we care about live in
 * `buildSlides()` plus the empty-state branches the component renders, so
 * we exercise the pure helper directly.
 */
describe('Presentation buildSlides() robustness', () => {
  const META = {
    division: '',
    team: '',
    group: '',
    part: '',
    confidentiality: 'C2' as const,
    tags: [] as string[],
  }

  it('returns just the title slide when sections array is empty', () => {
    const doc = {
      schema_version: '1.0' as const,
      id: '01TESTABCDE0000000000DOC00',
      slug: 'empty',
      title: 'Empty Doc',
      summary: 'no sections',
      metadata: META,
      sections: [],
    } as unknown as DocumentJSONV10
    const slides = buildSlides(doc)
    expect(slides).toHaveLength(1)
    expect(slides[0]?.kind).toBe('title')
  })

  it('tolerates a null doc without throwing', () => {
    const slides = buildSlides(null as unknown as DocumentJSONV10)
    expect(Array.isArray(slides)).toBe(true)
    expect(slides).toHaveLength(0)
  })

  it('tolerates missing sections array', () => {
    const doc = {
      schema_version: '1.0',
      id: '01X',
      slug: 'x',
      title: 'X',
      summary: '',
      metadata: META,
    } as unknown as DocumentJSONV10
    const slides = buildSlides(doc)
    expect(slides).toHaveLength(1)
  })

  it('tolerates missing tags in metadata (slide.meta.tags is always an array)', () => {
    const doc = {
      schema_version: '1.0',
      id: '01Y',
      slug: 'y',
      title: 'Y',
      summary: '',
      metadata: {} as unknown as DocumentJSONV10['metadata'],
      sections: [],
    } as unknown as DocumentJSONV10
    const slides = buildSlides(doc)
    expect(slides[0]?.kind).toBe('title')
    if (slides[0]?.kind === 'title') {
      expect(Array.isArray(slides[0].meta.tags)).toBe(true)
    }
  })

  it('skips null sections without throwing', () => {
    const doc = {
      schema_version: '1.0',
      id: '01Z',
      slug: 'z',
      title: 'Z',
      summary: '',
      metadata: META,
      sections: [null, undefined, { id: 'sec-1', level: 1, title: 'A', number: '1', blocks: [] }],
    } as unknown as DocumentJSONV10
    const slides = buildSlides(doc)
    // 1 title + 1 valid section
    expect(slides).toHaveLength(2)
    expect(slides[1]?.kind).toBe('section')
  })
})
