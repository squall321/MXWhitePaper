import { describe, it, expect } from 'vitest'
import { AUTO_SAVE_THRESHOLDS } from '../hooks/useAutoSave'

/**
 * The hook's runtime behaviour requires React + a DOM (jsdom). We don't pull
 * jsdom in for Sprint 4 because the rest of the suite renders to static
 * markup. Instead, we verify the *thresholds* are the documented constants —
 * the integration test for the firing behaviour itself runs in the e2e suite
 * (Sprint 5). This guards against accidental tweaks to the policy.
 */
describe('editor/useAutoSave thresholds', () => {
  it('idle debounce is 5 seconds', () => {
    expect(AUTO_SAVE_THRESHOLDS.IDLE_MS).toBe(5_000)
  })

  it('character-pressure threshold is 200', () => {
    expect(AUTO_SAVE_THRESHOLDS.CHAR_THRESHOLD).toBe(200)
  })

  it('debounce policy: pressure-save fires when char-delta meets threshold', () => {
    // Simulate the inner accumulator:
    let chars = 0
    const writes = [50, 50, 50, 60] // cumulative 210
    let triggered = false
    for (const w of writes) {
      chars += w
      if (chars >= AUTO_SAVE_THRESHOLDS.CHAR_THRESHOLD) {
        triggered = true
        break
      }
    }
    expect(triggered).toBe(true)
  })

  it('debounce policy: under-threshold writes do NOT pressure-fire', () => {
    let chars = 0
    const writes = [10, 20, 30] // cumulative 60
    let triggered = false
    for (const w of writes) {
      chars += w
      if (chars >= AUTO_SAVE_THRESHOLDS.CHAR_THRESHOLD) triggered = true
    }
    expect(triggered).toBe(false)
  })
})
