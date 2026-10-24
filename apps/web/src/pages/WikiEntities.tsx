// AI 위키 엔티티 등록부 `/wiki/entities` · 한 건 `/wiki/entities/:id` — 목록 · 중복 후보(검토자) · 별칭 · 외부 id 고치기 · 합치기 제안
/**
 * docs/llm-wiki W5 · request §5-10. 서버가 읽는 사람의 범위로 거른다 — 볼 수 있는 문서가 있는 엔티티만, 별칭 · 외부 id 는 그 엔티티를
 * 만든 범위의 사람만(`full`). 합치기는 제안만 여기서 — 변경 묶음(늘 검토)이 되어 검토 큐에서 승인 · 거절한다.
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import { toast } from '@/components/ui/Toast'
import { useAuthStore } from '@/features/auth/store'
import {
  getWikiDuplicates, getWikiEntity, getWikiOntology, listWikiEntities, patchWikiEntity, proposeWikiMerge,
  type WikiEntity,
} from '@/features/wiki/api'
import { WikiError, WikiShell } from '@/features/wiki/WikiNav'

// 위키 화면의 입력칸 — 공용 Input 은 어두운 화면에서 흰 바탕이라 다른 위키 입력칸(검토 까닭)과 꼴을 맞춘다
const FIELD = 'w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:placeholder:text-gray-600'
const STATUS_LABEL: Record<WikiEntity['status'], string> = { active: '살아 있음', merged: '합쳐짐', retired: '내림' }

function useCanEdit(): boolean {
  const role = useAuthStore((s) => s.user?.role)
  return role === 'editor' || role === 'owner' || role === 'admin'
}

function Scope({ audience }: { audience: string[] }) {
  return <>{audience.map((a) => <Badge key={a} tone={a === 'org' ? 'neutral' : 'warn'}>{a === 'org' ? '전사' : a}</Badge>)}</>
}

function Duplicates() {
  const q = useQuery({ queryKey: ['wiki', 'entities', 'duplicates'], queryFn: getWikiDuplicates, retry: false })
  const merge = useMutation({
    mutationFn: ({ from, into }: { from: string; into: string }) => proposeWikiMerge(from, into, '중복 후보에서'),
    onSuccess: (cs) => toast.success(`합치기 제안 ${cs.short} — 검토 큐에서 승인한다`),
    onError: (err) => toast.error(err instanceof Error ? err.message : '제안 실패'),
  })
  if (!q.isSuccess || q.data.length === 0) return null // 검토자가 아니면 403 — 칸을 숨긴다
  return (
    <Card padded="lg" className="mb-4" data-testid="wiki-entity-duplicates">
      <h2 className="mb-2 text-sm font-semibold text-smsg-900 dark:text-gray-100">중복 후보 {q.data.length}</h2>
      <ul className="space-y-1.5 text-sm">
        {q.data.map((d) => (
          <li key={`${d.a.id}-${d.b.id}`} className="flex flex-wrap items-center gap-2">
            <Badge tone="muted">{d.type_key}</Badge>
            <Link to={`/wiki/entities/${d.a.id}`} className="hover:underline">{d.a.name}</Link>
            <span className="text-gray-400">≈</span>
            <Link to={`/wiki/entities/${d.b.id}`} className="hover:underline">{d.b.name}</Link>
            <span className="font-mono text-xs text-gray-500">{d.why}</span>
            <Button size="sm" variant="secondary" disabled={merge.isPending}
              onClick={() => merge.mutate({ from: d.b.id, into: d.a.id })}>
              뒤의 것을 앞의 것으로 합치기 제안
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  )
}

export function WikiEntitiesPage() {
  const [params, setParams] = useSearchParams()
  const type = params.get('type') ?? ''
  const [q, setQ] = useState(params.get('q') ?? '')
  const types = useQuery({ queryKey: ['wiki', 'ontology'], queryFn: getWikiOntology, retry: false })
  const list = useQuery({
    queryKey: ['wiki', 'entities', type, params.get('q') ?? ''],
    queryFn: () => listWikiEntities({ type, q: params.get('q') ?? '' }),
    retry: false,
  })
  return (
    <WikiShell title="엔티티" testId="wiki-entities" subtitle="등록부 — 들이기가 힌트를 이 이름 · 별칭 · 외부 id 로 찾는다.">
      <form
        className="mb-4 flex flex-wrap gap-2"
        onSubmit={(e) => { e.preventDefault(); setParams({ ...(type ? { type } : {}), ...(q.trim() ? { q: q.trim() } : {}) }) }}
      >
        <select
          aria-label="유형"
          value={type}
          onChange={(e) => setParams({ ...(e.target.value ? { type: e.target.value } : {}), ...(q.trim() ? { q: q.trim() } : {}) })}
          className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900"
        >
          <option value="">모든 유형</option>
          {(types.data?.types ?? []).filter((t) => t.status === 'approved').map((t) => (
            <option key={t.key} value={t.key}>{t.label_ko}</option>
          ))}
        </select>
        <div className="w-64"><input className={FIELD} aria-label="이름 찾기" placeholder="이름" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <Button type="submit" size="sm" variant="secondary">찾기</Button>
      </form>
      <Duplicates />
      {list.isError && <WikiError error={list.error} onRetry={() => void list.refetch()} />}
      {list.isPending && <Skeleton className="h-40" />}
      {list.isSuccess && (
        <Card padded={false} data-testid="wiki-entities-list">
          {list.data.rows.length === 0 && <p className="p-6 text-sm text-gray-500">엔티티가 없다.</p>}
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {list.data.rows.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm">
                <Badge tone="muted">{e.type_label}</Badge>
                <Link to={`/wiki/entities/${e.id}`} className="font-medium text-smsg-800 hover:underline dark:text-smsg-300">{e.name}</Link>
                {e.aliases.length > 0 && <span className="text-xs text-gray-500">별칭 {e.aliases.join(', ')}</span>}
                <span className="ml-auto text-xs text-gray-500">문서 {e.pages.length}</span>
              </li>
            ))}
          </ul>
          {list.data.total > list.data.rows.length && (
            <p className="px-4 py-2 text-xs text-gray-500">그 밖 {list.data.total - list.data.rows.length} — 유형 · 이름으로 좁힌다</p>
          )}
        </Card>
      )}
    </WikiShell>
  )
}

function EditNames({ e }: { e: WikiEntity }) {
  const qc = useQueryClient()
  const [aliases, setAliases] = useState(e.aliases.join('\n'))
  const [ext, setExt] = useState(Object.entries(e.ext_ids).map(([k, v]) => `${k}=${v}`).join('\n'))
  const save = useMutation({
    mutationFn: () => patchWikiEntity(e.id, {
      aliases: aliases.split('\n').map((x) => x.trim()).filter(Boolean),
      ext_ids: Object.fromEntries(ext.split('\n').map((x) => x.trim()).filter(Boolean).map((x) => {
        const i = x.indexOf('=')
        return [x.slice(0, i).trim(), x.slice(i + 1).trim()]
      })),
    }),
    onSuccess: () => {
      toast.success('고쳤다')
      void qc.invalidateQueries({ queryKey: ['wiki', 'entities'] })
      void qc.invalidateQueries({ queryKey: ['wiki', 'entity', e.id] })
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '고치지 못했다'),
  })
  const area = 'mt-1 w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 font-mono text-sm dark:border-gray-700 dark:bg-gray-900'
  return (
    <form className="grid gap-3 md:grid-cols-2" onSubmit={(ev) => { ev.preventDefault(); save.mutate() }}>
      <label className="block text-sm"><span className="text-gray-600 dark:text-gray-400">별칭(한 줄에 하나)</span>
        <textarea rows={4} value={aliases} onChange={(ev) => setAliases(ev.target.value)} className={area} /></label>
      <label className="block text-sm"><span className="text-gray-600 dark:text-gray-400">외부 id(칸=값)</span>
        <textarea rows={4} value={ext} onChange={(ev) => setExt(ev.target.value)} className={area} /></label>
      <div><Button type="submit" size="sm" disabled={save.isPending}>별칭 · 외부 id 저장</Button></div>
    </form>
  )
}

function MergeInto({ e }: { e: WikiEntity }) {
  const [into, setInto] = useState('')
  const [note, setNote] = useState('')
  const peers = useQuery({
    queryKey: ['wiki', 'entities', e.type_key, ''],
    queryFn: () => listWikiEntities({ type: e.type_key }),
    retry: false,
  })
  const m = useMutation({
    mutationFn: () => proposeWikiMerge(e.id, into, note.trim()),
    onSuccess: (cs) => toast.success(`합치기 제안 ${cs.short}${cs.status === 'failed' ? ' — 검증에 걸렸다' : ' — 검토 큐에서 승인한다'}`),
    onError: (err) => toast.error(err instanceof Error ? err.message : '제안 실패'),
  })
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(ev) => { ev.preventDefault(); m.mutate() }}>
      <label className="text-sm"><span className="block text-gray-600 dark:text-gray-400">이 엔티티를 합칠 곳</span>
        <select aria-label="합칠 곳" value={into} onChange={(ev) => setInto(ev.target.value)}
          className="mt-1 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900">
          <option value="">고른다</option>
          {(peers.data?.rows ?? []).filter((p) => p.id !== e.id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select></label>
      <div className="w-72"><input className={FIELD} aria-label="합치기 까닭" placeholder="까닭(같은 개체다)" value={note} onChange={(ev) => setNote(ev.target.value)} /></div>
      <Button type="submit" size="sm" variant="secondary" disabled={!into || m.isPending}>합치기 제안</Button>
    </form>
  )
}

export function WikiEntityPage() {
  const { id = '' } = useParams<{ id: string }>()
  const canEdit = useCanEdit()
  const q = useQuery({ queryKey: ['wiki', 'entity', id], queryFn: () => getWikiEntity(id), retry: false, enabled: !!id })
  if (q.isError) return <WikiShell title="엔티티" testId="wiki-entity"><WikiError error={q.error} onRetry={() => void q.refetch()} /></WikiShell>
  const e = q.data
  if (!e) return <WikiShell title="엔티티" testId="wiki-entity"><Skeleton className="h-64" /></WikiShell>
  return (
    <WikiShell title={e.name} testId="wiki-entity" subtitle={<>{e.type_label} · {STATUS_LABEL[e.status]}{e.merged_into && (
      <> → <Link to={`/wiki/entities/${e.merged_into}`} className="hover:underline">합쳐진 곳</Link></>)}</>}>
      <Card padded="lg" className="mb-4" data-testid="wiki-entity-pages">
        <h2 className="mb-2 text-sm font-semibold text-smsg-900 dark:text-gray-100">문서 {e.pages.length}</h2>
        <ul className="space-y-1.5 text-sm">
          {e.pages.map((p) => (
            <li key={p.slug} className="flex flex-wrap items-center gap-2">
              <Link to={`/docs/${p.slug}`} className="hover:underline">{p.title}</Link>
              <Scope audience={p.audience} />
              {p.stale_since && <Badge tone="warn">낡음 — 합치기로 옮겨 왔다</Badge>}
            </li>
          ))}
        </ul>
      </Card>
      <Card padded="lg" className="mb-4" data-testid="wiki-entity-names">
        <h2 className="mb-2 text-sm font-semibold text-smsg-900 dark:text-gray-100">이름</h2>
        {!e.full && <p className="text-sm text-gray-500">별칭 · 외부 id 는 이 엔티티를 만든 범위의 사람만 본다.</p>}
        {e.full && (
          <dl className="mb-3 grid grid-cols-[8rem_1fr] gap-y-1 text-sm">
            <dt className="text-gray-500">별칭</dt><dd>{e.aliases.join(', ') || '—'}</dd>
            <dt className="text-gray-500">외부 id</dt>
            <dd className="font-mono text-xs">{Object.entries(e.ext_ids).map(([k, v]) => `${k}=${v}`).join(' · ') || '—'}</dd>
            {(e.merged_from ?? []).length > 0 && (<><dt className="text-gray-500">합쳐 온 것</dt>
              <dd>{(e.merged_from ?? []).map((m) => m.name).join(', ')}</dd></>)}
          </dl>
        )}
        {e.full && canEdit && e.status === 'active' && <EditNames e={e} />}
      </Card>
      {e.full && canEdit && e.status === 'active' && (
        <Card padded="lg" data-testid="wiki-entity-merge">
          <h2 className="mb-2 text-sm font-semibold text-smsg-900 dark:text-gray-100">합치기</h2>
          <MergeInto e={e} />
        </Card>
      )}
    </WikiShell>
  )
}
