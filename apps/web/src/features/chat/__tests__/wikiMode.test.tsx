// 챗 위키 모드 시험 — 묻기 스트림(각주 · MISS · 끝 프레임의 범위) 풀이 · 답 꼬리의 상태별 렌더(남기기 · 질문 · 각주 없음 · 오류) · 범위 이름
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'

vi.mock('@/features/auth/store', () => ({ getAccessToken: () => 'tok' }))

import { streamWikiQuery, type ChatEvent, type WikiCitation } from '../api'
import { WikiAnswerActions, WikiCitationList, scopeLabel } from '../WikiAnswer'

const CITE: WikiCitation = {
  n: 2, slug: 'ent-part-syn-bom-hb01', title: '힌지 브래킷', section: '해석에서', block_id: '01JB',
  sources: [{ source_id: '11111111-1111-4111-8111-111111111111', short: 'src_11111111', title: '가상폴드 A1 낙하' }],
}

function sse(frames: [string, unknown][]): string {
  return frames.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('')
}

function html(node: React.ReactNode): string {
  return renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>).replace(/<!-- -->/g, '')
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('streamWikiQuery', () => {
  it('posts the messages to /wiki/query and yields citation, miss and done frames', async () => {
    const fetchMock = vi.fn(async () => new Response(sse([
      ['tool_result', { name: 'wiki_search', ok: true, summary: '1건' }],
      ['token', { text: '균열은 모서리에서 시작한다 [2].' }],
      ['citation', CITE],
      ['done', { miss: false, cited: 1, scope: ['aff:SYN-CAE1'] }],
    ]), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const events: ChatEvent[] = []
    await streamWikiQuery([{ role: 'user', content: '균열은 어디서?' }], { onEvent: (e) => events.push(e) })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url.endsWith('/wiki/query')).toBe(true)
    expect(JSON.parse(String(init.body))).toEqual({ messages: [{ role: 'user', content: '균열은 어디서?' }] })
    expect(events.map((e) => e.type)).toEqual(['tool_result', 'token', 'citation', 'done'])
    expect(events[2]).toEqual({ type: 'citation', ...CITE })
    expect(events[3]).toEqual({ type: 'done', miss: false, cited: 1, scope: ['aff:SYN-CAE1'] })
  })

  it('turns an HTTP error into error + done', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: '묻기 한도 초과' } }), { status: 429 })))
    const events: ChatEvent[] = []
    await streamWikiQuery([{ role: 'user', content: 'x' }], { onEvent: (e) => events.push(e) })
    expect(events).toEqual([{ type: 'error', message: '묻기 한도 초과' }, { type: 'done' }])
  })
})

describe('WikiAnswerActions', () => {
  const base = { question: '균열은 어디서?', answer: '모서리 [2].', citations: [CITE] }

  it('offers fileback with the outcome and the scope of what was read', () => {
    const out = html(<WikiAnswerActions {...base} done={{ miss: false, cited: 1, scope: ['aff:SYN-CAE1'] }} />)
    expect(out).toContain('위키에 남기기')
    expect(out).toContain('해결됨')
    expect(out).toContain('범위 aff:SYN-CAE1')
  })

  it('offers to file a question on a miss', () => {
    const out = html(<WikiAnswerActions {...base} citations={[]} done={{ miss: true, cited: 0 }} />)
    expect(out).toContain('질문으로 남기기')
    expect(out).not.toContain('위키에 남기기')
  })

  it('does not file back an uncited answer', () => {
    expect(html(<WikiAnswerActions {...base} done={{ miss: false, cited: 0, uncited: true }} />)).toContain('각주 없는 답')
  })

  it('renders nothing after an error, a timeout or without the query LLM', () => {
    expect(html(<WikiAnswerActions {...base} failed done={{ miss: false, cited: 0 }} />)).toBe('')
    expect(html(<WikiAnswerActions {...base} done={{ miss: false, cited: 0, timeout: true }} />)).toBe('')
    expect(html(<WikiAnswerActions {...base} done={{ miss: false, cited: 0, llm: 'unset' }} />)).toBe('')
  })
})

describe('WikiCitationList · scopeLabel', () => {
  it('links each citation to its document and its sources', () => {
    const out = html(<WikiCitationList citations={[CITE]} />)
    expect(out).toContain('href="/docs/ent-part-syn-bom-hb01"')
    expect(out).toContain('[2]')
    expect(out).toContain('§ 해석에서')
    expect(out).toContain(`href="/wiki/sources/${CITE.sources[0]!.source_id}"`)
    expect(html(<WikiCitationList citations={[]} />)).toBe('')
  })

  it('names org, me and narrower scopes', () => {
    expect(scopeLabel(['org'])).toBe('전사')
    expect(scopeLabel(['user:abc'])).toBe('나만')
    expect(scopeLabel(['aff:SYN-CAE1', 'plat:x'])).toBe('aff:SYN-CAE1 · plat:x')
  })
})
