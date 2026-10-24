// 포털 진입 다녀오기 시험 — 접두 떼기 · 돌아올 자리 남기고 꺼내기 · 1분 되풀이 막기(단추는 무시) · 진입 링크 없음 · 바깥 경로 거부
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = { launchUrl: '/launch/mx-white-paper' as string | null }
vi.mock('../store', () => ({ useAuthStore: { getState: () => state } }))

class MemoryStorage {
  private data = new Map<string, string>()
  getItem(k: string): string | null {
    return this.data.has(k) ? this.data.get(k)! : null
  }
  setItem(k: string, v: string): void {
    this.data.set(k, String(v))
  }
  removeItem(k: string): void {
    this.data.delete(k)
  }
}

let assign: ReturnType<typeof vi.fn>

async function load() {
  vi.resetModules() // 모듈의 '떠나는 중' 표시를 시험마다 새로
  return import('../portalEntry')
}

beforeEach(() => {
  assign = vi.fn()
  state.launchUrl = '/launch/mx-white-paper'
  vi.stubGlobal('window', { sessionStorage: new MemoryStorage(), location: { assign } })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('appPath', () => {
  it('drops the portal prefix and keeps the query', async () => {
    const { appPath } = await load()
    expect(appPath('/mx-white-paper/wiki/candidates', '?x=1', '/mx-white-paper/')).toBe('/wiki/candidates?x=1')
    expect(appPath('/mx-white-paper', '', '/mx-white-paper/')).toBe('/')
    expect(appPath('/wiki', '', '/')).toBe('/wiki')
  })
})

describe('goToPortalEntry · takeReturnPath', () => {
  it('saves where to come back, leaves for the launch link and hands the place back once', async () => {
    const m = await load()
    expect(m.goToPortalEntry('/wiki?tab=2')).toBe(true)
    expect(assign).toHaveBeenCalledWith('/launch/mx-white-paper')
    expect(m.goToPortalEntry('/other')).toBe(true) // 이미 떠나는 중 — 다시 보내지 않는다
    expect(assign).toHaveBeenCalledTimes(1)
    expect(m.takeReturnPath()).toBe('/wiki?tab=2')
    expect(m.takeReturnPath()).toBeNull()
  })

  it('does not auto-leave again within a minute, but a click does', async () => {
    let m = await load()
    m.goToPortalEntry('/wiki')
    m = await load() // 포털에서 돌아와 새로 뜬 페이지 — 세션은 아직 없다
    expect(m.recentlyTried()).toBe(true)
    expect(m.goToPortalEntry('/wiki')).toBe(false)
    expect(m.goToPortalEntry('/wiki', { force: true })).toBe(true)
    expect(m.recentlyTried(Date.now() + m.RETRY_GUARD_MS + 1)).toBe(false)
  })

  it('stays put without a launch link and never returns off-app', async () => {
    state.launchUrl = null
    let m = await load()
    expect(m.goToPortalEntry('/wiki')).toBe(false)
    expect(assign).not.toHaveBeenCalled()
    state.launchUrl = '/launch/mx-white-paper'
    m = await load()
    m.goToPortalEntry('//evil.example/x')
    expect(m.takeReturnPath()).toBe('/')
  })
})
