import { afterEach, describe, expect, it, vi } from 'vitest'
import { withBase } from '../basePath'

// BASE_URL is '/' in the test env. We stub import.meta.env.BASE_URL to exercise
// the portal sub-path case too.
describe('withBase', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('returns the path unchanged when base is "/" (standalone)', () => {
    vi.stubEnv('BASE_URL', '/')
    expect(withBase('/docs/foo')).toBe('/docs/foo')
    expect(withBase('docs/foo')).toBe('/docs/foo') // tolerates missing leading slash
  })

  it('prefixes the portal sub-path when base is /mx-white-paper/', () => {
    vi.stubEnv('BASE_URL', '/mx-white-paper/')
    expect(withBase('/docs/foo')).toBe('/mx-white-paper/docs/foo')
    expect(withBase('/')).toBe('/mx-white-paper/')
    expect(withBase('/docs/new?slug=x#sec-1')).toBe(
      '/mx-white-paper/docs/new?slug=x#sec-1',
    )
  })

  it('never doubles the base slash', () => {
    vi.stubEnv('BASE_URL', '/mx-white-paper/')
    expect(withBase('/diag')).not.toContain('//diag')
    expect(withBase('/diag')).toBe('/mx-white-paper/diag')
  })
})
