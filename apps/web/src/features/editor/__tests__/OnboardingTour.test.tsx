import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  OnboardingTour,
  ONBOARDING_STORAGE_KEY,
} from '../components/OnboardingTour'

/**
 * Static-render checks for the onboarding overlay. Behavioural localStorage
 * gating is verified at the unit level via the constant export — actual
 * mount-time reads run in the e2e suite.
 */
describe('<OnboardingTour /> static markup', () => {
  it('renders the first step when forceOpen is true', () => {
    const html = renderToStaticMarkup(<OnboardingTour forceOpen />)
    expect(html).toContain('섹션 빠른 편집')
    expect(html).toContain('건너뛰기')
    expect(html).toContain('1 / 5')
  })

  it('exposes the localStorage key for tests / settings reset', () => {
    expect(ONBOARDING_STORAGE_KEY).toBe('mxwp.editorTour.v1')
  })
})
