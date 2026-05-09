import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { SectionRenderer } from '../SectionRenderer'
import type { Block, SectionLevel1 } from '@/types/document'

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
    id: `READBLOCK${String(i).padStart(16, '0')}`,
    text: `read-line-${i}`,
  }
}

describe('<SectionRenderer /> 가상화 (long doc read mode)', () => {
  it('200개 블록 섹션을 LazyBlockSlot 으로 감싸고 SSR placeholder만 노출한다', () => {
    const section: SectionLevel1 = {
      id: '01READSECLONG0000000000001',
      number: '1',
      level: 1,
      title: '긴 읽기 섹션',
      blocks: Array.from({ length: 200 }, (_, i) => makeBlock(i)),
      subsections: [],
    }

    const html = renderToStaticMarkup(
      <MemoryRouter>
        <SectionRenderer section={section} />
      </MemoryRouter>,
    )

    // Heading still renders.
    expect(html).toContain('id="section-1"')
    expect(html).toContain('긴 읽기 섹션')

    // Every block is wrapped — LazyBlockSlot kicks in over the threshold.
    const slotMatches = html.match(/data-lazy-slot/g) ?? []
    expect(slotMatches.length).toBe(200)

    // Initial SSR: nothing hydrated yet, so no per-block text leaks.
    const unhydrated = html.match(/data-lazy-hydrated="false"/g) ?? []
    expect(unhydrated.length).toBe(200)
    expect(html).not.toMatch(/read-line-\d+/)
  })

  it('짧은 섹션은 placeholder 없이 그대로 렌더한다', () => {
    const section: SectionLevel1 = {
      id: '01READSECSHORT000000000001',
      number: '1',
      level: 1,
      title: '짧은 섹션',
      blocks: [
        { type: 'paragraph', id: 'SHORTBLOCK0000000000000001', text: 'visible' },
      ],
      subsections: [],
    }

    const html = renderToStaticMarkup(
      <MemoryRouter>
        <SectionRenderer section={section} />
      </MemoryRouter>,
    )
    expect(html).not.toContain('data-lazy-slot')
    expect(html).toContain('visible')
  })
})
