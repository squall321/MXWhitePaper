// AI 위키 각주 · 머리띠 시험 — 원천 차례대로 번호 · 위키 문서가 아니면 감싸기가 그대로 · 배지 · KST 날짜 꼴
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { WikiCited, WikiCitationsProvider, WikiPageBanner } from '../WikiCitations'
import { kst, type WikiCite, type WikiPageInfo } from '../api'

function cite(id: string, title: string): WikiCite {
  return {
    source_id: id, short: `src_${id.slice(0, 8)}`, kind: 'sim_result', title, system: 'stcx', url: '/apps/x',
    captured_at: '2026-08-04T01:12:00+00:00', status: 'active', locator: { path: '/results/0' }, quote: null,
    doc_slug: `src-${id.slice(0, 8)}`,
  }
}

const A = cite('aaaaaaaa-0000-0000-0000-000000000001', '첫 원천')
const B = cite('bbbbbbbb-0000-0000-0000-000000000002', '둘째 원천')
const PAGE: WikiPageInfo = {
  slug: 'ent-part-x', kind: 'entity', managed: 'ai', audience: ['aff:SYN-CAE1'], review_lock: false, stale_since: null,
  entity: { type_key: 'part', name: 'x' }, citations: { B1: [B, A, B] },
  sources: [A, B].map(({ locator: _l, quote: _q, ...ref }) => ref),
}

function html(node: React.ReactNode): string {
  return renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>)
}

describe('WikiCited', () => {
  it('numbers each source once, by the page source order', () => {
    const out = html(<WikiCitationsProvider page={PAGE}><WikiCited blockId="B1"><p>본문</p></WikiCited></WikiCitationsProvider>)
    expect(out).toContain('data-wiki-cited="B1"')
    expect(out.indexOf('[2]')).toBeLessThan(out.indexOf('[1]')) // 블록의 근거 차례(B 먼저) — 번호는 원천 차례
    expect(out.match(/\[2\]/g)).toHaveLength(1) // 같은 원천은 한 번
  })

  it('renders children unchanged without a wiki page or citations', () => {
    expect(html(<WikiCited blockId="B1"><p>본문</p></WikiCited>)).toBe('<p>본문</p>')
    expect(html(<WikiCitationsProvider page={PAGE}><WikiCited blockId="B9"><p>본문</p></WikiCited></WikiCitationsProvider>))
      .toBe('<p>본문</p>')
  })
})

describe('WikiPageBanner', () => {
  it('shows management, scope and the source count', () => {
    const out = html(<WikiPageBanner page={PAGE} />)
    expect(out).toContain('AI 관리')
    expect(out).toContain('aff:SYN-CAE1')
    expect(out.replace(/<!-- -->/g, '')).toContain('이 문서가 기대는 원천 2')
  })
})

describe('kst', () => {
  it('formats ISO time as YYYY-MM-DD HH:MM in Asia/Seoul', () => {
    expect(kst('2026-08-04T01:12:00+00:00')).toBe('2026-08-04 10:12')
    expect(kst(null)).toBe('')
  })
})
