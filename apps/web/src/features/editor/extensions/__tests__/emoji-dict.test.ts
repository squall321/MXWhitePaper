import { describe, it, expect } from 'vitest'
import { findEmoji, lookupEmoji, EMOJI_DICT } from '../emoji-dict'

describe('emoji-dict', () => {
  it('exports a non-trivial dictionary (≥100 entries)', () => {
    expect(EMOJI_DICT.length).toBeGreaterThanOrEqual(100)
  })

  it('lookupEmoji returns the glyph for an exact code', () => {
    expect(lookupEmoji('smile')).toBe('😄')
    expect(lookupEmoji('SMILE')).toBe('😄')
    expect(lookupEmoji('rocket')).toBe('🚀')
  })

  it('lookupEmoji returns null for unknown codes', () => {
    expect(lookupEmoji('not_a_real_emoji_xx')).toBeNull()
  })

  it('findEmoji prefix-matches "smi" → :smile:', () => {
    const out = findEmoji('smi', 5)
    expect(out.find((e) => e.code === 'smile')).toBeDefined()
  })

  it('findEmoji aliases work — "thanks" → :pray:', () => {
    const out = findEmoji('thanks', 5)
    expect(out.find((e) => e.code === 'pray')).toBeDefined()
  })

  it('every entry has a glyph string of length ≥ 1', () => {
    for (const e of EMOJI_DICT) {
      expect(e.code.length).toBeGreaterThan(0)
      expect(e.glyph.length).toBeGreaterThan(0)
    }
  })
})
