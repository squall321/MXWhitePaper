import { describe, it, expect } from 'vitest'
import { detectTrigger, fetchEmojiCandidates } from '../WikiLinkSuggestion'

describe('detectTrigger', () => {
  it('detects a wiki trigger', () => {
    const m = detectTrigger('hello [[ho')
    expect(m).not.toBeNull()
    expect(m!.kind).toBe('wiki')
    expect(m!.query).toBe('ho')
    expect(m!.consume).toBe(4) // `[[ho`
  })

  it('does not trigger after closing `]]`', () => {
    expect(detectTrigger('done [[abc]] more')).toBeNull()
  })

  it('detects `@user` mention trigger after whitespace', () => {
    const m = detectTrigger('cc @joh')
    expect(m!.kind).toBe('mention')
    expect(m!.query).toBe('joh')
  })

  it('does not trigger inside an email', () => {
    expect(detectTrigger('alice@example')).toBeNull()
  })

  it('detects `:smile` emoji trigger', () => {
    const m = detectTrigger('hi :smi')
    expect(m!.kind).toBe('emoji')
    expect(m!.query).toBe('smi')
  })

  it('returns null for plain text', () => {
    expect(detectTrigger('hello world')).toBeNull()
  })
})

describe('fetchEmojiCandidates', () => {
  it('returns insertText with the glyph', () => {
    const items = fetchEmojiCandidates('smile')
    expect(items.find((i) => i.insertText === '😄')).toBeDefined()
  })
})
