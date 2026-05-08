import { describe, it, expect } from 'vitest'
import { buildDashboardUrl } from '../DashboardEmbedBlock'

const bases = {
  grafana: 'https://grafana.intra.example.com/d-solo',
  tableau: 'https://tableau.intra.example.com/views',
  superset: '',
} as const

describe('buildDashboardUrl', () => {
  it('builds a Grafana URL with params', () => {
    const url = buildDashboardUrl(
      'grafana',
      'panel-1',
      { from: 'now-1h', to: 'now' },
      bases,
    )
    expect(url).toContain('grafana.intra.example.com')
    expect(url).toContain('panel-1')
    expect(url).toContain('from=now-1h')
    expect(url).toContain('to=now')
  })

  it('returns empty string when panelId is missing', () => {
    expect(buildDashboardUrl('grafana', '', undefined, bases)).toBe('')
  })

  it('returns empty string when provider has no base configured', () => {
    expect(buildDashboardUrl('superset', 'p', undefined, bases)).toBe('')
  })

  it('ignores non-object params', () => {
    const url = buildDashboardUrl('tableau', 'p1', null, bases)
    expect(url).toContain('p1')
    expect(url).not.toContain('?')
  })

  it('skips null/undefined param values', () => {
    const url = buildDashboardUrl(
      'grafana',
      'p1',
      { keep: 'a', drop: null, also_drop: undefined },
      bases,
    )
    expect(url).toContain('keep=a')
    expect(url).not.toContain('drop=')
  })
})
