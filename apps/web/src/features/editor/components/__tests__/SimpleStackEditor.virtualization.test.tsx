import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { SimpleStackEditor } from '../SimpleStackEditor'
import { useEditorStore } from '@/features/editor/state'
import { useBulkSelectionStore } from '@/features/editor/bulkSelectionStore'
import { __resetMeasuredHeightsForTests } from '../LazyBlockSlot'
import type { Block, DocumentJSONV10, SectionLevel1 } from '@/types/document'

// Stub fetch-y hooks pulled in by BlockRenderer descendants. SSR doesn't
// actually call them but the modules must resolve.
vi.mock('@/features/document/hooks/useDocumentExists', () => ({
  useDocumentExists: () => ({ data: true, isPending: false, isError: false }),
}))
vi.mock('@/features/glossary/useGlossary', () => ({
  useGlossary: () => ({
    terms: [],
    lookup: () => undefined,
    findEntry: () => undefined,
  }),
}))

function makeBlock(i: number): Block {
  return {
    type: 'paragraph',
    id: `BLOCK${String(i).padStart(20, '0')}`,
    text: `unique-line-${i}`,
  }
}

function makeSection(blockCount: number): SectionLevel1 {
  return {
    id: '01SECTIONLONG00000000000001',
    number: '1',
    level: 1,
    title: '긴 섹션',
    blocks: Array.from({ length: blockCount }, (_, i) => makeBlock(i)),
    subsections: [],
  }
}

function makeDoc(section: SectionLevel1): DocumentJSONV10 {
  return {
    schema_version: '1.0',
    id: '01DOCLONG000000000000000001',
    slug: 'long-doc',
    title: 'Long',
    metadata: {
      division: 'eng',
      owners: ['squall'],
      tags: [],
      confidentiality: 'internal',
    },
    sections: [section],
  }
}

beforeEach(() => {
  __resetMeasuredHeightsForTests()
  useEditorStore.getState().reset()
  useBulkSelectionStore.setState({ selected: new Set<string>() })
})

describe('<SimpleStackEditor /> 가상화 (block virtualization)', () => {
  it('100개 블록 섹션은 LazyBlockSlot으로 감싸 모두 placeholder로 시작한다', () => {
    const section = makeSection(100)
    const doc = makeDoc(section)
    useEditorStore.setState({ slug: 'long-doc', etag: 'etag-1', draft: doc })

    const html = renderToStaticMarkup(
      <MemoryRouter>
        <SimpleStackEditor slug="long-doc" section={section} />
      </MemoryRouter>,
    )

    // Every block must be wrapped in a LazyBlockSlot — check the marker.
    const slotMatches = html.match(/data-lazy-slot/g) ?? []
    expect(slotMatches.length).toBe(100)

    // Initial SSR paint: every slot is un-hydrated (no IO callback fired).
    const unhydrated = html.match(/data-lazy-hydrated="false"/g) ?? []
    expect(unhydrated.length).toBe(100)
    const hydrated = html.match(/data-lazy-hydrated="true"/g) ?? []
    expect(hydrated.length).toBe(0)

    // Children are NOT rendered until IO fires — verify no per-block text
    // leaked into the SSR markup. (Hydrated children would emit
    // "unique-line-N" via the paragraph block's content.)
    expect(html).not.toMatch(/unique-line-\d+/)
  })

  it('소형 섹션(블록 ≤ 50)은 가상화를 건너뛰고 즉시 렌더한다', () => {
    const section = makeSection(10)
    const doc = makeDoc(section)
    useEditorStore.setState({ slug: 'long-doc', etag: 'etag-1', draft: doc })

    const html = renderToStaticMarkup(
      <MemoryRouter>
        <SimpleStackEditor slug="long-doc" section={section} />
      </MemoryRouter>,
    )

    // No LazyBlockSlot wrappers when the section is small.
    expect(html).not.toContain('data-lazy-slot')
    // Block content is rendered eagerly.
    expect(html).toContain('unique-line-0')
    expect(html).toContain('unique-line-9')
  })

  it('경계값(51개) 에서는 가상화가 켜진다', () => {
    const section = makeSection(51)
    const doc = makeDoc(section)
    useEditorStore.setState({ slug: 'long-doc', etag: 'etag-1', draft: doc })

    const html = renderToStaticMarkup(
      <MemoryRouter>
        <SimpleStackEditor slug="long-doc" section={section} />
      </MemoryRouter>,
    )
    const slotMatches = html.match(/data-lazy-slot/g) ?? []
    expect(slotMatches.length).toBe(51)
  })

  it('경계값(50개)에서는 가상화가 켜지지 않는다 (LAZY_THRESHOLD = 50)', () => {
    const section = makeSection(50)
    const doc = makeDoc(section)
    useEditorStore.setState({ slug: 'long-doc', etag: 'etag-1', draft: doc })

    const html = renderToStaticMarkup(
      <MemoryRouter>
        <SimpleStackEditor slug="long-doc" section={section} />
      </MemoryRouter>,
    )
    expect(html).not.toContain('data-lazy-slot')
  })
})
