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

describe('evaluateCell — Batch A descriptive stats', () => {
  it('MEDIAN odd count', () => {
    expect(evaluateCell('=MEDIAN(1,2,3,4,5)', {})).toEqual({ value: 3 })
  })
  it('MEDIAN even count → mean of two middle', () => {
    expect(evaluateCell('=MEDIAN(1,2,3,4)', {})).toEqual({ value: 2.5 })
  })
  it('MEDIAN empty → #NUM!', () => {
    expect(evaluateCell('=MEDIAN(A1:A3)', {})).toMatchObject({ error: '#NUM!' })
  })
  it('MODE — most frequent value', () => {
    expect(evaluateCell('=MODE(1,2,2,3)', {})).toEqual({ value: 2 })
  })
  it('MODE.SNGL alias', () => {
    expect(evaluateCell('=MODE.SNGL(7,7,1,2)', {})).toEqual({ value: 7 })
  })
  it('MODE — no repeats → #N/A', () => {
    expect(evaluateCell('=MODE(1,2,3)', {})).toMatchObject({ error: '#N/A' })
  })
  it('STDEVP (population, n)', () => {
    // [2,4,4,4,5,5,7,9] mean=5, ss=32, popvar=4, popstdev=2
    expect(evaluateCell('=STDEVP(2,4,4,4,5,5,7,9)', {})).toEqual({ value: 2 })
  })
  it('STDEV (sample, n-1) — ss=32/7', () => {
    const r = evaluateCell('=STDEV(2,4,4,4,5,5,7,9)', {})
    expect((r.value as number).toFixed(6)).toBe(Math.sqrt(32 / 7).toFixed(6))
  })
  it('STDEV single value → #DIV/0!', () => {
    expect(evaluateCell('=STDEV(5)', {})).toMatchObject({ error: '#DIV/0!' })
  })
  it('VARP (population)', () => {
    expect(evaluateCell('=VARP(2,4,4,4,5,5,7,9)', {})).toEqual({ value: 4 })
  })
  it('VAR (sample) — 32/7', () => {
    const r = evaluateCell('=VAR(2,4,4,4,5,5,7,9)', {})
    expect((r.value as number).toFixed(6)).toBe((32 / 7).toFixed(6))
  })
  it('QUARTILE q=2 == MEDIAN', () => {
    expect(evaluateCell('=QUARTILE(A1:A5, 2)', {
      A1: '1', A2: '2', A3: '3', A4: '4', A5: '5',
    })).toEqual({ value: 3 })
  })
  it('QUARTILE q=0 == MIN', () => {
    expect(evaluateCell('=QUARTILE(A1:A4, 0)', {
      A1: '1', A2: '2', A3: '3', A4: '4',
    })).toEqual({ value: 1 })
  })
  it('QUARTILE invalid q → #NUM!', () => {
    expect(evaluateCell('=QUARTILE(A1:A3, 5)', {
      A1: '1', A2: '2', A3: '3',
    })).toMatchObject({ error: '#NUM!' })
  })
  it('PERCENTILE p=0.5 == median', () => {
    expect(evaluateCell('=PERCENTILE(A1:A5, 0.5)', {
      A1: '1', A2: '2', A3: '3', A4: '4', A5: '5',
    })).toEqual({ value: 3 })
  })
  it('PERCENTILE interpolation', () => {
    // p=0.25 on [1,2,3,4,5] → pos=1 → exactly 2
    expect(evaluateCell('=PERCENTILE(A1:A5, 0.25)', {
      A1: '1', A2: '2', A3: '3', A4: '4', A5: '5',
    })).toEqual({ value: 2 })
  })
  it('LARGE k=1 == MAX', () => {
    expect(evaluateCell('=LARGE(A1:A3, 1)', {
      A1: '3', A2: '1', A3: '2',
    })).toEqual({ value: 3 })
  })
  it('LARGE k=2', () => {
    expect(evaluateCell('=LARGE(A1:A3, 2)', {
      A1: '3', A2: '1', A3: '2',
    })).toEqual({ value: 2 })
  })
  it('SMALL k=1 == MIN', () => {
    expect(evaluateCell('=SMALL(A1:A3, 1)', {
      A1: '3', A2: '1', A3: '2',
    })).toEqual({ value: 1 })
  })
  it('LARGE k out of range → #NUM!', () => {
    expect(evaluateCell('=LARGE(A1:A3, 10)', {
      A1: '1', A2: '2', A3: '3',
    })).toMatchObject({ error: '#NUM!' })
  })
  it('PERCENTRANK — exact match', () => {
    // [1,2,3,4,5], x=3 → 2/4 = 0.5
    expect(evaluateCell('=PERCENTRANK(A1:A5, 3)', {
      A1: '1', A2: '2', A3: '3', A4: '4', A5: '5',
    })).toEqual({ value: 0.5 })
  })
  it('PERCENTRANK — out of range → #N/A', () => {
    expect(evaluateCell('=PERCENTRANK(A1:A3, 100)', {
      A1: '1', A2: '2', A3: '3',
    })).toMatchObject({ error: '#N/A' })
  })
  it('RANK desc default — largest is rank 1', () => {
    expect(evaluateCell('=RANK(5, A1:A3)', {
      A1: '1', A2: '5', A3: '3',
    })).toEqual({ value: 1 })
  })
  it('RANK asc (order=1)', () => {
    expect(evaluateCell('=RANK(1, A1:A3, 1)', {
      A1: '1', A2: '5', A3: '3',
    })).toEqual({ value: 1 })
  })
  it('RANK miss → #N/A', () => {
    expect(evaluateCell('=RANK(99, A1:A3)', {
      A1: '1', A2: '5', A3: '3',
    })).toMatchObject({ error: '#N/A' })
  })
})

describe('evaluateCell — Batch B correlation / regression', () => {
  // Reference dataset: y = 2x + 1 with no noise → perfect fit.
  const linearCells = {
    A1: '1', A2: '2', A3: '3', A4: '4', A5: '5',
    B1: '3', B2: '5', B3: '7', B4: '9', B5: '11',
  }
  it('CORREL — perfect linear → 1', () => {
    expect(evaluateCell('=CORREL(A1:A5, B1:B5)', linearCells)).toEqual({
      value: 1,
    })
  })
  it('PEARSON alias', () => {
    expect(evaluateCell('=PEARSON(A1:A5, B1:B5)', linearCells)).toEqual({
      value: 1,
    })
  })
  it('RSQ — perfect linear → 1', () => {
    expect(evaluateCell('=RSQ(B1:B5, A1:A5)', linearCells)).toEqual({ value: 1 })
  })
  it('SLOPE — y=2x+1 → 2', () => {
    expect(evaluateCell('=SLOPE(B1:B5, A1:A5)', linearCells)).toEqual({
      value: 2,
    })
  })
  it('INTERCEPT — y=2x+1 → 1', () => {
    const r = evaluateCell('=INTERCEPT(B1:B5, A1:A5)', linearCells)
    expect(Math.abs((r.value as number) - 1)).toBeLessThan(1e-9)
  })
  it('STEYX — perfect fit → 0', () => {
    const r = evaluateCell('=STEYX(B1:B5, A1:A5)', linearCells)
    expect(Math.abs(r.value as number)).toBeLessThan(1e-9)
  })
  it('CORREL — too few points → #DIV/0!', () => {
    expect(evaluateCell('=CORREL(A1:A1, B1:B1)', linearCells)).toMatchObject({
      error: '#DIV/0!',
    })
  })
  it('CORREL — length mismatch → #N/A', () => {
    expect(evaluateCell('=CORREL(A1:A5, B1:B3)', linearCells)).toMatchObject({
      error: '#N/A',
    })
  })
  it('SLOPE — zero variance in x → #DIV/0!', () => {
    expect(
      evaluateCell('=SLOPE(B1:B3, A1:A3)', {
        A1: '1', A2: '1', A3: '1',
        B1: '1', B2: '2', B3: '3',
      }),
    ).toMatchObject({ error: '#DIV/0!' })
  })
})

describe('evaluateCell — Batch C lookup', () => {
  // 3x3 grid: keys in col A, scores in col B, labels in col C.
  const tbl = {
    A1: '1', B1: '100', C1: 'one',
    A2: '2', B2: '200', C2: 'two',
    A3: '3', B3: '300', C3: 'three',
  }
  it('VLOOKUP exact — finds row', () => {
    expect(evaluateCell('=VLOOKUP(2, A1:C3, 2, 0)', tbl)).toEqual({
      value: 200,
    })
  })
  it('VLOOKUP exact miss → #N/A', () => {
    expect(evaluateCell('=VLOOKUP(99, A1:C3, 2, 0)', tbl)).toMatchObject({
      error: '#N/A',
    })
  })
  it('VLOOKUP approx — largest ≤ lookup', () => {
    expect(evaluateCell('=VLOOKUP(2.5, A1:C3, 3, 1)', tbl)).toEqual({
      value: 'two',
    })
  })
  it('VLOOKUP col_index out of range → #REF!', () => {
    expect(evaluateCell('=VLOOKUP(1, A1:C3, 99, 0)', tbl)).toMatchObject({
      error: '#REF!',
    })
  })
  it('HLOOKUP exact', () => {
    expect(
      evaluateCell('=HLOOKUP("y", A1:C2, 2, 0)', {
        A1: 'x', B1: 'y', C1: 'z',
        A2: '10', B2: '20', C2: '30',
      }),
    ).toEqual({ value: 20 })
  })
  it('HLOOKUP miss → #N/A', () => {
    expect(
      evaluateCell('=HLOOKUP("missing", A1:C2, 2, 0)', {
        A1: 'x', B1: 'y', C1: 'z',
        A2: '10', B2: '20', C2: '30',
      }),
    ).toMatchObject({ error: '#N/A' })
  })
  it('INDEX(2D, r, c)', () => {
    expect(evaluateCell('=INDEX(A1:C3, 2, 3)', tbl)).toEqual({ value: 'two' })
  })
  it('INDEX 1D vector — single col', () => {
    expect(evaluateCell('=INDEX(A1:A3, 2)', tbl)).toEqual({ value: 2 })
  })
  it('INDEX out of bounds → #REF!', () => {
    expect(evaluateCell('=INDEX(A1:C3, 5, 5)', tbl)).toMatchObject({
      error: '#REF!',
    })
  })
  it('MATCH exact (mt=0)', () => {
    expect(evaluateCell('=MATCH(200, B1:B3, 0)', tbl)).toEqual({ value: 2 })
  })
  it('MATCH approx (mt=1, default)', () => {
    expect(evaluateCell('=MATCH(250, B1:B3)', tbl)).toEqual({ value: 2 })
  })
  it('MATCH miss exact → #N/A', () => {
    expect(evaluateCell('=MATCH(999, B1:B3, 0)', tbl)).toMatchObject({
      error: '#N/A',
    })
  })
  it('XLOOKUP — finds key', () => {
    expect(evaluateCell('=XLOOKUP(2, A1:A3, C1:C3)', tbl)).toEqual({
      value: 'two',
    })
  })
  it('XLOOKUP — uses default when missing', () => {
    expect(
      evaluateCell('=XLOOKUP(99, A1:A3, C1:C3, "n/a")', tbl),
    ).toEqual({ value: 'n/a' })
  })
  it('XLOOKUP — no default + miss → #N/A', () => {
    expect(evaluateCell('=XLOOKUP(99, A1:A3, C1:C3)', tbl)).toMatchObject({
      error: '#N/A',
    })
  })
  it('XMATCH exact', () => {
    expect(evaluateCell('=XMATCH(3, A1:A3, 0)', tbl)).toEqual({ value: 3 })
  })
  it('XMATCH miss → #N/A', () => {
    expect(evaluateCell('=XMATCH(99, A1:A3, 0)', tbl)).toMatchObject({
      error: '#N/A',
    })
  })
  it('CHOOSE — picks index', () => {
    expect(evaluateCell('=CHOOSE(2, "a", "b", "c")', {})).toEqual({
      value: 'b',
    })
  })
  it('CHOOSE — out of bounds → #VALUE!', () => {
    expect(evaluateCell('=CHOOSE(5, "a", "b")', {})).toMatchObject({
      error: '#VALUE!',
    })
  })
  it('CHOOSE with refs', () => {
    expect(
      evaluateCell('=CHOOSE(1, A1, A2)', { A1: '10', A2: '20' }),
    ).toEqual({ value: 10 })
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
