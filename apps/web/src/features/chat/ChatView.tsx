// 대화형 채팅 UI — 스트리밍 메시지 + 도구 카드(문서 생성·검색 결과 링크) · 위키 모드(위키에 묻기 · 각주 · 위키에 남기기).
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { useWikiEnabled } from '@/features/wiki/api'
import { streamChat, streamWikiQuery, type ChatDone, type ChatEvent, type SearchHit, type WikiCitation } from './api'
import { WikiAnswerActions, WikiCitationList } from './WikiAnswer'

type Mode = 'doc' | 'wiki'

interface ToolCard {
  name: string
  ok: boolean
  summary: string
  link?: string
  results?: SearchHit[]
}

interface ChatMessage {
  role: 'user' | 'assistant'
  mode: Mode
  text: string
  tools: ToolCard[]
  streaming?: boolean
  // 위키 모드 답만 — 물음 · 각주 · 끝 프레임 · 오류가 있었나
  question?: string
  citations?: WikiCitation[]
  done?: ChatDone
  failed?: boolean
}

const EXAMPLES = [
  '배터리 안전 시험 절차를 정리해서 새 백서로 만들어줘',
  'LS-DYNA *CONTROL 관련 백서를 찾아줘',
  '이 내용을 문서로 저장해줘: …',
]

const WIKI_EXAMPLES = [
  '리브를 더한 안의 최대 응력은 얼마였나?',
  '힌지 쪽 균열은 어떤 해석으로 재현했나?',
  '위키에 있는 낙하 해석 사례를 정리해줘',
]

/** `[label](href)` 마크다운 링크 + 줄바꿈을 React 노드로. 내부 경로는 <Link>. 위키 답의 `[n]` 은 그 각주의 문서로. */
function renderText(text: string, cites?: WikiCitation[]): ReactNode[] {
  const out: ReactNode[] = []
  const lines = text.split('\n')
  const linkRe = /\[([^\]]+)\]\(([^)]+)\)|\[(\d{1,3})\]/g
  const byN = new Map((cites ?? []).map((c) => [c.n, c]))
  lines.forEach((line, li) => {
    let last = 0
    let m: RegExpExecArray | null
    const parts: ReactNode[] = []
    linkRe.lastIndex = 0
    while ((m = linkRe.exec(line)) !== null) {
      if (m.index > last) parts.push(line.slice(last, m.index))
      if (m[3]) {
        const cite = byN.get(Number(m[3]))
        parts.push(cite ? (
          <Link
            key={`${li}-${m.index}`}
            to={`/docs/${encodeURIComponent(cite.slug)}`}
            title={`${cite.title} § ${cite.section}`}
            className="align-super text-[11px] text-[var(--smsg-blue-700)]"
          >
            {m[0]}
          </Link>
        ) : m[0])
        last = m.index + m[0].length
        continue
      }
      const label = m[1] ?? ''
      const href = m[2] ?? ''
      // XSS 방어: 내부(/) 또는 http(s) 만 링크로. javascript:/data: 등은 평문.
      const internal = href.startsWith('/') && !href.startsWith('//')
      const external = /^https?:\/\//i.test(href)
      if (internal) {
        parts.push(
          <Link key={`${li}-${m.index}`} to={href} className="text-[var(--smsg-blue-700)] underline">
            {label}
          </Link>,
        )
      } else if (external) {
        parts.push(
          <a key={`${li}-${m.index}`} href={href} className="text-[var(--smsg-blue-700)] underline" target="_blank" rel="noreferrer">
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
    : card.name === 'wiki_index' ? '🗂️ 위키 목록'
    : card.name === 'wiki_search' ? '🔎 위키 찾기'
    : card.name === 'wiki_read' ? '📖 위키 읽기'
    : card.name
  return (
    <div className="mt-2 rounded-md border border-[var(--smsg-gray-200)] bg-[var(--smsg-gray-050)] px-3 py-2 text-sm">
      <div className="flex items-center gap-2 font-medium text-[var(--smsg-gray-700)]">
        <span>{label}</span>
        <span className={card.ok ? 'text-emerald-600' : 'text-red-600'}>
          {card.ok ? '완료' : '실패'}
        </span>
      </div>
      {card.link ? (
        <Link to={card.link} className="mt-1 inline-block text-[var(--smsg-blue-700)] underline">
          {card.summary}
        </Link>
      ) : (
        <div className="mt-1 text-[var(--smsg-gray-700)]">{card.summary}</div>
      )}
      {card.results && card.results.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {card.results.map((r) => (
            <li key={r.slug}>
              <Link to={`/docs/${r.slug}`} className="text-[var(--smsg-blue-700)] underline">
                {r.title}
              </Link>
              {r.snippet && <span className="text-[var(--smsg-gray-500)]"> — {r.snippet}</span>}
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
  const wikiOn = useWikiEnabled()
  const [mode, setMode] = useState<Mode>('doc')
  const active: Mode = wikiOn ? mode : 'doc'
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
        { role: 'user', mode: active, text: content, tools: [] },
      ]
      // 이 스트림의 어시스턴트 메시지 인덱스를 고정 캡처 — 메시지는 append 만
      // 되므로 인덱스가 안정적이다. 중단 후 곧바로 재전송해도 이전 스트림의
      // finally 가 새 메시지를 건드리지 않는다 (M4 레이스 방지).
      const assistantIdx = history.length
      setMessages([
        ...history,
        {
          role: 'assistant', mode: active, text: '', tools: [], streaming: true,
          ...(active === 'wiki' ? { question: content, citations: [] } : {}),
        },
      ])
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
        } else if (e.type === 'citation') {
          const { type: _t, ...cite } = e
          patchAssistant((m) => ({ ...m, citations: [...(m.citations ?? []), cite] }))
        } else if (e.type === 'error') {
          patchAssistant((m) => ({ ...m, text: m.text + `\n⚠️ ${e.message}`, failed: true }))
        } else if (e.type === 'done') {
          const { type: _t, ...done } = e
          patchAssistant((m) => ({ ...m, streaming: false, done }))
        }
      }

      try {
        // 같은 모드의 말만 앞 대화로 — 위키 묻기는 빈 말을 받지 않고 20 개까지다.
        const apiMsgs = history
          .filter((m) => m.mode === active && m.text.trim())
          .map((m) => ({ role: m.role, content: m.text }))
        if (active === 'wiki') await streamWikiQuery(apiMsgs.slice(-20), { onEvent, signal: ac.signal })
        else await streamChat(apiMsgs, { onEvent, signal: ac.signal })
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
    [messages, busy, active],
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
            <h1 className="text-2xl font-semibold text-[var(--smsg-gray-900)]">
              {active === 'wiki' ? '위키에 무엇을 물을까요?' : '무엇을 정리할까요?'}
            </h1>
            <p className="mt-2 text-[var(--smsg-gray-500)]">
              {active === 'wiki'
                ? 'AI 위키의 문서와 근거로만 답합니다. 위키에 없으면 없다고 말하고, 질문으로 남길 수 있습니다.'
                : '대화로 백서를 만들고, 기존 백서를 검색할 수 있습니다.'}
            </p>
            <div className="mt-6 flex flex-col items-center gap-2">
              {(active === 'wiki' ? WIKI_EXAMPLES : EXAMPLES).map((ex) => (
                <button
                  key={ex}
                  onClick={() => send(ex)}
                  className="w-full max-w-xl rounded-md border border-[var(--smsg-gray-200)] bg-[var(--smsg-surface)] px-4 py-2 text-left text-sm text-[var(--smsg-gray-700)] hover:bg-[var(--smsg-gray-050)]"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-5" data-testid="chat-messages">
            {messages.map((m, i) => (
              <div key={i} className={m.role === 'user' ? 'text-right' : 'text-left'}>
                <div
                  className={
                    m.role === 'user'
                      ? 'inline-block max-w-[85%] rounded-2xl bg-[var(--smsg-blue-500)] px-4 py-2 text-left text-white'
                      : 'inline-block max-w-[95%] rounded-2xl bg-[var(--smsg-gray-050)] px-4 py-2 text-[var(--smsg-gray-900)]'
                  }
                >
                  {m.role === 'assistant' && m.mode === 'wiki' && (
                    <div className="mb-1 text-[11px] font-medium text-[var(--smsg-gray-500)]">AI 위키</div>
                  )}
                  {m.text ? renderText(m.text, m.citations) : m.streaming ? <span className="text-[var(--smsg-gray-500)]">…</span> : null}
                  {m.role === 'assistant' && m.mode === 'wiki' && (
                    <>
                      <WikiCitationList citations={m.citations ?? []} />
                      {m.done && (
                        <WikiAnswerActions
                          question={m.question ?? ''}
                          answer={m.text}
                          citations={m.citations ?? []}
                          done={m.done}
                          failed={m.failed}
                        />
                      )}
                    </>
                  )}
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
        className="border-t border-[var(--smsg-gray-200)] bg-[var(--smsg-surface)] px-4 py-3"
      >
        {wikiOn && (
          <div role="radiogroup" aria-label="챗 모드" className="mb-2 flex gap-1">
            {([['doc', '백서 만들기'], ['wiki', '위키에 묻기']] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={active === value}
                disabled={busy}
                onClick={() => setMode(value)}
                className={
                  active === value
                    ? 'rounded-full bg-[var(--smsg-blue-500)] px-3 py-1 text-xs text-white'
                    : 'rounded-full border border-[var(--smsg-gray-200)] px-3 py-1 text-xs text-[var(--smsg-gray-700)] hover:bg-[var(--smsg-gray-050)]'
                }
              >
                {label}
              </button>
            ))}
          </div>
        )}
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
            placeholder={
              active === 'wiki'
                ? '위키에 물어보세요 — 위키 문서와 근거로만 답합니다 (Enter 전송, Shift+Enter 줄바꿈)'
                : "메시지를 입력하세요 — 예: '…를 백서로 정리해줘' (Enter 전송, Shift+Enter 줄바꿈)"
            }
            className="max-h-40 min-h-[44px] flex-1 resize-none rounded-md border border-[var(--smsg-gray-300)] bg-[var(--smsg-surface)] px-3 py-2 text-sm text-[var(--smsg-gray-900)] outline-none focus:border-[var(--smsg-blue-500)]"
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
