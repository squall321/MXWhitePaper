import { describe, it, expect } from 'vitest'
import { getZebraClass } from '../zebra'

describe('getZebraClass', () => {
  it('table: stripe default ON, odd rows coloured', () => {
    expect(getZebraClass('table', undefined, 0)).toBe('')
    expect(getZebraClass('table', undefined, 1)).toBe('bg-gray-50')
    expect(getZebraClass('table', undefined, 2)).toBe('')
  })

  it('table: stripe=false suppresses every row', () => {
    expect(getZebraClass('table', { stripe: false }, 1)).toBe('')
    expect(getZebraClass('table', { stripe: false }, 3)).toBe('')
  })

  it('spreadsheet: uses the pale blue token on odd rows', () => {
    expect(getZebraClass('spreadsheet', undefined, 1)).toBe(
      'bg-[var(--smsg-blue-050)]',
    )
  })

  it('spreadsheet: explicit stripe=true behaves the same as default', () => {
    expect(getZebraClass('spreadsheet', { stripe: true }, 3)).toBe(
      'bg-[var(--smsg-blue-050)]',
    )
  })

  it('table vs spreadsheet share row-pattern but distinct colour tokens', () => {
    const t = getZebraClass('table', undefined, 1)
    const s = getZebraClass('spreadsheet', undefined, 1)
    expect(t).not.toBe(s)
    expect(t).toBe('bg-gray-50')
    expect(s).toBe('bg-[var(--smsg-blue-050)]')
  })
})
