/**
 * AiButton 테스트.
 *
 * jsdom 미사용 — RTL 대신 react-dom/server 의 SSR 마크업 + 순수 helper
 * (`extractSectionText`) 검증으로 happy/disabled 두 경로를 다룬다.
 *
 * AI 호출 자체의 happy/503 경로는 `api.test.ts` 가 풀 커버한다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { AiButton, extractSectionText } from '../AiButton'
import type { DocumentJSONV10 } from '@/types/document'
import { useEditorStore } from '@/features/editor/state'

vi.mock('@/lib/api/client', () => ({
  apiClient: { post: vi.fn() },
}))

import { apiClient } from '@/lib/api/client'
import { aiSummarize } from '../api'

const post = apiClient.post as unknown as ReturnType<typeof vi.fn>

function makeDoc(): DocumentJSONV10 {
  return {
    schema_version: '1.0',
    id: '01ABCDEFGHJKMNPQRSTVWXYZ00',
    slug: 'ai-test',
    title: 'AI Test',
    metadata: {
      division: 'eng',
      owners: ['squall'],
      tags: [],
      confidentiality: 'internal',
    },
    sections: [
      {
        id: '01SECT00000000000000000001',
        number: '1',
        level: 1,
        title: '개요',
        blocks: [
          { type: 'paragraph', id: 'B1' + '0'.repeat(24), text: '첫 문단입니다.' },
          { type: 'paragraph', id: 'B2' + '0'.repeat(24), text: '둘째 문단입니다.' },
          {
            type: 'list',
            id: 'B3' + '0'.repeat(24),
            style: 'bullet',
            items: ['알파', '베타'],
          },
        ],
        subsections: [],
      },
    ],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  // editor 스토어를 깨끗한 초기 상태로 (직접 reset). 다른 테스트 격리.
  useEditorStore.setState({
    slug: null,
    draft: null,
    etag: null,
    dirty: false,
    autoSaveStatus: 'idle',
  })
})

describe('extractSectionText', () => {
  it('returns empty string for null doc', () => {
    expect(extractSectionText(null)).toBe('')
  })

  it('joins paragraph + list items from the first section', () => {
    const out = extractSectionText(makeDoc())
    expect(out).toContain('첫 문단입니다.')
    expect(out).toContain('둘째 문단입니다.')
    expect(out).toContain('알파')
    expect(out).toContain('베타')
  })

  it('returns empty string when first section has no text-bearing blocks', () => {
    const doc = makeDoc()
    doc.sections[0]!.blocks = []
    expect(extractSectionText(doc)).toBe('')
  })
})

describe('<AiButton /> SSR markup', () => {
  it('renders the trigger button with the AI label', () => {
    const html = renderToStaticMarkup(<AiButton />)
    expect(html).toContain('data-testid="ai-button"')
    expect(html).toContain('AI')
  })

  it('does not render the menu by default (closed)', () => {
    const html = renderToStaticMarkup(<AiButton />)
    expect(html).not.toContain('data-testid="ai-menu"')
    expect(html).not.toContain('data-testid="ai-summarize"')
  })
})

describe('<AiButton /> integration with aiSummarize', () => {
  it('calls aiSummarize with extracted section text on happy path', async () => {
    post.mockResolvedValueOnce({ data: { data: { summary: '요약 결과' } } })
    useEditorStore.setState({ draft: makeDoc(), etag: 'e1', slug: 'ai-test' })

    const out = await aiSummarize(extractSectionText(makeDoc()))
    expect(out).toBe('요약 결과')
    expect(post).toHaveBeenCalledTimes(1)
    const [url, body] = post.mock.calls[0]!
    expect(url).toBe('/ai/summarize')
    expect((body as { text: string }).text).toContain('첫 문단입니다.')
  })

  it('surfaces a friendly 503 message', async () => {
    post.mockRejectedValueOnce({
      response: { status: 503, data: { error: { code: 'AI_DISABLED' } } },
    })
    await expect(aiSummarize('something')).rejects.toThrow(
      /AI 기능이 비활성화/,
    )
  })
})
