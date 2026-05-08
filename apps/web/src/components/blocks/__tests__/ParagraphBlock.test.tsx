import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { ParagraphBlockView, parseFootnoteDefinition } from '../ParagraphBlock'
import type { ParagraphBlock } from '@/types/document'

// Stub the glossary hook used by `<Inline>` so SSR tests don't need a
// QueryClientProvider.
vi.mock('@/features/glossary/useGlossary', () => ({
  useGlossary: () => ({
    terms: [],
    lookup: () => undefined,
    findEntry: () => undefined,
  }),
}))
vi.mock('@/features/document/hooks/useDocumentExists', () => ({
  useDocumentExists: () => ({ data: true, isPending: false, isError: false }),
}))

function render(block: ParagraphBlock): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <ParagraphBlockView block={block} />
    </MemoryRouter>,
  )
}

describe('parseFootnoteDefinition', () => {
  it('extracts tag + body from `[^N]: text`', () => {
    expect(parseFootnoteDefinition('[^1]: 출처 본문')).toEqual({
      tag: '1',
      body: '출처 본문',
    })
  })

  it('accepts hyphenated tags', () => {
    expect(parseFootnoteDefinition('[^src-1]: hello')).toEqual({
      tag: 'src-1',
      body: 'hello',
    })
  })

  it('returns null for non-definition text', () => {
    expect(parseFootnoteDefinition('이 단락은 [^1] 참조만 가진다.')).toBeNull()
    expect(parseFootnoteDefinition('plain text')).toBeNull()
    // Missing space after `:` — not a definition.
    expect(parseFootnoteDefinition('[^1]:no-space')).toBeNull()
  })
})

describe('<ParagraphBlockView /> footnote handling', () => {
  it('renders a normal paragraph through the inline parser', () => {
    const html = render({
      type: 'paragraph',
      id: '01ABCDEFGHJKMNPQRSTVWXY001',
      text: '이 통계는 2025년 4분기 기준이다 [^1].',
    })
    // Inline `[^1]` becomes a superscript reference (Inline is exercised).
    expect(html).toContain('href="#fn-1"')
    expect(html).toContain('id="fnref-1"')
    expect(html).toContain('이 통계는 2025년 4분기 기준이다')
  })

  it('hides paragraphs that ARE pure footnote definitions', () => {
    // SectionRenderer collects definitions and renders them at the section
    // bottom. The source paragraph is suppressed here to avoid duplication.
    const html = render({
      type: 'paragraph',
      id: '01ABCDEFGHJKMNPQRSTVWXY002',
      text: '[^1]: 출처 — 2025 Q4 KPI dashboard.',
    })
    expect(html).toBe('')
  })

  it('keeps the page-break marker untouched', () => {
    const html = render({
      type: 'paragraph',
      id: '01ABCDEFGHJKMNPQRSTVWXY003',
      text: '',
      meta: { note: 'page-break-before' },
    })
    expect(html).toContain('페이지 나누기')
  })
})
