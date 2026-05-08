import { describe, it, expect } from 'vitest'
import { isMathBlock, detectInlineMath } from '../math-shortcut'

describe('isMathBlock', () => {
  it('detects $$ ... $$ block', () => {
    const r = isMathBlock('$$\nf(x) = x^2\n$$')
    expect(r.yes).toBe(true)
    if (r.yes) expect(r.expression).toBe('f(x) = x^2')
  })
  it('rejects empty block', () => {
    expect(isMathBlock('$$$$').yes).toBe(false)
  })
  it('rejects single-dollar block', () => {
    expect(isMathBlock('$x$').yes).toBe(false)
  })
})

describe('detectInlineMath', () => {
  it('finds one inline math token', () => {
    const out = detectInlineMath('hello $x^2$ world')
    expect(out.length).toBe(1)
    expect(out[0]!.expression).toBe('x^2')
  })
  it('finds multiple inline tokens', () => {
    const out = detectInlineMath('$a$ and $b$')
    expect(out.length).toBe(2)
  })
  it('ignores unterminated dollar', () => {
    const out = detectInlineMath('hello $x^2 world')
    expect(out.length).toBe(0)
  })
})
