import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { Inline } from '../Inline'

// `useDocumentExists` runs against a real react-query client; stub it here so
// the SSR snapshot is deterministic and doesn't depend on a provider.
vi.mock('@/features/document/hooks/useDocumentExists', () => ({
  useDocumentExists: () => ({ data: true, isPending: false, isError: false }),
}))
// Glossary tooltips wrap plain text fragments — stubbed for SSR.
vi.mock('@/features/glossary/useGlossary', () => ({
  useGlossary: () => ({
    terms: [],
    lookup: () => undefined,
    findEntry: () => undefined,
  }),
}))

function render(text: string): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <Inline text={text} glossary={false} />
    </MemoryRouter>,
  )
}

describe('<Inline /> wiki anchor links', () => {
  it('renders a same-doc anchor `[[#section-1.1]]` with href="#section-1.1"', () => {
    const html = render('see [[#section-1.1]] above')
    expect(html).toContain('href="#section-1.1"')
    // Default label falls back to the literal `#section-1.1` when no draft is
    // bound and no display label is provided.
    expect(html).toContain('#section-1.1')
  })

  it('renders a same-doc anchor with a custom display label', () => {
    const html = render('[[#section-1.1|커스텀 라벨]]')
    expect(html).toContain('href="#section-1.1"')
    expect(html).toContain('커스텀 라벨')
  })

  it('renders a cross-doc anchor with the explicit `section-` prefix', () => {
    const html = render('[[other#section-2|라벨]]')
    expect(html).toContain('href="/docs/other#section-2"')
    expect(html).toContain('라벨')
  })

  it('renders the legacy bare-anchor form unchanged', () => {
    const html = render('[[foo#1.1.1]]')
    expect(html).toContain('href="/docs/foo#section-1.1.1"')
  })

  it('keeps text outside `[[…]]` intact', () => {
    const html = render('a [[#section-1]] b')
    expect(html).toContain('a ')
    expect(html).toContain(' b')
  })
})

describe('<Inline /> pandoc-style footnote references', () => {
  it('renders `[^1]` as a superscript anchor pointing at #fn-1', () => {
    const html = render('이 통계는 2025년 4분기 기준이다 [^1].')
    // `<sup>` wrapper carries the back-link target id.
    expect(html).toContain('id="fnref-1"')
    // `<a>` jumps to the matching definition.
    expect(html).toContain('href="#fn-1"')
    // Visible label is `[1]` (kept human-readable for screen readers).
    expect(html).toContain('[1]')
  })

  it('accepts alphabetic tags (`[^a]`)', () => {
    const html = render('see [^a] above')
    expect(html).toContain('id="fnref-a"')
    expect(html).toContain('href="#fn-a"')
  })

  it('accepts hyphenated tags (`[^my-tag]`)', () => {
    const html = render('see [^my-tag] above')
    expect(html).toContain('id="fnref-my-tag"')
    expect(html).toContain('href="#fn-my-tag"')
  })

  it('does not render `[^x]` inside a code span (code wins)', () => {
    const html = render('`see [^1] in code`')
    // Inside `<code>` the literal `[^1]` survives — no `<sup>` wrapper.
    expect(html).not.toContain('href="#fn-1"')
    expect(html).toContain('[^1]')
  })

  it('leaves malformed footnote-like tokens intact', () => {
    const html = render('a [^] b [^?] c')
    // Empty tag and `?` (not in the alphanumeric/hyphen set) — no anchors.
    expect(html).not.toContain('href="#fn-')
    expect(html).toContain('[^]')
  })
})
