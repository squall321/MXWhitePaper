// AI 위키 원천 `/wiki/sources/:id` — 원천 본문(종류별 표) · 첨부 · 출처 링크 · 원천 문서 · 철회(주인)(docs/llm-wiki request §5-14)
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import { toast } from '@/components/ui/Toast'
import { getWikiSource, kst, withdrawWikiSource } from '@/features/wiki/api'
import { sourceKindLabel } from '@/features/wiki/WikiCitations'
import { WikiError, WikiShell } from '@/features/wiki/WikiNav'
import { toApiError } from '@/lib/api/envelope'

function cell(v: unknown): string {
  if (v && typeof v === 'object' && 'value' in v && 'unit' in v) {
    const q = v as { value: unknown; unit: unknown }
    return `${String(q.value)} ${String(q.unit)}`
  }
  if (Array.isArray(v)) return v.map(cell).join(', ')
  if (v && typeof v === 'object') return Object.entries(v).map(([k, x]) => `${k} ${cell(x)}`).join(' · ')
  return v == null ? '' : String(v)
}

/** 본문 — 낱값은 '칸 · 값' 한 표, 객체 목록은 목록마다 표(원천 문서와 같은 꼴, 숫자는 받은 그대로). */
function Payload({ payload }: { payload: Record<string, unknown> }) {
  const rows = Object.entries(payload).filter(([, v]) => !(Array.isArray(v) && v.length && typeof v[0] === 'object'))
  const lists = Object.entries(payload).filter(([, v]) => Array.isArray(v) && v.length && typeof v[0] === 'object') as
    [string, Record<string, unknown>[]][]
  return (
    <div className="space-y-4">
      <table className="w-full text-sm">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k} className="border-b border-gray-100 align-top dark:border-gray-800">
              <th className="w-48 py-1.5 pr-3 text-left font-mono text-xs font-normal text-gray-500">{k}</th>
              <td className="py-1.5 text-gray-800 dark:text-gray-200">{cell(v)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {lists.map(([k, items]) => {
        const heads = [...new Set(items.flatMap((x) => Object.keys(x)))]
        return (
          <div key={k}>
            <p className="mb-1 font-mono text-xs text-gray-500">{k}</p>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                <tr>{heads.map((h) => <th key={h} className="px-2 py-1 font-normal">{h}</th>)}</tr>
              </thead>
              <tbody>
                {items.map((x, i) => (
                  <tr key={i} className="border-b border-gray-100 dark:border-gray-800">
                    {heads.map((h) => <td key={h} className="px-2 py-1 text-gray-800 dark:text-gray-200">{cell(x[h])}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      })}
    </div>
  )
}

export function WikiSourcePage() {
  const { id = '' } = useParams<{ id: string }>()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['wiki', 'source', id], queryFn: () => getWikiSource(id), retry: false, enabled: !!id })
  const withdraw = useMutation({
    mutationFn: () => withdrawWikiSource(id),
    onSuccess: () => {
      toast.success('철회했다 — 줄에 선 들이기를 거두고 원천 문서를 보관했다')
      void qc.invalidateQueries({ queryKey: ['wiki', 'source', id] })
    },
    onError: (err) => toast.error(toApiError(err).message),
  })

  if (q.isError) {
    return <WikiShell title="원천" testId="wiki-source"><WikiError error={q.error} onRetry={() => void q.refetch()} /></WikiShell>
  }
  const src = q.data
  if (!src) return <WikiShell title="원천" testId="wiki-source"><Skeleton className="h-48" /></WikiShell>
  return (
    <WikiShell title={src.title} testId="wiki-source" subtitle={`${src.short} · ${sourceKindLabel(src.kind)} · ${src.origin.system}`}>
      <Card padded="lg" className="mb-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Badge tone="info">{sourceKindLabel(src.kind)}</Badge>
          {src.audience.map((a) => <Badge key={a} tone={a === 'org' ? 'neutral' : 'warn'}>{a === 'org' ? '전사' : a}</Badge>)}
          <Badge tone={src.status === 'active' ? 'success' : 'warn'}>
            {src.status === 'active' ? '활성' : src.status === 'withdrawn' ? '철회됨' : '새 판에 밀림'}
          </Badge>
          <Badge tone="muted">들이기 {src.ingest_state}</Badge>
          {src.mine && src.status !== 'withdrawn' && (
            <Button
              size="sm"
              variant="secondary"
              className="ml-auto"
              disabled={withdraw.isPending}
              onClick={() => {
                if (window.confirm('이 원천을 철회할까? 인용한 문장은 점검이 다시 본다.')) withdraw.mutate()
              }}
            >
              철회
            </Button>
          )}
        </div>
        <dl className="grid grid-cols-[8rem_1fr] gap-y-1 text-sm">
          <dt className="text-gray-500">출처</dt>
          <dd className="text-gray-800 dark:text-gray-200">
            {src.origin.system} · <code className="font-mono text-xs">{src.origin.ref}</code>
            {src.origin.rev && <> · 판 {src.origin.rev}</>}
            {src.origin.url && <> · <a href={src.origin.url} target="_blank" rel="noreferrer" className="text-smsg-700 hover:underline dark:text-smsg-300">원본 열기</a></>}
          </dd>
          <dt className="text-gray-500">생긴 때</dt>
          <dd className="text-gray-800 dark:text-gray-200">{kst(src.captured_at)} KST (받은 때 {kst(src.received_at)})</dd>
          <dt className="text-gray-500">원천 문서</dt>
          <dd>
            {src.doc_slug
              ? <Link to={`/docs/${src.doc_slug}`} className="text-smsg-700 hover:underline dark:text-smsg-300">{src.doc_slug}</Link>
              : <span className="text-gray-500">없음</span>}
          </dd>
          {src.blobs && src.blobs.length > 0 && (
            <>
              <dt className="text-gray-500">첨부</dt>
              <dd className="text-gray-800 dark:text-gray-200">
                {src.blobs.map((b) => `${b.name} (${b.mime}, ${b.bytes.toLocaleString()} 바이트)`).join(' · ')}
              </dd>
            </>
          )}
        </dl>
      </Card>
      <Card padded="lg" data-testid="wiki-source-payload">
        <h2 className="mb-3 text-sm font-semibold text-smsg-900 dark:text-gray-100">본문</h2>
        {src.payload ? <Payload payload={src.payload} /> : null}
      </Card>
    </WikiShell>
  )
}
