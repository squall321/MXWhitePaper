// AI 위키 질문판 `/wiki/questions` — 위키가 아직 답하지 못한 물음과 지속 질의의 결과(답 원천 · 실험 제안 · 사람이 필요한 까닭), 사람의 답 · 닫기(docs/llm-wiki W7)
/**
 * 물음은 범위째 한 줄이다(같은 물음은 물은 수만 오른다). 지속 질의(워커)가 밤에 위키 → 허용된 읽기 전용 도구 순으로 풀고, 사람만 아는
 * 것은 '사람 필요', 해석 · 시험이 있어야 하면 '실험 제안' 으로 남긴다(돌리지 않는다). 사람이 답하면 그 사람 명의의 원천이 되어 위키에
 * 들어간다. 닫기 · 다시 열기는 남긴 사람 · 검토자만(서버가 본다).
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import { toast } from '@/components/ui/Toast'
import {
  addWikiQuestion, answerWikiQuestion, kst, listWikiQuestions, patchWikiQuestion, type WikiQuestion, type WikiQuestionStatus,
} from '@/features/wiki/api'
import { WikiError, WikiShell } from '@/features/wiki/WikiNav'
import { toApiError } from '@/lib/api/envelope'

const FIELD = 'w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:placeholder:text-gray-600'
const SELECT = 'rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100'
const TABS: [WikiQuestionStatus, string][] = [
  ['open', '열림'], ['asking', '묻는 중'], ['needs_human', '사람 필요'], ['needs_experiment', '실험 제안'], ['answered', '답함'],
  ['closed', '닫힘'], ['dropped', '버림'],
]
const ORIGIN: Record<WikiQuestion['origin'], string> = {
  lint: '점검', ingest: '들이기', user: '사람', query_miss: '묻기 실패', standing: '상시',
}

function pill(active: boolean): string {
  return `rounded-full px-3 py-1 text-sm ${active
    ? 'bg-smsg-100 font-medium text-smsg-800 dark:bg-gray-800 dark:text-gray-100'
    : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'}`
}

function text(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function Result({ q }: { q: WikiQuestion }) {
  const d = q.detail
  const lastTry = (d.last_try ?? null) as { why?: string } | null
  if (q.status === 'answered') {
    return (
      <p className="mt-1 text-xs text-gray-700 dark:text-gray-300">
        답 — {text(d.answer) || '(사람이 남긴 답)'}
        {q.answer_source && <Link to={`/wiki/sources/${q.answer_source.id}`} className="ml-2 font-mono text-smsg-700 hover:underline dark:text-smsg-300">{q.answer_source.short}</Link>}
      </p>
    )
  }
  if (q.status === 'needs_experiment') return <p className="mt-1 text-xs text-gray-700 dark:text-gray-300">제안 — {text(d.proposal)}</p>
  if (q.status === 'needs_human') return <p className="mt-1 text-xs text-gray-700 dark:text-gray-300">사람이 필요한 까닭 — {text(d.why)}</p>
  if (lastTry?.why) return <p className="mt-1 text-xs text-gray-500">지난 시도 — {lastTry.why}</p>
  return null
}

function Row({ q }: { q: WikiQuestion }) {
  const qc = useQueryClient()
  const [answering, setAnswering] = useState(false)
  const [body, setBody] = useState('')
  const done = () => void qc.invalidateQueries({ queryKey: ['wiki', 'questions'] })
  const fail = (err: unknown) => toast.error(toApiError(err).message)
  const patch = useMutation({
    mutationFn: (status: 'open' | 'closed' | 'dropped') => patchWikiQuestion(q.id, { status }),
    onSuccess: (r) => { toast.success(r.status === 'open' ? '다시 열었다' : '닫았다'); done() },
    onError: fail,
  })
  const answer = useMutation({
    mutationFn: () => answerWikiQuestion(q.id, body.trim()),
    onSuccess: (r) => { toast.success(`답을 원천 ${r.source.short} 으로 남겼다 — 위키에 들인다`); setAnswering(false); done() },
    onError: fail,
  })
  const closed = q.status === 'closed' || q.status === 'dropped'
  return (
    <li className="px-4 py-3 text-sm" data-testid="wiki-question">
      <div className="flex flex-wrap items-start gap-2">
        <Badge tone="muted">{ORIGIN[q.origin] ?? q.origin}</Badge>
        <Badge tone={q.priority <= 2 ? 'warn' : 'neutral'}>P{q.priority}</Badge>
        <div className="min-w-0 flex-1">
          <p className="text-gray-900 dark:text-gray-100">{q.text}</p>
          <Result q={q} />
          <p className="mt-1 text-xs text-gray-500">
            물은 수 {q.asked_count} · 시도 {q.attempts} · {kst(q.last_asked_at)}{q.mine ? ' · 내가 남김' : ''} · {q.audience.join(' · ')}
          </p>
        </div>
        <div className="flex gap-1">
          {!closed && q.status !== 'answered' && !answering && (
            <Button size="sm" onClick={() => setAnswering(true)}>답하기</Button>
          )}
          {closed || q.status === 'answered'
            ? <Button size="sm" variant="secondary" disabled={patch.isPending} onClick={() => patch.mutate('open')}>다시 열기</Button>
            : <Button size="sm" variant="secondary" disabled={patch.isPending} onClick={() => patch.mutate('closed')}>닫기</Button>}
        </div>
      </div>
      {answering && (
        <div className="mt-2 space-y-2">
          <textarea className={FIELD} rows={3} value={body} onChange={(e) => setBody(e.target.value)} aria-label="답"
            placeholder="답 — 내 이름의 원천이 되어 위키에 들어간다. 숫자는 단위와 함께." />
          <div className="flex gap-2">
            <Button size="sm" disabled={body.trim().length < 2 || answer.isPending} onClick={() => answer.mutate()}>답 남기기</Button>
            <Button size="sm" variant="ghost" onClick={() => setAnswering(false)}>그만</Button>
          </div>
        </div>
      )}
    </li>
  )
}

function Ask() {
  const qc = useQueryClient()
  const [body, setBody] = useState('')
  const [wide, setWide] = useState(false)
  const add = useMutation({
    mutationFn: () => addWikiQuestion(body.trim(), 'user', wide ? ['org'] : undefined),
    onSuccess: (r) => {
      toast.success(r.created ? '물음을 남겼다 — 밤에 위키가 풀어 본다' : `같은 물음이 있다 — 물은 수 ${r.asked_count}`)
      setBody('')
      void qc.invalidateQueries({ queryKey: ['wiki', 'questions'] })
    },
    onError: (err) => toast.error(toApiError(err).message),
  })
  return (
    <Card padded="lg" className="mb-4">
      <div className="flex flex-wrap items-center gap-2">
        <input className={`${FIELD} min-w-0 flex-1`} value={body} onChange={(e) => setBody(e.target.value)} aria-label="물음"
          placeholder="위키가 아직 답하지 못하는 물음" />
        <select aria-label="범위" value={wide ? 'org' : 'me'} onChange={(e) => setWide(e.target.value === 'org')} className={SELECT}>
          <option value="me">나만</option>
          <option value="org">전사</option>
        </select>
        <Button size="sm" disabled={body.trim().length < 2 || add.isPending} onClick={() => add.mutate()}>남기기</Button>
      </div>
    </Card>
  )
}

export function WikiQuestionsPage() {
  const [status, setStatus] = useState<WikiQuestionStatus>('open')
  const q = useQuery({ queryKey: ['wiki', 'questions', status], queryFn: () => listWikiQuestions(status), retry: false })
  return (
    <WikiShell title="질문판" testId="wiki-questions"
      subtitle="밤마다 지속 질의가 위키 → 허용된 읽기 전용 도구 순으로 풀어 본다. 사람만 아는 것은 '사람 필요', 해석 · 시험이 있어야 하면 '실험 제안'(돌리지 않는다).">
      <Ask />
      <div className="mb-4 flex flex-wrap gap-1">
        {TABS.map(([key, label]) => (
          <button key={key} type="button" onClick={() => setStatus(key)} aria-pressed={status === key} className={pill(status === key)}>
            {label}
          </button>
        ))}
      </div>
      {q.isError && <WikiError error={q.error} onRetry={() => void q.refetch()} />}
      {q.isPending && <Skeleton className="h-40" />}
      {q.isSuccess && (
        <Card padded={false} data-testid="wiki-questions-list">
          {q.data.rows.length === 0 && <p className="p-6 text-sm text-gray-500">이 갈래에 물음이 없다.</p>}
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {q.data.rows.map((x) => <Row key={x.id} q={x} />)}
          </ul>
        </Card>
      )}
    </WikiShell>
  )
}
