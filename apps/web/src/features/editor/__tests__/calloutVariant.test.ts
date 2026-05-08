import { describe, it, expect } from 'vitest'
import {
  CALLOUT_LABEL,
  CALLOUT_VARIANTS,
  nextCalloutVariant,
} from '../calloutVariant'

describe('nextCalloutVariant', () => {
  it('cycles info → warn → danger → tip → info', () => {
    expect(nextCalloutVariant('info')).toBe('warn')
    expect(nextCalloutVariant('warn')).toBe('danger')
    expect(nextCalloutVariant('danger')).toBe('tip')
    expect(nextCalloutVariant('tip')).toBe('info')
  })
  it('falls back to info for unknown values', () => {
    expect(nextCalloutVariant('mystery' as never)).toBe('info')
  })
})

describe('CALLOUT_VARIANTS / CALLOUT_LABEL', () => {
  it('exposes the four variants in cycle order', () => {
    expect(CALLOUT_VARIANTS).toEqual(['info', 'warn', 'danger', 'tip'])
  })
  it('exposes a Korean label for every variant', () => {
    for (const v of CALLOUT_VARIANTS) {
      expect(CALLOUT_LABEL[v]).toBeTruthy()
    }
  })
})
