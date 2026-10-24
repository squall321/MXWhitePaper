// AI 위키 내 후보 `/wiki/candidates` — 포털 챗이 '해결된 턴' 으로 보낸 주인만 보는 원천을 범위를 골라 승인(→ 들이기)하거나 버린다
/**
 * docs/llm-wiki W6 · request §6-3(사람 결정 Q1 — B 후보 + 한 번 승인). 주인만 본다(admin 도 남의 후보는 못 본다). 기한(규칙서
 * `qa.candidate_ttl_days`, 기본 7일)이 지나면 서버가 저절로 철회한다. 범위는 포털이 보낸 것 또는 나만 — 전사는 admin 만(원천 받기 규칙).
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import { toast } from '@/components/ui/Toast'
import { useAuthStore } from '@/features/auth/store'
import {
  approveWikiCandidate, discardWikiCandidate, kst, listWikiCandidates, type WikiCandidate,
} from '@/features/wiki/api'
import { WikiError, WikiShell } from '@/features/wiki/WikiNav'
import { toApiError } from '@/lib/api/envelope'

const KIND: Record<string, string> = { qa: '문답', deliberation: '심의', note: '메모' }

function scopeLabel(aud: string[], me: string): string {
  return aud.length === 1 && aud[0] === me ? '나만' : aud.join(' · ')
}

function Row({ c, me }: { c: WikiCandidate; me: string }) {
  const qc = useQueryClient()
  const options = [c.suggested_audience, [me]].filter((a, i, all) => all.findIndex((b) => b.join() === a.join()) === i)
  const [pick, setPick] = useState(0)
  const done = () => void qc.invalidateQueries({ queryKey: ['wiki', 'candidates'] })
  const fail = (err: unknown) => toast.error(toApiError(err).message)
  const approve = useMutation({
    mutationFn: () => approveWikiCandidate(c.id, options[pick]),
    onSuccess: (res) => { toast.success(`들인다 — ${res.short} · ${scopeLabel(res.audience, me)}`); done() },
    onError: fail,
  })
  const discard = useMutation({ mutationFn: () => discardWikiCandidate(c.id), onSuccess: () => { toast.success('버렸다'); done() }, onError: fail })
  return (
    <li className="flex flex-wrap items-center gap-2 px-4 py-3 text-sm" data-testid="wiki-candidate">
      <Badge tone="muted">{KIND[c.kind] ?? c.kind}</Badge>
      <span className="min-w-0 flex-1">
        {c.doc_slug ? <Link to={`/docs/${c.doc_slug}`} className="font-medium hover:underline">{c.title}</Link> : c.title}
        <span className="block text-xs text-gray-500">{c.system} · {kst(c.received_at)} 받음 · {kst(c.expires_at)} 까지</span>
      </span>
      <select aria-label="범위" value={pick} onChange={(e) => setPick(Number(e.target.value))}
        className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-900">
        {options.map((a, i) => <option key={a.join()} value={i}>{scopeLabel(a, me)}</option>)}
      </select>
      <Button size="sm" disabled={approve.isPending || discard.isPending} onClick={() => approve.mutate()}>승인 · 들이기</Button>
      <Button size="sm" variant="secondary" disabled={approve.isPending || discard.isPending} onClick={() => discard.mutate()}>버림</Button>
    </li>
  )
}

export function WikiCandidatesPage() {
  const me = `user:${useAuthStore((s) => s.user?.id) ?? ''}`
  const q = useQuery({ queryKey: ['wiki', 'candidates'], queryFn: listWikiCandidates, retry: false })
  return (
    <WikiShell title="내 후보" testId="wiki-candidates" subtitle="포털 챗이 '해결된 턴' 으로 보낸 것 — 나만 본다. 범위를 골라 승인하면 위키에 들인다(자동 승인은 없다).">
      {q.isError && <WikiError error={q.error} onRetry={() => void q.refetch()} />}
      {q.isPending && <Skeleton className="h-32" />}
      {q.isSuccess && (
        <Card padded={false} data-testid="wiki-candidates-list">
          {q.data.length === 0 && <p className="p-6 text-sm text-gray-500">후보가 없다.</p>}
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {q.data.map((c) => <Row key={c.id} c={c} me={me} />)}
          </ul>
        </Card>
      )}
    </WikiShell>
  )
}
