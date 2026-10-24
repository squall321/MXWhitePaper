// AI 위키 검토 큐 `/wiki/changes` · 한 건 `/wiki/changes/:id` — 문서별 블록 앞 · 뒤 · 까닭 · 검증 · 근거 · 승인 · 거절 · 되돌리기
/**
 * request §5-5. 검토자(표지 `wiki_reviewer` · admin)만 본다 — 아니면 서버가 403. 승인은 검토 대기만, 검증 실패가 있으면 서버가 409.
 * 거절에는 까닭 한 줄이 꼭 있어야 한다. 계획 밖 문서의 연산은 승인해도 반영되지 않는다(서버가 계획의 문서만 반영한다).
 * 관계(W5)는 문서 카드 아래 따로 — 코드가 단 것 · AI 가 낸 것, 끝이 후보 밖이라 버린 것. 합치기 묶음은 두 엔티티의 제안 때 모습 ·
 * (반영했으면) 다시 이은 문서 · 다시 들일 원천.
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Badge, type BadgeTone } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import { toast } from '@/components/ui/Toast'
import {
  decideWikiChange, getWikiChange, kst, listWikiChanges, type WikiChange, type WikiChangeOp, type WikiVerdict,
} from '@/features/wiki/api'
import { WikiError, WikiShell } from '@/features/wiki/WikiNav'

const STATUSES = [
  ['pending_review', '검토 대기'], ['failed', '실패'], ['auto_applied', '자동 반영'], ['applied', '승인 반영'],
  ['rejected', '거절'], ['reverted', '되돌림'],
] as const
const STATUS_LABEL: Record<string, string> = Object.fromEntries(STATUSES)
const STATUS_TONE: Record<string, BadgeTone> = {
  pending_review: 'warn', failed: 'error', auto_applied: 'success', applied: 'success', rejected: 'muted', reverted: 'muted',
}
const VERDICT_TONE: Record<WikiVerdict, BadgeTone> = { pass: 'success', warn: 'warn', review: 'info', fail: 'error' }
const OP_LABEL: Record<WikiChangeOp['op'], string> = { 'block.insert': '넣기', 'block.update': '고치기', 'block.delete': '지우기' }

export function WikiChangesPage() {
  const [params, setParams] = useSearchParams()
  const status = params.get('status') ?? 'pending_review'
  const q = useQuery({ queryKey: ['wiki', 'changes', status], queryFn: () => listWikiChanges(status), retry: false })
  return (
    <WikiShell title="검토 큐" testId="wiki-changes" subtitle="AI 의 쓰기는 변경 묶음 하나 — 함께 검증하고 함께 반영하고 함께 되돌린다.">
      <div className="mb-4 flex flex-wrap gap-1" role="tablist">
        {STATUSES.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={status === key}
            onClick={() => setParams({ status: key })}
            className={`rounded-full px-3 py-1 text-sm ${status === key
              ? 'bg-smsg-100 font-medium text-smsg-800 dark:bg-gray-800 dark:text-gray-100'
              : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {q.isError && <WikiError error={q.error} onRetry={() => void q.refetch()} />}
      {q.isPending && <Skeleton className="h-32" />}
      {q.isSuccess && (
        <Card padded={false} data-testid="wiki-changes-list">
          {q.data.rows.length === 0 && <p className="p-6 text-sm text-gray-500">이 상태의 묶음이 없다.</p>}
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {q.data.rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 px-4 py-3 text-sm">
                <Link to={`/wiki/changes/${r.id}`} className="font-mono text-smsg-700 hover:underline dark:text-smsg-300">{r.short}</Link>
                <Badge tone={STATUS_TONE[r.status] ?? 'neutral'}>{STATUS_LABEL[r.status] ?? r.status}</Badge>
                <span className="text-gray-500">{r.source.short}</span>
                <span className="min-w-0 flex-1 truncate text-gray-800 dark:text-gray-200">
                  {r.docs.map((d) => d.title).join(' · ') || '(고칠 문서 없음)'}
                </span>
                {r.rules.map((rule) => <Badge key={rule} tone="warn">{rule}</Badge>)}
                <span className="font-mono text-xs text-gray-500">{kst(r.created_at)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </WikiShell>
  )
}

function OpRow({ op }: { op: WikiChangeOp }) {
  return (
    <li className="py-3" data-testid="wiki-change-op">
      <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
        <Badge tone={op.op === 'block.delete' ? 'error' : op.op === 'block.update' ? 'info' : 'brand'}>{OP_LABEL[op.op]}</Badge>
        {op.section && <span className="text-gray-600 dark:text-gray-400">§ {op.section}</span>}
        <span className="font-mono text-gray-400">{op.block_id}</span>
        <span className="text-gray-700 dark:text-gray-300">— {op.why}</span>
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        <div className="rounded border border-rose-100 bg-rose-50/60 p-2 text-sm text-gray-800 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-gray-200">
          <p className="mb-0.5 text-[11px] text-rose-700 dark:text-rose-300">앞</p>
          <p className="whitespace-pre-wrap">{op.before ?? '—'}</p>
        </div>
        <div className="rounded border border-emerald-100 bg-emerald-50/60 p-2 text-sm text-gray-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-gray-200">
          <p className="mb-0.5 text-[11px] text-emerald-700 dark:text-emerald-300">뒤</p>
          <p className="whitespace-pre-wrap">{op.after ?? '—'}</p>
        </div>
      </div>
      {op.cites.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-xs text-gray-600 dark:text-gray-400">
          {op.cites.map((c, i) => (
            <li key={i}>
              근거 <span className="font-mono">{c.short}</span> {c.title}
              {c.quote && <> — “{c.quote.length > 120 ? `${c.quote.slice(0, 120)}…` : c.quote}”</>}
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

function RelationsCard({ cs }: { cs: WikiChange }) {
  const rows = cs.relations ?? []
  const dropped = cs.relations_dropped ?? []
  if (rows.length === 0 && dropped.length === 0) return null
  return (
    <Card padded="lg" className="mb-4" data-testid="wiki-change-relations">
      <h2 className="mb-2 text-sm font-semibold text-smsg-900 dark:text-gray-100">관계</h2>
      <ul className="space-y-1.5 text-sm">
        {rows.map((r) => (
          <li key={`${r.subject} ${r.predicate} ${r.object}`} className="flex flex-wrap items-center gap-1.5">
            <Badge tone={r.origin === 'code' ? 'muted' : 'brand'}>{r.origin === 'code' ? '코드' : 'AI'}</Badge>
            <span className="text-gray-900 dark:text-gray-100">{r.subject_title}</span>
            <span className="text-gray-400" aria-hidden>→</span>
            <span className="text-gray-900 dark:text-gray-100">{r.object_title}</span>
            <span className="text-gray-700 dark:text-gray-300">{r.label}</span>
            <span className="font-mono text-xs text-gray-400">{r.predicate}</span>
            <span className="text-xs text-gray-600 dark:text-gray-400">— {r.why}</span>
            {r.cites.map((c) => <span key={c.short} className="font-mono text-xs text-gray-500">{c.short}</span>)}
          </li>
        ))}
      </ul>
      {dropped.length > 0 && (
        <p className="mt-2 text-xs text-gray-500">
          버린 관계 — {dropped.map((d) => `${d.subject} ${d.predicate} ${d.object}(${d.why})`).join(' · ')}
        </p>
      )}
    </Card>
  )
}

function MergesCard({ cs }: { cs: WikiChange }) {
  const rows = cs.merges ?? []
  if (rows.length === 0) return null
  return (
    <Card padded="lg" className="mb-4" data-testid="wiki-change-merges">
      <h2 className="mb-2 text-sm font-semibold text-smsg-900 dark:text-gray-100">합치기</h2>
      {rows.map((m) => (
        <div key={m.from.id} className="space-y-2 text-sm">
          <p className="flex flex-wrap items-center gap-1.5">
            <Badge tone="muted">{m.from.type_key}</Badge>
            <Link to={`/wiki/entities/${m.from.id}`} className="hover:underline">{m.from.name}</Link>
            <span className="text-gray-400" aria-hidden>→</span>
            <Link to={`/wiki/entities/${m.into.id}`} className="font-medium hover:underline">{m.into.name}</Link>
            <span className="text-xs text-gray-600 dark:text-gray-400">— {m.why}</span>
          </p>
          <div className="grid gap-2 md:grid-cols-2">
            {([['없어질 쪽', m.from], ['남을 쪽', m.into]] as const).map(([label, side]) => (
              <div key={side.id} className="rounded border border-gray-200 p-2 text-xs text-gray-700 dark:border-gray-700 dark:text-gray-300">
                <p className="mb-0.5 text-[11px] text-gray-500">{label} · {side.audience.join(', ')}</p>
                <p>별칭 {side.aliases.join(', ') || '—'}</p>
                <p className="font-mono">외부 id {Object.entries(side.ext_ids).map(([k, v]) => `${k}=${v}`).join(' · ') || '—'}</p>
              </div>
            ))}
          </div>
          {m.applied && (
            <p className="text-xs text-gray-600 dark:text-gray-400">
              다시 이은 문서 {m.applied.pages.map((p) => `${p.slug}${p.stale ? '(낡음 — 같은 범위 문서가 있다)' : ''}`).join(', ') || '없음'}
              {m.applied.reingest.length > 0 && ` · 다시 들일 원천 ${m.applied.reingest.length}`}
            </p>
          )}
        </div>
      ))}
    </Card>
  )
}

export function WikiChangePage() {
  const { id = '' } = useParams<{ id: string }>()
  const qc = useQueryClient()
  const [note, setNote] = useState('')
  const q = useQuery({ queryKey: ['wiki', 'change', id], queryFn: () => getWikiChange(id), retry: false, enabled: !!id })
  const decide = useMutation({
    mutationFn: (action: 'approve' | 'reject' | 'revert') => decideWikiChange(id, action, note.trim()),
    onSuccess: (res) => {
      toast.success(`묶음 → ${STATUS_LABEL[res.status] ?? res.status}`)
      setNote('')
      void qc.invalidateQueries({ queryKey: ['wiki'] })
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '처리 실패'),
  })

  if (q.isError) {
    return <WikiShell title="변경 묶음" testId="wiki-change"><WikiError error={q.error} onRetry={() => void q.refetch()} /></WikiShell>
  }
  const cs = q.data
  if (!cs) return <WikiShell title="변경 묶음" testId="wiki-change"><Skeleton className="h-64" /></WikiShell>
  const hasFail = cs.validation.some((c) => c.verdict === 'fail')
  return (
    <WikiShell
      title={`변경 묶음 ${cs.short}`}
      testId="wiki-change"
      subtitle={[cs.op, `원천 ${cs.source.short ?? '—'}`, `규칙서 v${cs.schema_version}`, cs.model, `${kst(cs.created_at)} KST`]
        .filter(Boolean).join(' · ')}
    >
      <Card padded="lg" className="mb-4">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Badge tone={STATUS_TONE[cs.status] ?? 'neutral'}>{STATUS_LABEL[cs.status] ?? cs.status}</Badge>
          {cs.audience.map((a) => <Badge key={a} tone={a === 'org' ? 'neutral' : 'warn'}>{a === 'org' ? '전사' : a}</Badge>)}
          {cs.error && <span className="text-xs text-rose-700 dark:text-rose-300">{cs.error}</span>}
        </div>
        {cs.summary && <p className="text-sm text-gray-800 dark:text-gray-200">{cs.summary}</p>}
        {cs.decision.at && (
          <p className="mt-2 text-xs text-gray-500">결정 {kst(cs.decision.at)} KST{cs.decision.note ? ` — ${cs.decision.note}` : ''}</p>
        )}
      </Card>

      <Card padded="lg" className="mb-4" data-testid="wiki-change-validation">
        <h2 className="mb-2 text-sm font-semibold text-smsg-900 dark:text-gray-100">검증</h2>
        <ul className="space-y-1 text-sm">
          {cs.validation.map((c) => (
            <li key={c.rule} className="flex gap-2">
              <span className="w-10 font-mono text-xs text-gray-500">{c.rule}</span>
              <Badge tone={VERDICT_TONE[c.verdict]}>{c.verdict}</Badge>
              <span className="min-w-0 flex-1 text-xs text-gray-700 dark:text-gray-300">{c.detail}</span>
            </li>
          ))}
        </ul>
      </Card>

      {cs.docs.map((d) => (
        <Card key={d.slug} padded="lg" className="mb-4">
          <h2 className="flex flex-wrap items-center gap-2 text-base font-semibold text-smsg-900 dark:text-gray-100">
            {d.new ? d.title : <Link to={`/docs/${d.slug}`} className="hover:underline">{d.title}</Link>}
            {d.new && <Badge tone="brand">새 문서</Badge>}
            <span className="font-mono text-xs font-normal text-gray-500">{d.slug}</span>
          </h2>
          {d.why && <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">까닭 — {d.why}</p>}
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {d.ops.map((op) => <OpRow key={op.block_id} op={op} />)}
          </ul>
        </Card>
      ))}

      <RelationsCard cs={cs} />
      <MergesCard cs={cs} />

      {(cs.status === 'pending_review' || cs.status === 'failed' || cs.status === 'applied' || cs.status === 'auto_applied') && (
        <Card padded="lg" data-testid="wiki-change-actions">
          {cs.status !== 'applied' && cs.status !== 'auto_applied' && (
            <label className="mb-3 block text-sm">
              <span className="text-gray-600 dark:text-gray-400">까닭(거절은 꼭)</span>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={1000}
                className="mt-1 w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900"
              />
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            {cs.status === 'pending_review' && (
              <Button disabled={decide.isPending || hasFail} onClick={() => decide.mutate('approve')}>승인 · 반영</Button>
            )}
            {(cs.status === 'pending_review' || cs.status === 'failed') && (
              <Button variant="secondary" disabled={decide.isPending || !note.trim()} onClick={() => decide.mutate('reject')}>
                거절
              </Button>
            )}
            {(cs.status === 'applied' || cs.status === 'auto_applied') && (
              <Button variant="danger" disabled={decide.isPending} onClick={() => decide.mutate('revert')}>되돌리기</Button>
            )}
          </div>
        </Card>
      )}
    </WikiShell>
  )
}
