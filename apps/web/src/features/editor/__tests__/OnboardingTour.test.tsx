import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  OnboardingTour,
  ONBOARDING_STORAGE_KEY,
  ONBOARDING_STEPS,
} from '../components/OnboardingTour'

/**
 * Static-render checks for the onboarding overlay. Behavioural localStorage
 * gating is verified at the unit level via the constant export — actual
 * mount-time reads run in the e2e suite.
 */
describe('<OnboardingTour /> static markup', () => {
  it('renders the first step when forceOpen is true', () => {
    const html = renderToStaticMarkup(<OnboardingTour forceOpen />)
    expect(html).toContain('환영합니다')
    expect(html).toContain('건너뛰기')
    // Step counter reflects the new 7-step tour.
    expect(html).toContain(`1 / ${ONBOARDING_STEPS.length}`)
  })

  it('exposes the localStorage key for tests / settings reset', () => {
    expect(ONBOARDING_STORAGE_KEY).toBe('mxwp.editorTour.v1')
  })

  it('ships exactly 7 steps covering the upgraded UX', () => {
    expect(ONBOARDING_STEPS).toHaveLength(7)
    const titles = ONBOARDING_STEPS.map((s) => s.title)
    // Spot check a few new concepts the upgrade introduces.
    expect(titles.some((t) => t.includes('상단 바'))).toBe(true)
    expect(titles.some((t) => t.includes('+ 레일'))).toBe(true)
    expect(titles.some((t) => t.includes('드래그 핸들'))).toBe(true)
    expect(titles.some((t) => t.includes('크기 조정'))).toBe(true)
  })
})
