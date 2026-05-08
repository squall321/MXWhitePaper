/**
 * AI 헬퍼 단위 테스트.
 *
 * apiClient 만 mock 한다. happy path / 503 (`AI_DISABLED`) → 친화 메시지 변환
 * / 일반 에러 → ApiError 변환을 검증.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/api/client', () => ({
  apiClient: { post: vi.fn() },
}))

import { apiClient } from '@/lib/api/client'
import {
  aiSummarize,
  aiTranslate,
  aiPolish,
  aiContinue,
  aiTitle,
  __AI_DISABLED_MSG,
} from '../api'

const post = apiClient.post as unknown as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ai/api · aiSummarize', () => {
  it('POSTs to /ai/summarize and returns the summary', async () => {
    post.mockResolvedValueOnce({ data: { data: { summary: '첫 문장.' } } })
    const out = await aiSummarize('첫 문장. 둘째 문장.', { targetLength: 'short' })
    expect(out).toBe('첫 문장.')
    expect(post).toHaveBeenCalledWith('/ai/summarize', {
      text: '첫 문장. 둘째 문장.',
      target_length: 'short',
    })
  })

  it('defaults target_length to medium', async () => {
    post.mockResolvedValueOnce({ data: { data: { summary: 'x' } } })
    await aiSummarize('hi')
    const [, body] = post.mock.calls[0]!
    expect((body as { target_length: string }).target_length).toBe('medium')
  })

  it('throws friendly message on 503 AI_DISABLED', async () => {
    post.mockRejectedValueOnce({
      response: { status: 503, data: { error: { code: 'AI_DISABLED' } } },
    })
    await expect(aiSummarize('hi')).rejects.toThrow(__AI_DISABLED_MSG)
  })

  it('propagates non-503 errors as ApiError', async () => {
    post.mockRejectedValueOnce({
      response: {
        status: 422,
        data: { error: { code: 'VALIDATION_ERROR', message: '나쁜 입력' } },
      },
    })
    await expect(aiSummarize('hi')).rejects.toThrow(/나쁜 입력|VALIDATION_ERROR/)
  })
})

describe('ai/api · aiTranslate', () => {
  it('returns translated text', async () => {
    post.mockResolvedValueOnce({
      data: { data: { translated: '[KO→EN placeholder] hi', source_language: 'ko' } },
    })
    const out = await aiTranslate('hi', 'en')
    expect(out).toContain('placeholder')
    expect(post).toHaveBeenCalledWith('/ai/translate', {
      text: 'hi',
      target_language: 'en',
    })
  })

  it('surfaces 503 as the disabled message', async () => {
    post.mockRejectedValueOnce({ response: { status: 503 } })
    await expect(aiTranslate('hi', 'en')).rejects.toThrow(__AI_DISABLED_MSG)
  })
})

describe('ai/api · aiPolish', () => {
  it('omits tone when not provided', async () => {
    post.mockResolvedValueOnce({ data: { data: { polished: 'hello.' } } })
    await aiPolish('hello')
    const [, body] = post.mock.calls[0]!
    expect(body).toEqual({ text: 'hello' })
  })

  it('forwards tone when provided', async () => {
    post.mockResolvedValueOnce({ data: { data: { polished: 'x.' } } })
    await aiPolish('x', 'concise')
    const [, body] = post.mock.calls[0]!
    expect((body as { tone: string }).tone).toBe('concise')
  })
})

describe('ai/api · aiContinue', () => {
  it('returns continuation', async () => {
    post.mockResolvedValueOnce({ data: { data: { continuation: '...placeholder' } } })
    const out = await aiContinue('foo')
    expect(out).toBe('...placeholder')
  })

  it('forwards max_tokens when provided', async () => {
    post.mockResolvedValueOnce({ data: { data: { continuation: 'x' } } })
    await aiContinue('foo', { maxTokens: 32 })
    const [, body] = post.mock.calls[0]!
    expect((body as { max_tokens: number }).max_tokens).toBe(32)
  })
})

describe('ai/api · aiTitle', () => {
  it('returns title', async () => {
    post.mockResolvedValueOnce({ data: { data: { title: 'Test Title' } } })
    const out = await aiTitle('long content here')
    expect(out).toBe('Test Title')
    expect(post).toHaveBeenCalledWith('/ai/title', { content: 'long content here' })
  })

  it('throws on empty data', async () => {
    post.mockResolvedValueOnce({ data: { data: null } })
    await expect(aiTitle('hi')).rejects.toThrow()
  })
})
