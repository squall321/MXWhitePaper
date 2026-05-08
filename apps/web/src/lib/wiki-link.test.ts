import { describe, it, expect } from 'vitest'
import { parseInline } from './wiki-link'

describe('parseInline', () => {
  it('returns plain text as a single text node', () => {
    expect(parseInline('hello world')).toEqual([
      { kind: 'text', value: 'hello world' },
    ])
  })

  it('returns the empty string as a single empty text node', () => {
    expect(parseInline('')).toEqual([{ kind: 'text', value: '' }])
  })

  it('parses a single bare wiki link', () => {
    expect(parseInline('see [[foo-bar]] please')).toEqual([
      { kind: 'text', value: 'see ' },
      { kind: 'wiki', slug: 'foo-bar' },
      { kind: 'text', value: ' please' },
    ])
  })

  it('parses multiple wiki links separated by text', () => {
    expect(parseInline('[[a]] then [[b]] last')).toEqual([
      { kind: 'wiki', slug: 'a' },
      { kind: 'text', value: ' then ' },
      { kind: 'wiki', slug: 'b' },
      { kind: 'text', value: ' last' },
    ])
  })

  it('parses an anchor-only link', () => {
    expect(parseInline('[[foo#1.1.1]]')).toEqual([
      { kind: 'wiki', slug: 'foo', anchor: '1.1.1' },
    ])
  })

  it('parses display-only link', () => {
    expect(parseInline('[[foo|예쁜 라벨]]')).toEqual([
      { kind: 'wiki', slug: 'foo', display: '예쁜 라벨' },
    ])
  })

  it('parses anchor + display together', () => {
    expect(parseInline('[[foo#1.2|보기]]')).toEqual([
      { kind: 'wiki', slug: 'foo', anchor: '1.2', display: '보기' },
    ])
  })

  it('falls through mismatched bracket as text', () => {
    // No closing `]]` → all literal text.
    expect(parseInline('start [[unclosed end')).toEqual([
      { kind: 'text', value: 'start [[unclosed end' },
    ])
  })

  it('rejects an invalid slug and falls through', () => {
    // Capital letters disallowed by the slug RE.
    expect(parseInline('[[BadSlug]]')).toEqual([
      { kind: 'text', value: '[[BadSlug]]' },
    ])
  })

  it('rejects an invalid anchor and falls through', () => {
    // Anchor must be \d+(\.\d+){0,2}.
    expect(parseInline('[[foo#abc]]')).toEqual([
      { kind: 'text', value: '[[foo#abc]]' },
    ])
  })

  it('keeps a valid link adjacent to a malformed one', () => {
    expect(parseInline('[[BAD]] then [[good]] done')).toEqual([
      { kind: 'text', value: '[[BAD]] then ' },
      { kind: 'wiki', slug: 'good' },
      { kind: 'text', value: ' done' },
    ])
  })

  it('parses Hangul slug (Polish D)', () => {
    expect(parseInline('참고 [[월결산]] 와 [[분기결산#1.1|분기]]')).toEqual([
      { kind: 'text', value: '참고 ' },
      { kind: 'wiki', slug: '월결산' },
      { kind: 'text', value: ' 와 ' },
      { kind: 'wiki', slug: '분기결산', anchor: '1.1', display: '분기' },
    ])
  })

  it('parses a same-doc anchor link with the explicit `section-` prefix', () => {
    expect(parseInline('see [[#section-1.1]] above')).toEqual([
      { kind: 'text', value: 'see ' },
      { kind: 'wiki', slug: '', anchor: 'section-1.1' },
      { kind: 'text', value: ' above' },
    ])
  })

  it('parses a same-doc anchor link with a custom display label', () => {
    expect(parseInline('[[#section-1.1|커스텀 라벨]]')).toEqual([
      { kind: 'wiki', slug: '', anchor: 'section-1.1', display: '커스텀 라벨' },
    ])
  })

  it('parses a cross-doc anchor with the explicit `section-` prefix', () => {
    expect(parseInline('[[other#section-2|라벨]]')).toEqual([
      { kind: 'wiki', slug: 'other', anchor: 'section-2', display: '라벨' },
    ])
  })

  it('parses a cross-doc anchor with the explicit `section-` prefix (no label)', () => {
    expect(parseInline('[[other-doc#section-2]]')).toEqual([
      { kind: 'wiki', slug: 'other-doc', anchor: 'section-2' },
    ])
  })

  it('rejects an empty slug without an anchor', () => {
    expect(parseInline('[[#]]')).toEqual([{ kind: 'text', value: '[[#]]' }])
  })

  it('rejects a malformed `section-` anchor and falls through', () => {
    expect(parseInline('[[#section-abc]]')).toEqual([
      { kind: 'text', value: '[[#section-abc]]' },
    ])
  })
})
