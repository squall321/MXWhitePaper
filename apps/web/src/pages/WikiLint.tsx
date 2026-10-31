// AI 위키 점검 `/wiki/lint` — 결함(규칙 아홉)을 규칙 · 상태로 거르고, 고침 묶음 · 남긴 질문으로 잇고, 검토자는 버리거나 점검을 줄 세운다(docs/llm-wiki W7)
/**
 * 결함은 서버가 읽는 사람의 범위로 거른다(좁은 문서의 결함은 그 범위를 다 가진 사람에게만). 같은 결함은 한 줄로 이어진다 — 버린
 * 결함은 다음 점검에도 다시 열리지 않는다. 빠진 링크는 점검이 결정적으로 고쳐 '고침' 으로 가고, 모순 · 빈틈은 질문을 남긴다.
 */
import { useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Badge, type BadgeTone } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import { toast } from '@/components/ui/Toast'
import {
  dismissWikiFinding, kst, listWikiFindings, runWikiLint, type WikiFinding, type WikiLintRule,
} from '@/features/wiki/api'
import { WikiError, WikiShell } from '@/features/wiki/WikiNav'
import { toApiError } from '@/lib/api/envelope'

const FIELD = 'w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:placeholder:text-gray-600'
const SELECT = 'rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100'
const RULES: [WikiLintRule, string][] = [
  ['contradiction', '서로 다른 말'], ['stale', '낡음'], ['gap', '빈틈'], ['uncited', '근거 없음'], ['missing_link', '빠진 링크'],
  ['missing_page', '빠진 문서'], ['orphan', '고아'], ['schema', '꼴'], ['stuck_review', '밀린 검토'],
]
const LABEL = Object.fromEntries(RULES) as Record<WikiLintRule, string>
const TONE: Record<WikiFinding['severity'], BadgeTone> = { error: 'error', warn: 'warn', info: 'info' }
const STATUS: Record<WikiFinding['status'], string> = { open: '열림', question_raised: '질문 남김', fixed: '고침', dismissed: '버림' }
type View = 'open' | 'fixed' | 'dismissed'

function pill(active: boolean): string {
  return `rounded-full px-3 py-1 text-sm ${active
    ? 'bg-smsg-100 font-medium text-smsg-800 dark:bg-gray-800 dark:text-gray-100'
    : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'}`
}

function Extra({ f }: { f: WikiFinding }) {
  const d = f.detail
  const items: ReactNode[] = []
  if (f.rule === 'contradiction' && Array.isArray(d.differs) && d.differs.length > 0) {
    items.push(<span key="differs">다른 점 — {(d.differs as { key: string; a: string; b: string }[]).slice(0, 3)
      .map((x) => `${x.key} ${x.a} vs ${x.b}`).join(' · ')}</span>)
  }
  if (Array.isArray(d.reingest) && d.reingest.length > 0) {
    items.push(<span key="reingest">다시 들일 원천 {(d.reingest as string[]).map((id) => (
      <Link key={id} to={`/wiki/sources/${id}`} className="ml-1 font-mono hover:underline">src_{id.replace(/-/g, '').slice(0, 8)}</Link>
    ))}</span>)
  }
  if (Array.isArray(d.missing)) items.push(<span key="missing">없는 절 — {(d.missing as string[]).join(' · ')}</span>)
  if (typeof d.why === 'string' && d.why) items.push(<span key="why">{d.why}</span>)
  if (typeof d.changeset === 'string') {
    items.push(<Link key="cs" to={`/wiki/changes/${d.changeset}`} className="hover:underline">고침 묶음({String(d.fix_status ?? '')})</Link>)
  }
  if (f.question_id) items.push(<Link key="q" to="/wiki/questions" className="hover:underline">남긴 질문</Link>)
  return items.length ? <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-600 dark:text-gray-400">{items}</p> : null
}

function Row({ f }: { f: WikiFinding }) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const dismiss = useMutation({
    mutationFn: () => dismissWikiFinding(f.id, note.trim()),
    onSuccess: () => { toast.success('버렸다 — 다음 점검에도 다시 열리지 않는다'); void qc.invalidateQueries({ queryKey: ['wiki', 'lint'] }) },
    onError: (err) => toast.error(toApiError(err).message),
  })
  return (
    <li className="px-4 py-3 text-sm" data-testid="wiki-finding">
      <div className="flex flex-wrap items-start gap-2">
        <Badge tone={TONE[f.severity]}>{LABEL[f.rule] ?? f.rule}</Badge>
        <div className="min-w-0 flex-1">
          <p className="text-gray-900 dark:text-gray-100">{f.title}</p>
          {f.docs.length > 0 && (
            <p className="mt-0.5 text-xs">{f.docs.map((d) => (
              <Link key={d.slug} to={`/docs/${d.slug}`} className="mr-2 text-smsg-700 hover:underline dark:text-[#5C7CFF]">{d.title}</Link>
            ))}</p>
          )}
          <Extra f={f} />
          <p className="mt-1 text-xs text-gray-500">{STATUS[f.status]} · 처음 {kst(f.first_seen_at)} · 마지막 {kst(f.last_seen_at)}</p>
        </div>
        {f.status !== 'dismissed' && f.status !== 'fixed' && !open && (
          <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>버리기</Button>
        )}
      </div>
      {open && (
        <div className="mt-2 flex gap-2">
          <input className={FIELD} value={note} onChange={(e) => setNote(e.target.value)} placeholder="버리는 까닭(꼭)" aria-label="버리는 까닭" />
          <Button size="sm" disabled={!note.trim() || dismiss.isPending} onClick={() => dismiss.mutate()}>확인</Button>
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>그만</Button>
        </div>
      )}
    </li>
  )
}

export function WikiLintPage() {
  const qc = useQueryClient()
  const [rule, setRule] = useState<WikiLintRule | null>(null)
  const [view, setView] = useState<View>('open')
  const q = useQuery({
    queryKey: ['wiki', 'lint', rule, view],
    queryFn: () => listWikiFindings({ rule: rule ?? undefined, status: view === 'open' ? undefined : view }),
    retry: false,
  })
  const run = useMutation({
    mutationFn: () => runWikiLint({ scope: 'full' }),
    onSuccess: () => { toast.success('점검을 줄 세웠다 — 워커가 돌면 결과가 바뀐다'); void qc.invalidateQueries({ queryKey: ['wiki', 'lint'] }) },
    onError: (err) => toast.error(toApiError(err).message),
  })
  const last = q.data?.meta.last_run
  const counts = q.data?.meta.by_rule ?? {}
  return (
    <WikiShell
      title="점검"
      testId="wiki-lint"
      subtitle={last
        ? `마지막 점검 ${kst(last.finished_at)} KST · ${last.scope.split(':')[0]}${last.llm ? ' · 글 모순 LLM' : ''}${last.error ? ' · 실패' : ''}`
        : '아직 점검하지 않았다 — 밤마다 돈다(규칙서 lint.nightly_at).'}
    >
      <div className="mb-4 flex flex-wrap items-center gap-1">
        <button type="button" onClick={() => setRule(null)} aria-pressed={rule === null} className={pill(rule === null)}>
          전부 {view === 'open' && <span className="text-xs text-gray-500">{Object.values(counts).reduce((a, b) => a + (b ?? 0), 0)}</span>}
        </button>
        {RULES.map(([key, label]) => (
          <button key={key} type="button" onClick={() => setRule(key)} aria-pressed={rule === key} className={pill(rule === key)}>
            {label} {view === 'open' && counts[key] ? <span className="text-xs text-gray-500">{counts[key]}</span> : null}
          </button>
        ))}
        <span className="flex-1" />
        <select aria-label="상태" value={view} onChange={(e) => setView(e.target.value as View)} className={SELECT}>
          <option value="open">열림 · 질문 남김</option>
          <option value="fixed">고침</option>
          <option value="dismissed">버림</option>
        </select>
        <Button size="sm" variant="secondary" disabled={run.isPending} onClick={() => run.mutate()}>지금 점검</Button>
      </div>
      {q.isError && <WikiError error={q.error} onRetry={() => void q.refetch()} />}
      {q.isPending && <Skeleton className="h-40" />}
      {q.isSuccess && (
        <Card padded={false} data-testid="wiki-lint-list">
          {q.data.rows.length === 0 && <p className="p-6 text-sm text-gray-500">이 갈래에 결함이 없다.</p>}
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {q.data.rows.map((f) => <Row key={f.id} f={f} />)}
          </ul>
        </Card>
      )}
    </WikiShell>
  )
}
