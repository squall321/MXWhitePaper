import { describe, it, expect } from 'vitest'
import {
  countDepth,
  stripIndent,
  indentItem,
  outdentItem,
} from '../ListBlockEditor'

describe('ListBlockEditor depth helpers', () => {
  it('countDepth counts leading 2-space pairs', () => {
    expect(countDepth('foo')).toBe(0)
    expect(countDepth('  foo')).toBe(1)
    expect(countDepth('    foo')).toBe(2)
    expect(countDepth('      foo')).toBe(3)
  })

  it('countDepth caps at 4 even when more leading pairs exist', () => {
    expect(countDepth(' '.repeat(20) + 'x')).toBe(4)
  })

  it('countDepth ignores stray single-space prefixes', () => {
    // A single leading space is not a depth pair — counts as 0.
    expect(countDepth(' foo')).toBe(0)
    // 3 leading spaces = 1 full pair + a stray; depth = 1.
    expect(countDepth('   foo')).toBe(1)
  })

  it('stripIndent removes ALL leading 2-space pairs', () => {
    expect(stripIndent('  foo')).toBe('foo')
    expect(stripIndent('    bar')).toBe('bar')
    expect(stripIndent('foo')).toBe('foo')
  })

  it('indentItem prepends one 2-space pair (round-trip with outdentItem)', () => {
    expect(indentItem('foo')).toBe('  foo')
    expect(outdentItem('  foo')).toBe('foo')
    // Round-trip: depth 0 → 1 → 2 → 1 → 0.
    let s = 'hello'
    s = indentItem(s)
    expect(countDepth(s)).toBe(1)
    s = indentItem(s)
    expect(countDepth(s)).toBe(2)
    s = outdentItem(s)
    expect(countDepth(s)).toBe(1)
    s = outdentItem(s)
    expect(countDepth(s)).toBe(0)
    // Already at 0 → outdent is a no-op.
    expect(outdentItem(s)).toBe(s)
  })

  it('indentItem caps at depth 4', () => {
    let s = 'x'
    for (let n = 0; n < 10; n++) s = indentItem(s)
    expect(countDepth(s)).toBe(4)
  })
})
