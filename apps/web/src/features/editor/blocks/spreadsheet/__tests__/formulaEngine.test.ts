import { describe, it, expect } from 'vitest'
import {
  parseRef,
  refOf,
  expandRange,
  evaluateCell,
  evaluateAll,
} from '../formulaEngine'

describe('parseRef', () => {
  it('parses A1 → {col:0,row:0}', () => {
    expect(parseRef('A1')).toEqual({ col: 0, row: 0 })
  })

  it('parses C5 → {col:2,row:4}', () => {
    expect(parseRef('C5')).toEqual({ col: 2, row: 4 })
  })

  it('parses Z200 → last column / large row', () => {
    expect(parseRef('Z200')).toEqual({ col: 25, row: 199 })
  })

  it('rejects multi-letter columns (>Z)', () => {
    expect(parseRef('AA1')).toBeNull()
  })

  it('rejects garbage / lowercase', () => {
    expect(parseRef('foo')).toBeNull()
    expect(parseRef('a1')).toBeNull()
    expect(parseRef('1A')).toBeNull()
  })
})

describe('refOf', () => {
  it('inverse of parseRef', () => {
    expect(refOf(0, 0)).toBe('A1')
    expect(refOf(2, 4)).toBe('C5')
  })
})

describe('expandRange', () => {
  it('expands A1:B3 in row-major order', () => {
    expect(expandRange('A1', 'B3')).toEqual([
      'A1',
      'B1',
      'A2',
      'B2',
      'A3',
      'B3',
    ])
  })

  it('expands single cell A1:A1', () => {
    expect(expandRange('A1', 'A1')).toEqual(['A1'])
  })

  it('handles reversed corners', () => {
    expect(expandRange('B3', 'A1')).toEqual([
      'A1',
      'B1',
      'A2',
      'B2',
      'A3',
      'B3',
    ])
  })

  it('rejects invalid endpoints', () => {
    expect(expandRange('AA1', 'B2')).toBeNull()
  })
})

describe('evaluateCell — non-formula values', () => {
  it('returns empty for empty raw', () => {
    expect(evaluateCell('', {})).toEqual({ value: '' })
  })

  it('returns string text as string', () => {
    expect(evaluateCell('hello', {})).toEqual({ value: 'hello' })
  })

  it('coerces a numeric raw to a number', () => {
    expect(evaluateCell('42', {})).toEqual({ value: 42 })
    expect(evaluateCell('3.14', {})).toEqual({ value: 3.14 })
  })
})

describe('evaluateCell — operators', () => {
  it('+', () => {
    expect(evaluateCell('=1+2', {})).toEqual({ value: 3 })
  })
  it('-', () => {
    expect(evaluateCell('=10-3', {})).toEqual({ value: 7 })
  })
  it('*', () => {
    expect(evaluateCell('=4*5', {})).toEqual({ value: 20 })
  })
  it('/', () => {
    expect(evaluateCell('=20/4', {})).toEqual({ value: 5 })
  })
  it('%', () => {
    expect(evaluateCell('=10%3', {})).toEqual({ value: 1 })
  })
  it('respects precedence', () => {
    expect(evaluateCell('=2+3*4', {})).toEqual({ value: 14 })
  })
  it('respects parentheses', () => {
    expect(evaluateCell('=(2+3)*4', {})).toEqual({ value: 20 })
  })
  it('handles unary minus', () => {
    expect(evaluateCell('=-5+10', {})).toEqual({ value: 5 })
    expect(evaluateCell('=-(2*3)', {})).toEqual({ value: -6 })
  })
  it('returns #DIV/0! on /0', () => {
    expect(evaluateCell('=1/0', {})).toEqual({ value: '', error: '#DIV/0!' })
  })
  it('returns #DIV/0! on %0', () => {
    expect(evaluateCell('=1%0', {})).toEqual({ value: '', error: '#DIV/0!' })
  })
})

describe('evaluateCell — cell refs', () => {
  it('reads a number from another cell', () => {
    expect(evaluateCell('=A1', { A1: '7' })).toEqual({ value: 7 })
  })
  it('adds two refs', () => {
    expect(evaluateCell('=A1+B1', { A1: '3', B1: '4' })).toEqual({ value: 7 })
  })
  it('treats missing ref as 0', () => {
    expect(evaluateCell('=A1+5', {})).toEqual({ value: 5 })
  })
  it('chains formulas through refs', () => {
    expect(evaluateCell('=A1+1', { A1: '=B1*2', B1: '5' })).toEqual({
      value: 11,
    })
  })
  it('returns #VALUE! when string + number', () => {
    expect(evaluateCell('=A1+1', { A1: 'hello' })).toMatchObject({
      error: '#VALUE!',
    })
  })
  it('detects cycles with #CYCLE!', () => {
    const cells = { A1: '=B1', B1: '=A1' }
    expect(evaluateCell(cells.A1, cells)).toMatchObject({ error: '#CYCLE!' })
  })
})

describe('evaluateCell — functions', () => {
  it('SUM range', () => {
    expect(
      evaluateCell('=SUM(A1:A3)', { A1: '1', A2: '2', A3: '3' }),
    ).toEqual({ value: 6 })
  })
  it('SUM individual args', () => {
    expect(evaluateCell('=SUM(1,2,3,4)', {})).toEqual({ value: 10 })
  })
  it('SUM mixes refs and ranges', () => {
    expect(
      evaluateCell('=SUM(A1:A2,5)', { A1: '1', A2: '2' }),
    ).toEqual({ value: 8 })
  })
  it('AVG = SUM/COUNT', () => {
    expect(
      evaluateCell('=AVG(A1:A3)', { A1: '2', A2: '4', A3: '6' }),
    ).toEqual({ value: 4 })
  })
  it('AVERAGE alias', () => {
    expect(evaluateCell('=AVERAGE(2,4,6)', {})).toEqual({ value: 4 })
  })
  it('AVG of empty range → #DIV/0!', () => {
    expect(evaluateCell('=AVG(A1:A3)', {})).toMatchObject({
      error: '#DIV/0!',
    })
  })
  it('MIN', () => {
    expect(evaluateCell('=MIN(3,1,2)', {})).toEqual({ value: 1 })
  })
  it('MAX', () => {
    expect(evaluateCell('=MAX(3,1,2)', {})).toEqual({ value: 3 })
  })
  it('COUNT only counts numerics', () => {
    expect(
      evaluateCell('=COUNT(A1:A4)', {
        A1: '1',
        A2: 'hello',
        A3: '3',
        A4: '',
      }),
    ).toEqual({ value: 2 })
  })
  it('IF — truthy branch', () => {
    expect(evaluateCell('=IF(1, 10, 20)', {})).toEqual({ value: 10 })
  })
  it('IF — falsy branch', () => {
    expect(evaluateCell('=IF(0, 10, 20)', {})).toEqual({ value: 20 })
  })
  it('IF — no else branch returns empty', () => {
    expect(evaluateCell('=IF(0, 10)', {})).toEqual({ value: '' })
  })
  it('ROUND', () => {
    expect(evaluateCell('=ROUND(3.14159, 2)', {})).toEqual({ value: 3.14 })
  })
  it('ROUND with default digits=0', () => {
    expect(evaluateCell('=ROUND(3.6)', {})).toEqual({ value: 4 })
  })
  it('CONCAT — concatenates strings & numbers', () => {
    expect(evaluateCell('=CONCAT("a", 1, "b")', {})).toEqual({ value: 'a1b' })
  })
  it('CONCAT with cell refs', () => {
    expect(
      evaluateCell('=CONCAT(A1, "-", A2)', { A1: 'x', A2: 'y' }),
    ).toEqual({ value: 'x-y' })
  })
  it('nested SUM(SUM(...), x)', () => {
    expect(evaluateCell('=SUM(SUM(1,2),3,4)', {})).toEqual({ value: 10 })
  })
  it('nested IF + ROUND', () => {
    expect(evaluateCell('=ROUND(IF(1, 3.14, 0), 1)', {})).toEqual({
      value: 3.1,
    })
  })
})

describe('evaluateCell — errors', () => {
  it('rejects unknown function as #ERR!', () => {
    expect(evaluateCell('=NOPE(1)', {})).toMatchObject({ error: '#ERR!' })
  })
  it('rejects malformed ref → #REF! is caught from parser', () => {
    // `AA1` looks like an ident but isn't a valid ref.
    expect(evaluateCell('=AA1+1', {})).toMatchObject({ error: '#REF!' })
  })
  it('rejects garbage syntax', () => {
    expect(evaluateCell('=1+', {})).toMatchObject({ error: '#ERR!' })
    expect(evaluateCell('=(1+2', {})).toMatchObject({ error: '#ERR!' })
  })
})

describe('evaluateAll', () => {
  it('returns a result for every populated cell', () => {
    const out = evaluateAll({
      A1: '1',
      A2: '2',
      A3: '=A1+A2',
      B1: 'hello',
    })
    expect(out).toEqual({
      A1: { value: 1 },
      A2: { value: 2 },
      A3: { value: 3 },
      B1: { value: 'hello' },
    })
  })
  it('isolates cycles — only the cycle cells get #CYCLE!', () => {
    const out = evaluateAll({
      A1: '=B1',
      B1: '=A1',
      C1: '42',
    })
    expect(out.C1).toEqual({ value: 42 })
    expect(out.A1?.error).toBe('#CYCLE!')
    expect(out.B1?.error).toBe('#CYCLE!')
  })
})
