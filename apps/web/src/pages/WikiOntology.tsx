// AI 위키 온톨로지 `/wiki/ontology` — 엔티티 유형 · 술어 표(상태 · 바깥 어휘 · 정의역 → 치역) · 제안(editor) · 승인 · 거절(admin, 까닭 꼭)
/**
 * docs/llm-wiki W5 · request §5-10 — 용어집과 같은 길. 들이기는 승인된 것만 쓴다. 이름에는 범위가 없어 제안 · 거절까지 누구나 본다.
 * 위임 호출(AI)은 admin 이 owner 로 깎여 승인 단추를 눌러도 서버가 403 이다.
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Badge, type BadgeTone } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import { toast } from '@/components/ui/Toast'
import { useAuthStore } from '@/features/auth/store'
import {
  decideWikiOntology, getWikiOntology, proposeWikiPredicate, proposeWikiType, type OntologyStatus,
} from '@/features/wiki/api'
import { WikiError, WikiShell } from '@/features/wiki/WikiNav'
import { toApiError } from '@/lib/api/envelope'

// 위키 화면의 입력칸 — 공용 Input 은 어두운 화면에서 흰 바탕이라 다른 위키 입력칸(검토 까닭)과 꼴을 맞춘다
const FIELD = 'w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:placeholder:text-gray-600'
const STATUS: Record<OntologyStatus, [string, BadgeTone]> = {
  approved: ['승인', 'success'], proposed: ['제안', 'warn'], rejected: ['거절', 'muted'],
}
const TH = 'px-3 py-2 text-left text-xs font-medium text-gray-500'
const TD = 'px-3 py-2 align-top text-sm text-gray-800 dark:text-gray-200'

function Decide({ kind, keyName }: { kind: 'types' | 'predicates'; keyName: string }) {
  const qc = useQueryClient()
  const [note, setNote] = useState('')
  const m = useMutation({
    mutationFn: (action: 'approve' | 'reject') => decideWikiOntology(kind, keyName, action, note.trim()),
    onSuccess: (res) => {
      toast.success(`${keyName} → ${STATUS[res.status][0]}`)
      void qc.invalidateQueries({ queryKey: ['wiki', 'ontology'] })
    },
    onError: (err) => toast.error(toApiError(err).message),
  })
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      <Button size="sm" disabled={m.isPending} onClick={() => m.mutate('approve')}>승인</Button>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="거절 까닭"
        aria-label={`${keyName} 거절 까닭`}
        className="w-36 rounded border border-gray-300 bg-white px-2 py-1 text-xs dark:border-gray-700 dark:bg-gray-900"
      />
      <Button size="sm" variant="secondary" disabled={m.isPending || !note.trim()} onClick={() => m.mutate('reject')}>거절</Button>
    </div>
  )
}

function ProposeForms() {
  const qc = useQueryClient()
  const [type, setType] = useState({ key: '', label_ko: '', abbr: '' })
  const [pred, setPred] = useState({ key: '', label_ko: '', inverse_ko: '', domain: '', range: '' })
  const done = (what: string) => {
    toast.success(`${what} 제안 — admin 이 승인하면 들이기가 쓴다`)
    void qc.invalidateQueries({ queryKey: ['wiki', 'ontology'] })
  }
  const fail = (err: unknown) => toast.error(toApiError(err).message)
  const list = (v: string) => v.split(',').map((x) => x.trim()).filter(Boolean)
  const t = useMutation({ mutationFn: () => proposeWikiType(type), onSuccess: () => done('유형'), onError: fail })
  const p = useMutation({
    mutationFn: () => proposeWikiPredicate({ key: pred.key, label_ko: pred.label_ko, inverse_ko: pred.inverse_ko,
      domain_types: list(pred.domain), range_types: list(pred.range), symmetric: false }),
    onSuccess: () => done('술어'),
    onError: fail,
  })
  return (
    <Card padded="lg" className="mb-4" data-testid="wiki-ontology-propose">
      <h2 className="mb-2 text-sm font-semibold text-smsg-900 dark:text-gray-100">제안</h2>
      <div className="grid gap-3 md:grid-cols-2">
        <form className="space-y-1.5" onSubmit={(e) => { e.preventDefault(); t.mutate() }}>
          <p className="text-xs text-gray-500">유형 — key(영소문자 · 숫자 · -) · 이름 · slug 약어</p>
          <input className={FIELD} aria-label="유형 key" placeholder="jig" value={type.key} onChange={(e) => setType({ ...type, key: e.target.value })} />
          <input className={FIELD} aria-label="유형 이름" placeholder="지그" value={type.label_ko} onChange={(e) => setType({ ...type, label_ko: e.target.value })} />
          <input className={FIELD} aria-label="slug 약어" placeholder="jig" value={type.abbr} onChange={(e) => setType({ ...type, abbr: e.target.value })} />
          <Button type="submit" size="sm" disabled={t.isPending || !type.key || !type.label_ko || !type.abbr}>유형 제안</Button>
        </form>
        <form className="space-y-1.5" onSubmit={(e) => { e.preventDefault(); p.mutate() }}>
          <p className="text-xs text-gray-500">술어 — 「A 는 B ○○」 의 ○○ · 역 · 정의역 → 치역(쉼표, 비우면 아무 유형)</p>
          <input className={FIELD} aria-label="술어 key" placeholder="made-of" value={pred.key} onChange={(e) => setPred({ ...pred, key: e.target.value })} />
          <input className={FIELD} aria-label="술어 이름" placeholder="로 만든다" value={pred.label_ko} onChange={(e) => setPred({ ...pred, label_ko: e.target.value })} />
          <input className={FIELD} aria-label="역 이름" placeholder="로 만든 것이다" value={pred.inverse_ko} onChange={(e) => setPred({ ...pred, inverse_ko: e.target.value })} />
          <div className="flex gap-1">
            <input className={FIELD} aria-label="정의역" placeholder="part" value={pred.domain} onChange={(e) => setPred({ ...pred, domain: e.target.value })} />
            <input className={FIELD} aria-label="치역" placeholder="material" value={pred.range} onChange={(e) => setPred({ ...pred, range: e.target.value })} />
          </div>
          <Button type="submit" size="sm" disabled={p.isPending || !pred.key || !pred.label_ko || !pred.inverse_ko}>술어 제안</Button>
        </form>
      </div>
    </Card>
  )
}

export function WikiOntologyPage() {
  const role = useAuthStore((s) => s.user?.role)
  const q = useQuery({ queryKey: ['wiki', 'ontology'], queryFn: getWikiOntology, retry: false })
  const canPropose = role === 'editor' || role === 'owner' || role === 'admin'
  return (
    <WikiShell title="온톨로지" testId="wiki-ontology" subtitle="엔티티 유형 · 술어 — 들이기는 승인된 것만 쓴다(새 유형 · 술어는 제안 → admin 승인).">
      {q.isError && <WikiError error={q.error} onRetry={() => void q.refetch()} />}
      {q.isPending && <Skeleton className="h-64" />}
      {canPropose && q.isSuccess && <ProposeForms />}
      {q.isSuccess && (
        <>
          <Card padded={false} className="mb-4 overflow-x-auto" data-testid="wiki-ontology-types">
            <h2 className="px-4 pt-4 text-sm font-semibold text-smsg-900 dark:text-gray-100">유형 {q.data.types.length}</h2>
            <table className="w-full">
              <thead><tr><th className={TH}>key</th><th className={TH}>이름</th><th className={TH}>약어</th>
                <th className={TH}>바깥 어휘 · 외부 id 칸</th><th className={TH}>엔티티</th><th className={TH}>상태</th></tr></thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {q.data.types.map((t) => (
                  <tr key={t.key}>
                    <td className={`${TD} font-mono text-xs`}>{t.key}</td>
                    <td className={TD}>{t.label_ko}{t.parent_key && <span className="text-xs text-gray-500"> · 상위 {t.parent_key}</span>}</td>
                    <td className={`${TD} font-mono text-xs`}>{t.abbr}</td>
                    <td className={`${TD} text-xs text-gray-600 dark:text-gray-400`}>
                      {[t.ext_axes.ra && `RA ${t.ext_axes.ra}`, t.ext_axes.sp && `SP ${t.ext_axes.sp}`, t.ext_axes.other]
                        .filter(Boolean).join(' · ')}
                      {(t.ext_axes.ext_ids ?? []).length > 0 && (
                        <div className="font-mono text-gray-500">{(t.ext_axes.ext_ids ?? []).join(', ')}</div>
                      )}
                    </td>
                    <td className={TD}>{t.entities}</td>
                    <td className={TD}>
                      <Badge tone={STATUS[t.status][1]}>{STATUS[t.status][0]}</Badge>
                      {t.decision_note && <div className="text-xs text-gray-500">{t.decision_note}</div>}
                      {t.status === 'proposed' && role === 'admin' && <Decide kind="types" keyName={t.key} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <Card padded={false} className="overflow-x-auto" data-testid="wiki-ontology-predicates">
            <h2 className="px-4 pt-4 text-sm font-semibold text-smsg-900 dark:text-gray-100">술어 {q.data.predicates.length}</h2>
            <table className="w-full">
              <thead><tr><th className={TH}>key</th><th className={TH}>읽는 법</th><th className={TH}>역</th>
                <th className={TH}>주어 → 목적어</th><th className={TH}>상태</th></tr></thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {q.data.predicates.map((p) => (
                  <tr key={p.key}>
                    <td className={`${TD} font-mono text-xs`}>{p.key}</td>
                    <td className={TD}>A 는 B {p.label_ko}{p.symmetric && <Badge tone="info" className="ml-1">대칭</Badge>}</td>
                    <td className={TD}>B 는 A {p.inverse_ko}</td>
                    <td className={`${TD} font-mono text-xs`}>
                      {p.domain_types.join(' · ') || '아무 유형'} → {p.range_types.join(' · ') || '아무 유형'}
                    </td>
                    <td className={TD}>
                      <Badge tone={STATUS[p.status][1]}>{STATUS[p.status][0]}</Badge>
                      {p.decision_note && <div className="text-xs text-gray-500">{p.decision_note}</div>}
                      {p.status === 'proposed' && role === 'admin' && <Decide kind="predicates" keyName={p.key} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </WikiShell>
  )
}
