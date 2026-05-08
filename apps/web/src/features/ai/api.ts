/**
 * AI 보조 훅 API 헬퍼.
 *
 * BE 가 placeholder 응답을 돌려주는 동안에도 FE 와이어링은 동일하게 흘러간다.
 * 모든 호출은 `Promise<string>` 으로 단순화되어 있고, 503 (`AI_DISABLED`) 은
 * 사용자에게 그대로 보여줄 수 있는 한국어 메시지로 변환해 throw 한다.
 */
import { apiClient } from '@/lib/api/client'
import { toApiError, type ApiEnvelope } from '@/lib/api/envelope'

export type TargetLength = 'short' | 'medium' | 'long'
export type TargetLanguage = 'en' | 'ja' | 'zh' | 'ko'
export type Tone = 'formal' | 'casual' | 'concise'

const DISABLED_MSG =
  'AI 기능이 비활성화되어 있습니다. 관리자에게 문의하세요.'

interface SummarizeResp {
  summary: string
}
interface TranslateResp {
  translated: string
  source_language: string
}
interface PolishResp {
  polished: string
}
interface ContinueResp {
  continuation: string
}
interface TitleResp {
  title: string
}

function pickData<T>(envelope: ApiEnvelope<T> | undefined): T {
  if (!envelope) throw new Error('빈 응답')
  if (envelope.error) {
    throw new Error(envelope.error.message ?? envelope.error.code ?? 'AI 에러')
  }
  if (envelope.data === undefined || envelope.data === null) {
    throw new Error('AI 응답이 비어 있습니다.')
  }
  return envelope.data
}

/**
 * 503 / AI_DISABLED 를 친화적 한국어 메시지로, 그 외는 ApiError 로 정규화.
 */
function rethrow(err: unknown): never {
  const ax = err as { response?: { status?: number; data?: ApiEnvelope<unknown> } }
  const status = ax?.response?.status
  const code = ax?.response?.data?.error?.code
  if (status === 503 || code === 'AI_DISABLED') {
    throw new Error(DISABLED_MSG)
  }
  throw toApiError(err)
}

export async function aiSummarize(
  text: string,
  opts: { targetLength?: TargetLength } = {},
): Promise<string> {
  try {
    const res = await apiClient.post<ApiEnvelope<SummarizeResp>>('/ai/summarize', {
      text,
      target_length: opts.targetLength ?? 'medium',
    })
    return pickData(res.data).summary
  } catch (err) {
    rethrow(err)
  }
}

export async function aiTranslate(
  text: string,
  targetLanguage: TargetLanguage,
): Promise<string> {
  try {
    const res = await apiClient.post<ApiEnvelope<TranslateResp>>('/ai/translate', {
      text,
      target_language: targetLanguage,
    })
    return pickData(res.data).translated
  } catch (err) {
    rethrow(err)
  }
}

export async function aiPolish(text: string, tone?: Tone): Promise<string> {
  try {
    const body: Record<string, unknown> = { text }
    if (tone) body.tone = tone
    const res = await apiClient.post<ApiEnvelope<PolishResp>>('/ai/polish', body)
    return pickData(res.data).polished
  } catch (err) {
    rethrow(err)
  }
}

export async function aiContinue(
  text: string,
  opts: { maxTokens?: number } = {},
): Promise<string> {
  try {
    const body: Record<string, unknown> = { text }
    if (opts.maxTokens) body.max_tokens = opts.maxTokens
    const res = await apiClient.post<ApiEnvelope<ContinueResp>>('/ai/continue', body)
    return pickData(res.data).continuation
  } catch (err) {
    rethrow(err)
  }
}

export async function aiTitle(content: string): Promise<string> {
  try {
    const res = await apiClient.post<ApiEnvelope<TitleResp>>('/ai/title', {
      content,
    })
    return pickData(res.data).title
  } catch (err) {
    rethrow(err)
  }
}

export const __AI_DISABLED_MSG = DISABLED_MSG
