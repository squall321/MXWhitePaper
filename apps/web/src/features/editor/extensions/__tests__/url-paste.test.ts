import { describe, it, expect } from 'vitest'
import { isUrl, decideUrlPaste, extractInternalSlug } from '../url-paste'

describe('isUrl', () => {
  it('accepts http and https URLs', () => {
    expect(isUrl('http://example.com')).toBe(true)
    expect(isUrl('https://example.com/path?q=1')).toBe(true)
  })
  it('rejects multi-token strings', () => {
    expect(isUrl('https://example.com and more')).toBe(false)
  })
  it('rejects bare text', () => {
    expect(isUrl('hello world')).toBe(false)
  })
})

describe('extractInternalSlug', () => {
  it('returns slug from a relative path', () => {
    expect(extractInternalSlug('/docs/hello-world')).toBe('hello-world')
  })
  it('returns slug from a same-origin URL', () => {
    expect(
      extractInternalSlug('https://app.example.com/docs/hello', 'https://app.example.com'),
    ).toBe('hello')
  })
  it('rejects different-origin URLs', () => {
    expect(
      extractInternalSlug('https://other.example.com/docs/hello', 'https://app.example.com'),
    ).toBeNull()
  })
  it('rejects non-/docs paths', () => {
    expect(extractInternalSlug('/something/else')).toBeNull()
  })
})

describe('decideUrlPaste', () => {
  it('wraps selection on URL paste', () => {
    const r = decideUrlPaste({
      text: 'https://example.com',
      selection: '문서',
    })
    expect(r.kind).toBe('wrap')
    expect(r.href).toBe('https://example.com')
  })

  it('proposes wikilink for internal URL with no selection', () => {
    const r = decideUrlPaste({
      text: '/docs/hello-world',
      selection: '',
      origin: 'https://app.example.com',
    })
    expect(r.kind).toBe('wikilink')
    expect(r.slug).toBe('hello-world')
  })

  it('falls through to plain link for external URL with no selection', () => {
    const r = decideUrlPaste({
      text: 'https://google.com',
      selection: '',
      origin: 'https://app.example.com',
    })
    expect(r.kind).toBe('link')
  })

  it('returns none for non-URL text', () => {
    const r = decideUrlPaste({ text: 'hello world', selection: '' })
    expect(r.kind).toBe('none')
  })
})
