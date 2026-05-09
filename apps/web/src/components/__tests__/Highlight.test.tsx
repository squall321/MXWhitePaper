import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Highlight, sanitizeMarkHtml, markText } from '../Highlight'

describe('<Highlight />', () => {
  it('renders the fallback when nothing is supplied', () => {
    const html = renderToStaticMarkup(<Highlight fallback="—" />)
    expect(html).toContain('—')
  })

  it('renders mark tags from html prop', () => {
    const html = renderToStaticMarkup(
      <Highlight html="hello <mark>world</mark>" />,
    )
    expect(html).toMatch(/<mark[^>]*>world<\/mark>/)
    expect(html).toContain('hello')
  })

  it('escapes raw HTML in html prop except for mark/em', () => {
    const html = renderToStaticMarkup(
      <Highlight html="<script>alert(1)</script><mark>ok</mark>" />,
    )
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toMatch(/<mark[^>]*>ok<\/mark>/)
  })

  it('also accepts <em> as a legacy mark token', () => {
    const html = renderToStaticMarkup(
      <Highlight html="abc <em>x</em> def" />,
    )
    expect(html).toMatch(/<mark[^>]*>x<\/mark>/)
  })

  it('marks plain text against terms (case-insensitive)', () => {
    const html = renderToStaticMarkup(
      <Highlight text="Release Notes for KPI" terms={['kpi']} />,
    )
    expect(html).toMatch(/<mark[^>]*>KPI<\/mark>/)
  })

  it('escapes special regex characters in terms', () => {
    const html = renderToStaticMarkup(
      <Highlight text="value (a+b) is here" terms={['(a+b)']} />,
    )
    expect(html).toMatch(/<mark[^>]*>\(a\+b\)<\/mark>/)
  })

  it('returns empty when text and terms are empty', () => {
    const html = renderToStaticMarkup(<Highlight text="" terms={[]} />)
    expect(html).not.toMatch(/<mark/)
  })
})

describe('sanitizeMarkHtml()', () => {
  it('returns empty string for falsy input', () => {
    expect(sanitizeMarkHtml('')).toBe('')
  })

  it('escapes ampersands and quotes', () => {
    const out = sanitizeMarkHtml('a&b "c"')
    expect(out).toContain('&amp;')
    expect(out).toContain('&quot;')
  })
})

describe('markText()', () => {
  it('sorts longer terms first to avoid partial overlap', () => {
    // "release" appears inside "release notes"; without longest-first sort
    // we'd mark "release" first and break the longer match.
    const out = markText('release notes for the team', ['release', 'release notes'])
    expect(out).toMatch(/<mark[^>]*>release notes<\/mark>/)
  })
})
