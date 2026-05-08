import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { SectionRenderer } from '../SectionRenderer'
import type { SectionLevel1 } from '@/types/document'

// Stub the existence hook so `<WikiLink>` always renders the blue variant
// without going near the real fetch layer or TanStack Query.
vi.mock('@/features/document/hooks/useDocumentExists', () => ({
  useDocumentExists: () => ({ data: true, isPending: false, isError: false }),
}))
// Same: stub the glossary hook used by Inline so SSR tests don't need a
// QueryClientProvider.
vi.mock('@/features/glossary/useGlossary', () => ({
  useGlossary: () => ({
    terms: [],
    lookup: () => undefined,
    findEntry: () => undefined,
  }),
}))

describe('<SectionRenderer />', () => {
  it('renders a section heading and a wiki link inside a paragraph block', () => {
    const section: SectionLevel1 = {
      id: '01ABCDEFGHJKMNPQRSTVWXYZ12',
      number: '1',
      level: 1,
      title: '개요',
      blocks: [
        {
          type: 'paragraph',
          id: '01ABCDEFGHJKMNPQRSTVWXYZ34',
          text: '월결산은 [[foo]]의 선행 작업이다.',
        },
      ],
      subsections: [],
    }

    const html = renderToStaticMarkup(
      <MemoryRouter>
        <SectionRenderer section={section} />
      </MemoryRouter>,
    )

    // Heading uses the `section-<number>` id for permalink anchoring.
    expect(html).toContain('id="section-1"')
    expect(html).toContain('개요')

    // Wiki link points at /docs/foo (no anchor specified) and uses the blue
    // variant (`text-link`).
    expect(html).toContain('href="/docs/foo"')
    expect(html).toContain('text-link')
    expect(html).not.toContain('text-link-missing')
  })

  it('hides children when the section is collapsed via the store', async () => {
    // Reset modules so the store starts fresh for this test (we use SSR
    // markup and read only what's rendered, so the collapsed branch shows up
    // only when the store reports collapsed=true at render time).
    vi.resetModules()
    vi.doMock('@/features/document/hooks/useDocumentExists', () => ({
      useDocumentExists: () => ({ data: true, isPending: false, isError: false }),
    }))
    vi.doMock('@/features/glossary/useGlossary', () => ({
      useGlossary: () => ({
        terms: [],
        lookup: () => undefined,
        findEntry: () => undefined,
      }),
    }))
    const { SectionRenderer: SR } = await import('../SectionRenderer')
    const { useSectionCollapseStore } = await import(
      '@/features/editor/sectionCollapseStore'
    )

    const section: SectionLevel1 = {
      id: '01ABCDEFGHJKMNPQRSTVWXYZ90',
      number: '3',
      level: 1,
      title: '접힘 섹션',
      blocks: [
        {
          type: 'paragraph',
          id: '01ABCDEFGHJKMNPQRSTVWXYZ91',
          text: '이 텍스트는 접혔을 때 보이지 않아야 한다.',
        },
      ],
      subsections: [],
    }

    // Pre-collapse the section in the store.
    useSectionCollapseStore.getState().setCollapsed('test-slug', section.id, true)

    const html = renderToStaticMarkup(
      <MemoryRouter>
        <SR section={section} collapseSlug="test-slug" />
      </MemoryRouter>,
    )

    // Heading still rendered.
    expect(html).toContain('접힘 섹션')
    // Hint shows the direct block count.
    expect(html).toContain('1개 항목 접힘')
    // Body text is hidden.
    expect(html).not.toContain('이 텍스트는 접혔을 때')
    // Toggle button reports aria-expanded="false".
    expect(html).toContain('aria-expanded="false"')

    // Cleanup so other tests start clean.
    useSectionCollapseStore.getState().expandAll('test-slug')
  })

  it('renders a missing-link variant when the existence hook returns false', async () => {
    // Re-stub the hook for this test only.
    vi.resetModules()
    vi.doMock('@/features/document/hooks/useDocumentExists', () => ({
      useDocumentExists: () => ({ data: false, isPending: false, isError: false }),
    }))
    const { SectionRenderer: SR } = await import('../SectionRenderer')

    const section: SectionLevel1 = {
      id: '01ABCDEFGHJKMNPQRSTVWXYZ56',
      number: '2',
      level: 1,
      title: '참고',
      blocks: [
        {
          type: 'paragraph',
          id: '01ABCDEFGHJKMNPQRSTVWXYZ78',
          text: '비교: [[bar#1.2]]',
        },
      ],
      subsections: [],
    }

    const html = renderToStaticMarkup(
      <MemoryRouter>
        <SR section={section} />
      </MemoryRouter>,
    )

    expect(html).toContain('text-link-missing')
    // WikiLink now sends users to the dedicated `/docs/new` wizard prefilled
    // with the missing slug instead of a `?create=1` query on the empty doc.
    expect(html).toContain('/docs/new?slug=bar')
  })
})
