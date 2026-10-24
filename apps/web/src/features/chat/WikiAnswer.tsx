// 위키 묻기 답의 꼬리 — 근거 각주 목록 · '위키에 남기기'(되쌓기) · 답이 없으면 '질문으로 남기기'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { addWikiQuestion, filebackWikiAnswer, type WikiFilebackResult } from '@/features/wiki/api'
import { toApiError } from '@/lib/api/envelope'
import type { ChatDone, WikiCitation } from './api'

const OUTCOMES = [
  { value: 'solved', label: '해결됨' },
  { value: 'partial', label: '일부 해결' },
  { value: 'unknown', label: '모름' },
] as const
type Outcome = (typeof OUTCOMES)[number]['value']

export function scopeLabel(scope: string[]): string {
  if (scope.length === 1 && scope[0] === 'org') return '전사'
  if (scope.length === 1 && scope[0]?.startsWith('user:')) return '나만'
  return scope.join(' · ')
}

export function WikiCitationList({ citations }: { citations: WikiCitation[] }) {
  if (!citations.length) return null
  return (
    <ol aria-label="근거" className="mt-2 space-y-0.5 border-t border-[var(--smsg-gray-200)] pt-2 text-sm">
      {citations.map((c) => (
        <li key={c.n} className="text-[var(--smsg-gray-700)]">
          <span className="font-mono text-xs text-[var(--smsg-gray-500)]">[{c.n}]</span>{' '}
          <Link to={`/docs/${encodeURIComponent(c.slug)}`} className="text-[var(--smsg-blue-700)] underline">
            {c.title}
          </Link>
          {c.section && <span className="text-[var(--smsg-gray-500)]"> § {c.section}</span>}
          {c.sources.map((s) => (
            <Link
              key={s.source_id}
              to={`/wiki/sources/${s.source_id}`}
              title={s.title}
              className="ml-2 font-mono text-xs text-[var(--smsg-blue-700)] underline"
            >
              {s.short}
            </Link>
          ))}
        </li>
      ))}
    </ol>
  )
}

/**
 * 답이 끝난 뒤의 행동. 각주 단 답은 결과를 골라 남기고(범위는 묻기가 준 `scope` — 읽은 근거보다 넓지 않다),
 * 위키에 없으면 질문으로 남긴다(나만 본다). 오류 · 시간 제한 · LLM 없음이면 아무것도 없다.
 */
export function WikiAnswerActions({ question, answer, citations, done, failed }: {
  question: string
  answer: string
  citations: WikiCitation[]
  done: ChatDone
  failed?: boolean
}) {
  const [outcome, setOutcome] = useState<Outcome>('solved')
  const [busy, setBusy] = useState(false)
  const [filed, setFiled] = useState<WikiFilebackResult | null>(null)
  const [asked, setAsked] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (failed || done.timeout || done.llm === 'unset') return null

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(toApiError(e).message)
    } finally {
      setBusy(false)
    }
  }
  const alert = error && <span role="alert" className="text-red-600">{error}</span>

  if (done.miss) {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        {asked ? (
          <span className="text-[var(--smsg-gray-700)]">질문 대기열에 남겼다 — 나만 본다.</span>
        ) : (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => run(async () => {
              await addWikiQuestion(question, 'query_miss')
              setAsked(true)
            })}
          >
            질문으로 남기기
          </Button>
        )}
        {alert}
      </div>
    )
  }
  if (!done.cited) return <p className="mt-2 text-xs text-[var(--smsg-gray-500)]">각주 없는 답이라 위키에 남기지 않는다.</p>
  if (filed) {
    return (
      <p className="mt-2 text-sm text-[var(--smsg-gray-700)]">
        {filed.dedup ? '이미 남긴 답이다' : '위키에 남겼다'} — 원천{' '}
        <Link to={`/wiki/sources/${filed.id}`} className="font-mono text-[var(--smsg-blue-700)] underline">
          {filed.short}
        </Link>{' '}
        · 범위 {scopeLabel(filed.audience)}
        {!filed.dedup && ' · 들이기 줄에 넣었다'}
      </p>
    )
  }
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
      <select
        aria-label="결과"
        value={outcome}
        onChange={(e) => setOutcome(e.target.value as Outcome)}
        className="rounded-md border border-[var(--smsg-gray-300)] bg-[var(--smsg-surface)] px-2 py-1 text-sm text-[var(--smsg-gray-900)]"
      >
        {OUTCOMES.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={busy}
        onClick={() => run(async () => {
          setFiled(await filebackWikiAnswer({
            question,
            answer,
            citations: citations.map(({ n, slug, block_id }) => ({ n, slug, block_id })),
            outcome,
            audience: done.scope,
          }))
        })}
      >
        위키에 남기기
      </Button>
      {done.scope && <span className="text-xs text-[var(--smsg-gray-500)]">범위 {scopeLabel(done.scope)}</span>}
      {alert}
    </div>
  )
}
