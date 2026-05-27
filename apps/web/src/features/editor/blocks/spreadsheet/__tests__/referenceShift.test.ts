import { describe, it, expect } from 'vitest'
import { shiftReferences, remapCells } from '../referenceShift'

describe('shiftReferences — row insert', () => {
  it('shifts all refs >= insertAt by +1', () => {
    // insertAt=1 means a new row is inserted at row index 1 (= label "2").
    // A1 (row 0) stays, B2 (row 1) becomes B3.
    expect(
      shiftReferences('=A1+B2', { axis: 'row', insertAt: 1, delta: 1 }),
    ).toBe('=A1+B3')
  })

  it('shifts all refs when insertAt=0 (top insert)', () => {
    // insertAt=0 → every existing row shifts down by 1.
    expect(
      shiftReferences('=A1+B2', { axis: 'row', insertAt: 0, delta: 1 }),
    ).toBe('=A2+B3')
  })

  it('leaves refs with row < insertAt untouched', () => {
    // insertAt=5 → only refs at row >= 5 (label >= 6) shift.
    expect(
      shiftReferences('=A1+B2', { axis: 'row', insertAt: 5, delta: 1 }),
    ).toBe('=A1+B2')
  })

  it('shifts both endpoints of a range', () => {
    expect(
      shiftReferences('=SUM(A1:A5)', { axis: 'row', insertAt: 2, delta: 1 }),
    ).toBe('=SUM(A1:A6)')
  })

  it('shifts a range when insert splits the range in the middle', () => {
    // A1:A5 with insertAt=2 (row label 3): start row 0 stays (< 2),
    // end row 4 shifts to 5 (>= 2). → A1:A6.
    expect(
      shiftReferences('=SUM(A1:A5)', { axis: 'row', insertAt: 2, delta: 1 }),
    ).toBe('=SUM(A1:A6)')
  })
})

describe('shiftReferences — col insert', () => {
  it('shifts col refs at or beyond insertAt by +1', () => {
    // Insert a new column at col index 1 (= label "B"): A stays, B → C.
    expect(
      shiftReferences('=A1+B1', { axis: 'col', insertAt: 1, delta: 1 }),
    ).toBe('=A1+C1')
  })

  it('shifts col range endpoints', () => {
    expect(
      shiftReferences('=SUM(A1:C1)', { axis: 'col', insertAt: 1, delta: 1 }),
    ).toBe('=SUM(A1:D1)')
  })
})

describe('shiftReferences — row delete', () => {
  it('turns exact-match row ref into #REF!', () => {
    // deletedIndex=2 = row label 3. =A3 → =#REF!.
    expect(
      shiftReferences('=A3', { axis: 'row', insertAt: 2, delta: -1, deletedIndex: 2 }),
    ).toBe('=#REF!')
  })

  it('shifts refs strictly above the deleted row by -1', () => {
    // deletedIndex=2 (row 3). =A5 (row 4) → =A4.
    expect(
      shiftReferences('=A5', { axis: 'row', insertAt: 2, delta: -1, deletedIndex: 2 }),
    ).toBe('=A4')
  })

  it('leaves refs below the deleted row untouched', () => {
    expect(
      shiftReferences('=A1', { axis: 'row', insertAt: 2, delta: -1, deletedIndex: 2 }),
    ).toBe('=A1')
  })

  it('turns a range into #REF! when either endpoint is deleted', () => {
    // deletedIndex=4 (row 5). =SUM(A1:A5): end row 4 == deleted → #REF!.
    expect(
      shiftReferences('=SUM(A1:A5)', {
        axis: 'row',
        insertAt: 4,
        delta: -1,
        deletedIndex: 4,
      }),
    ).toBe('=SUM(#REF!)')
  })
})

describe('shiftReferences — col delete', () => {
  it('turns exact-match col ref into #REF!', () => {
    // deletedIndex=1 = col 'B'. =B1 → =#REF!.
    expect(
      shiftReferences('=B1', { axis: 'col', insertAt: 1, delta: -1, deletedIndex: 1 }),
    ).toBe('=#REF!')
  })

  it('shifts cols strictly beyond the deleted col by -1', () => {
    // deletedIndex=1 ('B'). =C1 → =B1.
    expect(
      shiftReferences('=C1', { axis: 'col', insertAt: 1, delta: -1, deletedIndex: 1 }),
    ).toBe('=B1')
  })
})

describe('shiftReferences — absolute references ($)', () => {
  it('preserves $ markers while shifting indices on row insert', () => {
    // $A$1 row 0; insertAt=0 → shift to $A$2.
    expect(
      shiftReferences('=$A$1', { axis: 'row', insertAt: 0, delta: 1 }),
    ).toBe('=$A$2')
  })

  it('preserves $ on col-only lock', () => {
    expect(
      shiftReferences('=$A1+A$1', { axis: 'row', insertAt: 0, delta: 1 }),
    ).toBe('=$A2+A$2')
  })

  it('preserves $ in shifted ranges', () => {
    expect(
      shiftReferences('=SUM($A$1:$A$5)', { axis: 'row', insertAt: 0, delta: 1 }),
    ).toBe('=SUM($A$2:$A$6)')
  })
})

describe('shiftReferences — non-formula passthrough', () => {
  it('returns text values unchanged', () => {
    expect(
      shiftReferences('hello A1', { axis: 'row', insertAt: 0, delta: 1 }),
    ).toBe('hello A1')
  })

  it('returns numbers unchanged', () => {
    expect(
      shiftReferences('42', { axis: 'row', insertAt: 0, delta: 1 }),
    ).toBe('42')
  })

  it('returns empty string unchanged', () => {
    expect(
      shiftReferences('', { axis: 'row', insertAt: 0, delta: 1 }),
    ).toBe('')
  })

  it('leaves multi-letter refs (AA1) untouched (out of supported range)', () => {
    expect(
      shiftReferences('=AA1+B2', { axis: 'row', insertAt: 0, delta: 1 }),
    ).toBe('=AA1+B3')
  })
})

describe('shiftReferences — mixed expressions', () => {
  it('shifts multiple refs in a single formula', () => {
    expect(
      shiftReferences('=A1+B2*C3', { axis: 'row', insertAt: 1, delta: 1 }),
    ).toBe('=A1+B3*C4')
  })

  it('shifts inside function calls with multiple args', () => {
    // insertAt=1: row 0 (A1, B1) stays, row 1 (B2) shifts to B3.
    expect(
      shiftReferences('=IF(A1>0, B1, B2)', { axis: 'row', insertAt: 1, delta: 1 }),
    ).toBe('=IF(A1>0, B1, B3)')
  })

  it('handles range + bare ref mix', () => {
    expect(
      shiftReferences('=SUM(A1:A5)+B2', { axis: 'row', insertAt: 1, delta: 1 }),
    ).toBe('=SUM(A1:A6)+B3')
  })
})

describe('remapCells — row insert', () => {
  it('shifts cell keys and formula refs together', () => {
    // insertAt=1: row 0 (A1, B1) stays, row 1 (B2) shifts to row 2 (B3),
    // and the formula '=A1+B2' inside C1 stays (C1 is row 0, refs row 0 + row 1
    // → refs that >= 1 (B2) shift to B3 → '=A1+B3').
    const cells = { A1: '10', B2: '20', C1: '=A1+B2' }
    const next = remapCells(cells, 'row', 1, 'insert')
    expect(next).toEqual({ A1: '10', B3: '20', C1: '=A1+B3' })
  })
})

describe('remapCells — row delete', () => {
  it('drops keys on the deleted row and rewrites refs to #REF! or shifts', () => {
    // deletedIndex=1 (row 2): B2 dropped. C1 formula '=A1+B2' → B2 == deleted
    // → '=A1+#REF!'. D3 (row 2) shifts to D2.
    const cells = { A1: '10', B2: '20', C1: '=A1+B2', D3: 'x' }
    const next = remapCells(cells, 'row', 1, 'delete')
    expect(next).toEqual({ A1: '10', C1: '=A1+#REF!', D2: 'x' })
  })
})

describe('remapCells — col insert', () => {
  it('shifts col keys and formula refs together', () => {
    // insertAt=1 (col B): A1 (col 0) stays, B1 (col 1) → C1.
    // C1 formula '=A1+B1' → '=A1+C1'.
    const cells = { A1: '10', B1: '20', C1: '=A1+B1' }
    // Note: after shifting, C1 collides — but the test cells use refs at the
    // *current* coord. Pre-shift, the keys are A1, B1, C1.
    // After insertCol(1): A1 stays, B1 → C1, C1 → D1. The new value at C1
    // (originally B1) is '20', the new value at D1 (originally C1) is the
    // shifted formula '=A1+C1'.
    const next = remapCells(cells, 'col', 1, 'insert')
    expect(next).toEqual({ A1: '10', C1: '20', D1: '=A1+C1' })
  })
})
