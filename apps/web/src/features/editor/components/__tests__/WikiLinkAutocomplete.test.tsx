import { describe, it, expect } from 'vitest'
import {
  detectWikiTrigger,
  buildWikiLinkInsertion,
} from '../WikiLinkAutocomplete'

/**
 * Pure helpers — exercised here without React / DOM. The component itself
 * relies on `Selection` / `Range` which jsdom only partially implements, so
 * the integration behaviour is covered by manual browser testing.
 */
describe('detectWikiTrigger', () => {
  it('returns null when the editable has no `[[`', () => {
    expect(detectWikiTrigger('plain text')).toBeNull()
    expect(detectWikiTrigger('')).toBeNull()
  })

  it('matches a bare `[[` with an empty query', () => {
    const r = detectWikiTrigger('hello [[')
    expect(r).toEqual({ start: 6, query: '' })
  })

  it('matches `[[query` and returns the query string', () => {
    const r = detectWikiTrigger('see [[apple')
    expect(r).toEqual({ start: 4, query: 'apple' })
  })

  it('supports Hangul slugs', () => {
    const r = detectWikiTrigger('본문 [[배터리')
    expect(r?.query).toBe('배터리')
  })

  it('returns the MOST RECENT unclosed `[[`', () => {
    const r = detectWikiTrigger('[[a]] then [[b')
    expect(r).toEqual({ start: 11, query: 'b' })
  })

  it('returns null when a `]` sits between `[[` and the caret', () => {
    // The user typed `[[foo]` — closing bracket disqualifies.
    expect(detectWikiTrigger('[[foo]')).toBeNull()
  })

  it('returns null when a newline sits between `[[` and the caret', () => {
    expect(detectWikiTrigger('[[foo\nbar')).toBeNull()
  })

  it('returns null when the query exceeds 80 chars', () => {
    const long = '[[' + 'a'.repeat(81)
    expect(detectWikiTrigger(long)).toBeNull()
  })

  it('returns null after a fully-closed `[[…]]`', () => {
    expect(detectWikiTrigger('[[foo]] tail')).toBeNull()
  })

  it('returns null when a single `[` precedes the caret (not `[[`)', () => {
    expect(detectWikiTrigger('foo [bar')).toBeNull()
  })
})

describe('buildWikiLinkInsertion', () => {
  it('emits `[[slug]]` when the query is empty', () => {
    expect(buildWikiLinkInsertion('battery', '')).toBe('[[battery]]')
  })

  it('emits `[[slug]]` when the query equals the slug', () => {
    expect(buildWikiLinkInsertion('battery', 'battery')).toBe('[[battery]]')
  })

  it('emits `[[slug|query]]` when the query differs from the slug', () => {
    expect(buildWikiLinkInsertion('battery', 'Battery doc')).toBe(
      '[[battery|Battery doc]]',
    )
  })

  it('trims the query before splicing', () => {
    expect(buildWikiLinkInsertion('battery', '  배터리  ')).toBe(
      '[[battery|배터리]]',
    )
  })

  it('handles Hangul slug + display correctly', () => {
    expect(buildWikiLinkInsertion('배터리', '배터리 개요')).toBe(
      '[[배터리|배터리 개요]]',
    )
  })
})
