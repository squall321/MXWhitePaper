// 대화형 채팅 SSE 클라이언트 — fetch + ReadableStream 으로 이벤트 스트림 파싱.
import { getAccessToken } from '@/features/auth/store'

// apiClient 와 동일한 base 규칙 (standalone "/" · 포털 "/mx-white-paper/" 양쪽).
const baseURL =
  (import.meta.env.VITE_API_URL as string) || `${import.meta.env.BASE_URL}api/v1`

export interface ChatMsg {
  role: 'user' | 'assistant'
  content: string
}

export interface SearchHit {
  slug: string
  title: string
  snippet?: string
}

/** BE(chat_agent) 가 흘리는 SSE 이벤트를 판별 유니온으로. */
export type ChatEvent =
  | { type: 'tool_call'; name: string; args: Record<string, unknown> }
  | {
      type: 'tool_result'
      name: string
      ok: boolean
      summary: string
      link?: string
      slug?: string
      results?: SearchHit[]
    }
  | { type: 'token'; text: string }
  | { type: 'error'; message: string }
  | { type: 'done' }

function frameToEvent(frame: string): ChatEvent | null {
  let event = ''
  const dataLines: string[] = []
  for (const line of frame.split('\n')) {
    if (line.startsWith('event: ')) event = line.slice(7).trim()
    else if (line.startsWith('data: ')) dataLines.push(line.slice(6))
  }
  if (!event) return null
  let data: Record<string, unknown> = {}
  try {
    data = JSON.parse(dataLines.join('\n') || '{}')
  } catch {
    data = {}
  }
  return { type: event, ...data } as ChatEvent
}

/**
 * 채팅 스트림. `onEvent` 로 각 SSE 이벤트를 흘리고, 스트림 종료 시 resolve.
 * `signal` 로 취소(중단) 가능. 인증은 Bearer(있으면) + 쿠키(dev 폴백).
 */
export async function streamChat(
  messages: ChatMsg[],
  opts: { onEvent: (e: ChatEvent) => void; signal?: AbortSignal },
): Promise<void> {
  const token = getAccessToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const resp = await fetch(`${baseURL}/chat`, {
    method: 'POST',
    headers,
    credentials: 'include',
    body: JSON.stringify({ messages }),
    signal: opts.signal,
  })

  if (!resp.ok || !resp.body) {
    let msg = `채팅 요청 실패 (HTTP ${resp.status})`
    try {
      const body = await resp.json()
      msg = body?.error?.message ?? msg
    } catch {
      /* ignore */
    }
    opts.onEvent({ type: 'error', message: msg })
    opts.onEvent({ type: 'done' })
    return
  }

  const reader = resp.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let idx: number
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, idx)
      buf = buf.slice(idx + 2)
      const ev = frameToEvent(frame)
      if (ev) opts.onEvent(ev)
    }
  }
}
