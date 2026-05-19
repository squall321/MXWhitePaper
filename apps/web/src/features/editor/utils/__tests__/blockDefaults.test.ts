import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * pass-3 N4 회귀 — block defaults helper.
 *
 * 본 프로젝트의 vitest 는 node 환경 (jsdom 미설치). localStorage 를 직접
 * mock 해서 helper 의 round-trip + 격리 + 안전성 검증.
 */

// localStorage in-memory mock 을 global window 에 주입 (helper 가 window.localStorage 참조).
type Storage = {
  getItem(k: string): string | null
  setItem(k: string, v: string): void
  removeItem(k: string): void
  clear(): void
}

function makeMemStorage(): Storage {
  const m = new Map<string, string>()
  return {
    getItem: (k) => (m.has(k) ? m.get(k)! : null),
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
  }
}

let mem: Storage

beforeEach(() => {
  mem = makeMemStorage()
  vi.stubGlobal('window', { localStorage: mem })
})

// Import after the stub so the helper's `typeof window !== 'undefined'` branch
// resolves at module load → still correct because the helper accesses
// `window.localStorage` inside each call, not at import time.
const { loadBlockDefaults, rememberBlockDefaults } = await import('../blockDefaults')

const SCOPE = 'test-scope'

describe('blockDefaults', () => {
  it('load 시 storage 가 비어있으면 fallback 반환', () => {
    const result = loadBlockDefaults(SCOPE, { kind: 'text', required: false })
    expect(result).toEqual({ kind: 'text', required: false })
  })

  it('remember → load round-trip 동작', () => {
    rememberBlockDefaults(SCOPE, { kind: 'select' })
    const result = loadBlockDefaults(SCOPE, { kind: 'text', required: false })
    expect(result.kind).toBe('select')
    expect(result.required).toBe(false)  // fallback 유지
  })

  it('remember 가 partial merge (이전 키 보존)', () => {
    rememberBlockDefaults(SCOPE, { kind: 'multi-select' })
    rememberBlockDefaults(SCOPE, { required: true })
    const result = loadBlockDefaults(SCOPE, { kind: 'text', required: false })
    expect(result.kind).toBe('multi-select')
    expect(result.required).toBe(true)
  })

  it('scope 별로 격리됨', () => {
    rememberBlockDefaults('form-field', { kind: 'select' })
    rememberBlockDefaults('quiz-question', { kind: 'single-choice' })
    expect(loadBlockDefaults('form-field', { kind: 'text' }).kind).toBe('select')
    expect(loadBlockDefaults('quiz-question', { kind: 'text' }).kind).toBe('single-choice')
  })

  it('잘못된 JSON 이 storage 에 있어도 fallback 반환 (안전)', () => {
    mem.setItem('mxwp-block-defaults-' + SCOPE, '!!!not-json!!!')
    const result = loadBlockDefaults(SCOPE, { kind: 'text' })
    expect(result).toEqual({ kind: 'text' })
  })
})
