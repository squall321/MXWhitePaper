import { describe, it, expect } from 'vitest'
import { fuzzyScore, highlightMatches } from '../fuzzyMatch'

describe('fuzzyScore', () => {
  it('returns 0 for empty query', () => {
    expect(fuzzyScore('', 'abc')).toBe(0)
  })

  it('returns 0 for empty candidate', () => {
    expect(fuzzyScore('abc', '')).toBe(0)
  })

  it('rewards consecutive matches over scattered ones', () => {
    // "abc" inside "abcdef" → run of 3 → 1 + 6 = 7
    // "abc" inside "axbxc"  → run of 1 → 1 + 2 = 3
    const tight = fuzzyScore('abc', 'abcdef')
    const loose = fuzzyScore('abc', 'axbxc')
    expect(tight).toBeGreaterThan(loose)
  })

  it('still scores partial matches', () => {
    // "abz" → only "ab" hit; matched/qLen = 2/3, bestRun = 2 → 2/3 + 4
    const s = fuzzyScore('abz', 'abcdef')
    expect(s).toBeGreaterThan(0)
    expect(s).toBeCloseTo(2 / 3 + 4, 6)
  })

  it('is case-insensitive', () => {
    expect(fuzzyScore('ABC', 'abc')).toBe(fuzzyScore('abc', 'ABC'))
  })

  it('handles a single character', () => {
    // matched=1, queryLen=1 → 1/1 = 1; run = 1 → +2 → 3
    expect(fuzzyScore('a', 'apple')).toBeCloseTo(3, 6)
  })

  it('returns 0 when no characters match', () => {
    expect(fuzzyScore('xyz', 'abc')).toBe(0)
  })

  it('orders matches greedily (in order)', () => {
    // "ba" in "abc": only 'a' (after the 'b' search position fails); but
    // greedy left-to-right means b at index 1 matches, then a after index 1
    // is not found → only 1 of 2 matched, run=1, score = 0.5 + 2 = 2.5
    const s = fuzzyScore('ba', 'abc')
    expect(s).toBeCloseTo(0.5 + 2, 6)
  })

  it('penalises gaps via the run multiplier', () => {
    // "kpi" in "kanban-pi" → k at 0, p at 7, i at 8 → run of 2 (p,i)
    // matched=3/3=1, bestRun=2 → 1 + 4 = 5
    expect(fuzzyScore('kpi', 'kanban-pi')).toBeCloseTo(5, 6)
  })

  it('full-string match scores by length', () => {
    // 5 chars exact → matched=5/5=1, run=5 → 1 + 10 = 11
    expect(fuzzyScore('hello', 'hello')).toBeCloseTo(11, 6)
  })
})

describe('highlightMatches', () => {
  it('returns the whole candidate as non-match for empty query', () => {
    expect(highlightMatches('hello', '')).toEqual([
      { text: 'hello', match: false },
    ])
  })

  it('returns empty array for empty candidate', () => {
    expect(highlightMatches('', 'q')).toEqual([])
  })

  it('marks contiguous runs as a single match segment', () => {
    expect(highlightMatches('abcdef', 'abc')).toEqual([
      { text: 'abc', match: true },
      { text: 'def', match: false },
    ])
  })

  it('splits non-contiguous matches into separate segments', () => {
    expect(highlightMatches('axbxc', 'abc')).toEqual([
      { text: 'a', match: true },
      { text: 'x', match: false },
      { text: 'b', match: true },
      { text: 'x', match: false },
      { text: 'c', match: true },
    ])
  })

  it('preserves original case in the output text', () => {
    const segs = highlightMatches('Hello World', 'hw')
    expect(segs.map((s) => s.text).join('')).toBe('Hello World')
    // The "H" segment is matched, the "W" segment is matched.
    expect(segs.find((s) => s.text === 'H')?.match).toBe(true)
    expect(segs.find((s) => s.text === 'W')?.match).toBe(true)
  })

  it('only marks the first occurrence per query char (greedy)', () => {
    // "aa" → both 'a's grabbed by the greedy walk
    expect(highlightMatches('banana', 'aa')).toEqual([
      { text: 'b', match: false },
      { text: 'a', match: true },
      { text: 'n', match: false },
      { text: 'a', match: true },
      { text: 'na', match: false },
    ])
  })

  it('skips unmatchable characters without breaking output', () => {
    // 'z' never appears, so only 'a' marks; result still concatenates back.
    const segs = highlightMatches('apple', 'az')
    expect(segs.map((s) => s.text).join('')).toBe('apple')
    expect(segs.some((s) => s.match)).toBe(true)
  })
})
