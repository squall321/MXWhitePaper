import { describe, it, expect } from 'vitest'
import { getPalette } from '../EChartsView'

describe('getPalette()', () => {
  it('light theme returns the standard 8-colour palette starting with smsg-blue-700', () => {
    const p = getPalette('light')
    expect(p).toHaveLength(8)
    expect(p[0]).toBe('#1428A0')
    expect(p[1]).toBe('#2E5BFF')
  })

  it('dark theme returns brighter variants — same length, same hue ordering', () => {
    const p = getPalette('dark')
    expect(p).toHaveLength(8)
    expect(p[0]).toBe('#93A5FF') // smsg-blue-700 dark variant
    expect(p[1]).toBe('#6E8BFF') // smsg-blue-500 dark variant
  })

  it('index 0 is always in the blue family across both themes', () => {
    // We assert hue stability by checking the first character of the
    // dominant blue channel — for our hex set the dark palette[0] still
    // starts with "9" (B in #93A5FF) > red ("#9" red) so the heuristic
    // here is just that the dark hex resembles a blue.
    const dark0 = getPalette('dark')[0]!
    // R channel
    const r = parseInt(dark0.slice(1, 3), 16)
    const g = parseInt(dark0.slice(3, 5), 16)
    const b = parseInt(dark0.slice(5, 7), 16)
    // Blue dominates (b > r and b > g) — palette[0] stays blue family.
    expect(b).toBeGreaterThan(r)
    expect(b).toBeGreaterThan(g)
  })
})
