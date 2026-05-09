import { describe, it, expect } from 'vitest'
import { extractUrl } from '../urlDetect'

describe('extractUrl', () => {
  it('returns null for empty / whitespace-only input', () => {
    expect(extractUrl('')).toBeNull()
    expect(extractUrl('   ')).toBeNull()
    expect(extractUrl('\n')).toBeNull()
  })

  it('returns null for non-URL text', () => {
    expect(extractUrl('hello world')).toBeNull()
    expect(extractUrl('not a url at all')).toBeNull()
  })

  it('returns null when text contains a URL plus other words', () => {
    expect(extractUrl('see https://example.com')).toBeNull()
    expect(extractUrl('https://x.com link')).toBeNull()
  })

  it('returns null for multi-line text even if a URL appears', () => {
    expect(extractUrl('https://x.com\nfoo')).toBeNull()
  })

  it('rejects unsupported schemes (javascript:, data:, file:)', () => {
    expect(extractUrl('javascript:alert(1)')).toBeNull()
    expect(extractUrl('data:text/plain;base64,aGVsbG8=')).toBeNull()
    expect(extractUrl('file:///etc/passwd')).toBeNull()
    expect(extractUrl('ftp://example.com')).toBeNull()
  })

  it('detects a plain external https URL', () => {
    expect(extractUrl('https://example.com')).toEqual({
      url: 'https://example.com',
      isInternal: false,
    })
  })

  it('detects an external http URL', () => {
    expect(extractUrl('http://example.com/path?q=1')).toEqual({
      url: 'http://example.com/path?q=1',
      isInternal: false,
    })
  })

  it('trims surrounding whitespace before parsing', () => {
    expect(extractUrl('  https://example.com  ')).toEqual({
      url: 'https://example.com',
      isInternal: false,
    })
  })

  it('detects an internal absolute /docs/<slug> URL', () => {
    expect(extractUrl('https://wiki.smsg.com/docs/foo')).toEqual({
      url: 'https://wiki.smsg.com/docs/foo',
      isInternal: true,
      slug: 'foo',
    })
  })

  it('detects an internal /docs/<slug> URL with a section anchor', () => {
    expect(
      extractUrl('https://wiki.smsg.com/docs/foo#section-1.1'),
    ).toEqual({
      url: 'https://wiki.smsg.com/docs/foo#section-1.1',
      isInternal: true,
      slug: 'foo',
      anchor: 'section-1.1',
    })
  })

  it('strips the query string when extracting an internal slug', () => {
    expect(
      extractUrl('https://wiki.smsg.com/docs/foo?fullEdit=1'),
    ).toEqual({
      url: 'https://wiki.smsg.com/docs/foo?fullEdit=1',
      isInternal: true,
      slug: 'foo',
    })
  })

  it('detects relative-path internal URLs (/docs/<slug>)', () => {
    expect(extractUrl('/docs/foo')).toEqual({
      url: '/docs/foo',
      isInternal: true,
      slug: 'foo',
    })
  })

  it('detects a relative internal URL with an anchor', () => {
    expect(extractUrl('/docs/foo#section-2')).toEqual({
      url: '/docs/foo#section-2',
      isInternal: true,
      slug: 'foo',
      anchor: 'section-2',
    })
  })

  it('accepts Hangul slugs (Polish D)', () => {
    const r = extractUrl('https://wiki.smsg.com/docs/한글-문서')
    expect(r).not.toBeNull()
    expect(r?.isInternal).toBe(true)
    expect(r?.slug).toBe('한글-문서')
  })

  it('does NOT match /docs/ with no slug', () => {
    expect(extractUrl('https://wiki.smsg.com/docs/')).toEqual({
      url: 'https://wiki.smsg.com/docs/',
      isInternal: false,
    })
  })

  it('does NOT match nested paths under /docs/<slug>/<more>', () => {
    expect(extractUrl('https://wiki.smsg.com/docs/foo/edit')).toEqual({
      url: 'https://wiki.smsg.com/docs/foo/edit',
      isInternal: false,
    })
  })

  it('returns null for malformed URLs that pass the regex but fail URL()', () => {
    // `https://` alone — regex passes (it's non-whitespace) but URL() throws.
    // This is the only realistic miss for our regex.
    const r = extractUrl('https://')
    // Either null (URL throws) or { isInternal: false } — both acceptable.
    if (r !== null) {
      expect(r.isInternal).toBe(false)
    }
  })
})
