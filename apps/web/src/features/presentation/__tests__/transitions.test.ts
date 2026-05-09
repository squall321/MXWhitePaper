import { describe, expect, it } from 'vitest'
import {
  TRANSITIONS_CSS,
  blockWrapperClass,
  staggerStyle,
  themeAttrs,
} from '../transitions.css'
import { cycleTheme, cycleTransition } from '@/pages/Presentation'

/**
 * Pure-helper coverage for the transition + theme + stagger module. These
 * tests don't render any React; the helpers are deliberately strings/objects
 * so the editor agent can iterate on the visual surface without touching the
 * page component.
 */
describe('transitions.css helpers', () => {
  it('themeAttrs() emits the data attribute for each theme', () => {
    expect(themeAttrs('light')).toEqual({ 'data-pres-theme': 'light' })
    expect(themeAttrs('dark')).toEqual({ 'data-pres-theme': 'dark' })
    expect(themeAttrs('bright')).toEqual({ 'data-pres-theme': 'bright' })
  })

  it('staggerStyle() returns {} when stagger is disabled (no dead CSS var)', () => {
    expect(staggerStyle(0, false)).toEqual({})
    expect(staggerStyle(7, false)).toEqual({})
  })

  it('staggerStyle() injects --idx when enabled', () => {
    const s = staggerStyle(3, true) as Record<string, unknown>
    expect(s['--idx']).toBe(3)
  })

  it('staggerStyle() clamps negative + huge indices', () => {
    const lo = staggerStyle(-5, true) as Record<string, unknown>
    const hi = staggerStyle(9999, true) as Record<string, unknown>
    expect(lo['--idx']).toBe(0)
    expect(hi['--idx']).toBe(40)
  })

  it('staggerStyle() floors fractional indices', () => {
    const s = staggerStyle(2.7, true) as Record<string, unknown>
    expect(s['--idx']).toBe(2)
  })

  it('blockWrapperClass() switches the stagger modifier on/off', () => {
    expect(blockWrapperClass(false)).toBe('slide-block-wrap')
    expect(blockWrapperClass(true)).toBe(
      'slide-block-wrap slide-block-wrap--stagger',
    )
  })
})

describe('TRANSITIONS_CSS catalogue', () => {
  it('declares all three transition kinds', () => {
    expect(TRANSITIONS_CSS).toContain('data-pres-transition="none"')
    expect(TRANSITIONS_CSS).toContain('data-pres-transition="fade"')
    expect(TRANSITIONS_CSS).toContain('data-pres-transition="slide-left"')
  })

  it('declares all three themes', () => {
    expect(TRANSITIONS_CSS).toContain('data-pres-theme="light"')
    expect(TRANSITIONS_CSS).toContain('data-pres-theme="dark"')
    expect(TRANSITIONS_CSS).toContain('data-pres-theme="bright"')
  })

  it('honours prefers-reduced-motion', () => {
    expect(TRANSITIONS_CSS).toContain('prefers-reduced-motion: reduce')
  })

  it('uses the per-block stagger custom property', () => {
    // var(--idx, 0) is the fallback so blocks without an idx still render.
    expect(TRANSITIONS_CSS).toMatch(/calc\(50ms \* var\(--idx, 0\)\)/)
  })

  it('bright theme paints Samsung Blue background', () => {
    // Light grep — exact tokens are intentionally hard-coded; if the bright
    // background changes, this test should fail loudly.
    expect(TRANSITIONS_CSS).toMatch(/\[data-pres-theme="bright"\][\s\S]*?#1428a0/)
  })
})

describe('cycle helpers (Presentation toolbar)', () => {
  it('cycles themes light → dark → bright → light', () => {
    expect(cycleTheme('light')).toBe('dark')
    expect(cycleTheme('dark')).toBe('bright')
    expect(cycleTheme('bright')).toBe('light')
  })

  it('cycles transitions none → fade → slide-left → none', () => {
    expect(cycleTransition('none')).toBe('fade')
    expect(cycleTransition('fade')).toBe('slide-left')
    expect(cycleTransition('slide-left')).toBe('none')
  })
})
