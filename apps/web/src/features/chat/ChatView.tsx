// 대화형 채팅 UI — 스트리밍 메시지 + 도구 카드(문서 생성·검색 결과 링크).
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { streamChat, type ChatEvent, type SearchHit } from './api'

interface ToolCard {
  name: string
  ok: boolean
  summary: string
  link?: string
  results?: SearchHit[]
}

interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
  tools: ToolCard[]
  streaming?: boolean
}

const EXAMPLES = [
  '배터리 안전 시험 절차를 정리해서 새 백서로 만들어줘',
  'LS-DYNA *CONTROL 관련 백서를 찾아줘',
  '이 내용을 문서로 저장해줘: …',
]

/** `[label](href)` 마크다운 링크 + 줄바꿈을 React 노드로. 내부 경로는 <Link>. */
function renderText(text: string): ReactNode[] {
  const out: ReactNode[] = []
  const lines = text.split('\n')
  const linkRe = /\[([^\]]+)\]\(([^)]+)\)/g
  lines.forEach((line, li) => {
    let last = 0
    let m: RegExpExecArray | null
    const parts: ReactNode[] = []
    linkRe.lastIndex = 0
    while ((m = linkRe.exec(line)) !== null) {
      if (m.index > last) parts.push(line.slice(last, m.index))
      const label = m[1] ?? ''
      const href = m[2] ?? ''
      // XSS 방어: 내부(/) 또는 http(s) 만 링크로. javascript:/data: 등은 평문.
      const internal = href.startsWith('/') && !href.startsWith('//')
      const external = /^https?:\/\//i.test(href)
      if (internal) {
        parts.push(
          <Link key={`${li}-${m.index}`} to={href} className="text-smsg-blue-700 underline">
            {label}
          </Link>,
        )
      } else if (external) {
        parts.push(
          <a key={`${li}-${m.index}`} href={href} className="text-smsg-blue-700 underline" target="_blank" rel="noreferrer">
            {label}
          </a>,
        )
      } else {
        parts.push(m[0]) // 신뢰 불가 스킴 — 원문 그대로 텍스트로
      }
      last = m.index + m[0].length
    }
    if (last < line.length) parts.push(line.slice(last))
    out.push(<span key={`l-${li}`}>{parts}</span>)
    if (li < lines.length - 1) out.push(<br key={`br-${li}`} />)
  })
  return out
}

function ToolCardView({ card }: { card: ToolCard }) {
  const label =
    card.name === 'create_document' ? '📄 문서 생성'
    : card.name === 'append_section' ? '➕ 섹션 추가'
    : card.name === 'search_corpus' ? '🔎 코퍼스 검색'
    : card.name === 'get_document' ? '📖 문서 열람'
    : card.name
  return (
    <div className="mt-2 rounded-md border border-smsg-gray-200 bg-smsg-gray-050 px-3 py-2 text-sm">
      <div className="flex items-center gap-2 font-medium text-smsg-gray-700">
        <span>{label}</span>
        <span className={card.ok ? 'text-emerald-600' : 'text-red-600'}>
          {card.ok ? '완료' : '실패'}
        </span>
      </div>
      {card.link ? (
        <Link to={card.link} className="mt-1 inline-block text-smsg-blue-700 underline">
          {card.summary}
        </Link>
      ) : (
        <div className="mt-1 text-smsg-gray-700">{card.summary}</div>
      )}
      {card.results && card.results.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {card.results.map((r) => (
            <li key={r.slug}>
              <Link to={`/docs/${r.slug}`} className="text-smsg-blue-700 underline">
                {r.title}
              </Link>
              {r.snippet && <span className="text-smsg-gray-500"> — {r.snippet}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function ChatView() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const send = useCallback(
    async (raw: string) => {
      const content = raw.trim()
      if (!content || busy) return
      setInput('')
      // 사용자 메시지 + 어시스턴트 자리표시자 추가
      const history: ChatMessage[] = [
        ...messages,
        { role: 'user', text: content, tools: [] },
      ]
      // 이 스트림의 어시스턴트 메시지 인덱스를 고정 캡처 — 메시지는 append 만
      // 되므로 인덱스가 안정적이다. 중단 후 곧바로 재전송해도 이전 스트림의
      // finally 가 새 메시지를 건드리지 않는다 (M4 레이스 방지).
      const assistantIdx = history.length
      setMessages([...history, { role: 'assistant', text: '', tools: [], streaming: true }])
      setBusy(true)
      const ac = new AbortController()
      abortRef.current = ac

      const patchAssistant = (fn: (m: ChatMessage) => ChatMessage) => {
        setMessages((prev) => {
          const next = [...prev]
          const cur = next[assistantIdx]
          if (cur && cur.role === 'assistant') next[assistantIdx] = fn(cur)
          return next
        })
      }

      const onEvent = (e: ChatEvent) => {
        if (e.type === 'token') {
          patchAssistant((m) => ({ ...m, text: m.text + e.text }))
        } else if (e.type === 'tool_result') {
          patchAssistant((m) => ({
            ...m,
            tools: [...m.tools, { name: e.name, ok: e.ok, summary: e.summary, link: e.link, results: e.results }],
          }))
        } else if (e.type === 'error') {
          patchAssistant((m) => ({ ...m, text: m.text + `\n⚠️ ${e.message}` }))
        } else if (e.type === 'done') {
          patchAssistant((m) => ({ ...m, streaming: false }))
        }
      }

      try {
        const apiMsgs = history.map((m) => ({ role: m.role, content: m.text }))
        await streamChat(apiMsgs, { onEvent, signal: ac.signal })
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          patchAssistant((m) => ({
            ...m,
            text: m.text + `\n⚠️ 연결 오류: ${(err as Error).message}`,
            streaming: false,
          }))
        }
      } finally {
        patchAssistant((m) => ({ ...m, streaming: false }))
        // 이 스트림이 여전히 현재 스트림일 때만 busy/abort 초기화 — 중단 후
        // 새 스트림이 시작됐다면 그 상태를 덮어쓰지 않는다.
        if (abortRef.current === ac) {
          setBusy(false)
          abortRef.current = null
        }
      }
    },
    [messages, busy],
  )

  const stop = useCallback(() => {
    abortRef.current?.abort()
    setBusy(false)
  }, [])

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col">
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6">
        {messages.length === 0 ? (
          <div className="mt-10 text-center">
            <h1 className="text-2xl font-semibold text-smsg-gray-900">무엇을 정리할까요?</h1>
            <p className="mt-2 text-smsg-gray-500">
              대화로 백서를 만들고, 기존 백서를 검색할 수 있습니다.
            </p>
            <div className="mt-6 flex flex-col items-center gap-2">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  onClick={() => send(ex)}
                  className="w-full max-w-xl rounded-md border border-smsg-gray-200 bg-smsg-surface px-4 py-2 text-left text-sm text-smsg-gray-700 hover:bg-smsg-gray-050"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            {messages.map((m, i) => (
              <div key={i} className={m.role === 'user' ? 'text-right' : 'text-left'}>
                <div
                  className={
                    m.role === 'user'
                      ? 'inline-block max-w-[85%] rounded-2xl bg-smsg-blue-500 px-4 py-2 text-left text-white'
                      : 'inline-block max-w-[95%] rounded-2xl bg-smsg-gray-050 px-4 py-2 text-smsg-gray-900'
                  }
                >
                  {m.text ? renderText(m.text) : m.streaming ? <span className="text-smsg-gray-500">…</span> : null}
                  {m.tools.map((c, ci) => (
                    <ToolCardView key={ci} card={c} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          send(input)
        }}
        className="border-t border-smsg-gray-200 bg-smsg-surface px-4 py-3"
      >
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send(input)
              }
            }}
            rows={1}
            placeholder="메시지를 입력하세요 — 예: '…를 백서로 정리해줘' (Enter 전송, Shift+Enter 줄바꿈)"
            className="max-h-40 min-h-[44px] flex-1 resize-none rounded-md border border-smsg-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-smsg-blue-500"
          />
          {busy ? (
            <Button type="button" variant="secondary" onClick={stop}>
              중단
            </Button>
          ) : (
            <Button type="submit" variant="primary" disabled={!input.trim()}>
              전송
            </Button>
          )}
        </div>
      </form>
    </div>
  )
}
