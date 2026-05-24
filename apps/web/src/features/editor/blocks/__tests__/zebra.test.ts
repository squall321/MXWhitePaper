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

  it('list: gray-50 on odd rows, default ON', () => {
    expect(getZebraClass('list', undefined, 0)).toBe('')
    expect(getZebraClass('list', undefined, 1)).toBe('bg-gray-50')
    expect(getZebraClass('list', { stripe: false }, 1)).toBe('')
  })

  it('kpi-cards: blue-050 token on odd cards (data-card surface)', () => {
    expect(getZebraClass('kpi-cards', undefined, 1)).toBe(
      'bg-[var(--smsg-blue-050)]',
    )
    expect(getZebraClass('kpi-cards', undefined, 2)).toBe('')
    expect(getZebraClass('kpi-cards', { stripe: false }, 1)).toBe('')
  })

  it('bibliography: gray-50 on odd entries, default ON', () => {
    expect(getZebraClass('bibliography', undefined, 0)).toBe('')
    expect(getZebraClass('bibliography', undefined, 1)).toBe('bg-gray-50')
    expect(getZebraClass('bibliography', { stripe: false }, 1)).toBe('')
  })

  it('figure-index: gray-50 on odd entries within each group', () => {
    expect(getZebraClass('figure-index', undefined, 0)).toBe('')
    expect(getZebraClass('figure-index', undefined, 1)).toBe('bg-gray-50')
    expect(getZebraClass('figure-index', { stripe: false }, 3)).toBe('')
  })

  it('gantt: registered with the gray-50 token for type completeness (SVG block uses inline fill instead)', () => {
    expect(getZebraClass('gantt', undefined, 0)).toBe('')
    expect(getZebraClass('gantt', undefined, 1)).toBe('bg-gray-50')
    expect(getZebraClass('gantt', { stripe: false }, 1)).toBe('')
  })

  it('every ZebraBlockType has a mapped colour token (no undefined leaks)', () => {
    const types = [
      'table',
      'spreadsheet',
      'list',
      'kpi-cards',
      'bibliography',
      'figure-index',
      'gantt',
    ] as const
    for (const t of types) {
      expect(getZebraClass(t, undefined, 1)).not.toBe('')
      expect(getZebraClass(t, undefined, 1).startsWith('bg-')).toBe(true)
    }
  })
})
