// AI 위키 기록 `/wiki/log` — log.md 와 같은 꼴(`[YYYY-MM-DD HH:MM] op | 제목` + 한 줄)을 새것부터 · 작업으로 거르기(request §5-14)
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import { getWikiLog, kst } from '@/features/wiki/api'
import { WikiError, WikiShell } from '@/features/wiki/WikiNav'

function detailLine(detail: Record<string, unknown>): string {
  return Object.entries(detail)
    .filter(([, v]) => v !== '' && v !== null && !(Array.isArray(v) && v.length === 0))
    .map(([k, v]) => `${k} ${Array.isArray(v) ? v.join(', ') : String(v)}`)
    .join(' · ')
}

export function WikiLogPage() {
  const q = useQuery({ queryKey: ['wiki', 'log', 200], queryFn: () => getWikiLog(200), retry: false })
  const [op, setOp] = useState<string | null>(null)
  const ops = [...new Set((q.data ?? []).map((e) => e.op))].sort()
  const rows = (q.data ?? []).filter((e) => !op || e.op === op)
  return (
    <WikiShell title="기록" testId="wiki-log" subtitle={<>덧붙이기만 하는 작업 기록 — 원문 꼴은 <code>/api/v1/wiki/log.md</code></>}>
      <div className="mb-4 flex flex-wrap gap-1">
        {[null, ...ops].map((o) => (
          <button
            key={o ?? 'all'}
            type="button"
            onClick={() => setOp(o)}
            aria-pressed={op === o}
            className={`rounded-full px-3 py-1 text-sm ${op === o
              ? 'bg-smsg-100 font-medium text-smsg-800 dark:bg-gray-800 dark:text-gray-100'
              : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'}`}
          >
            {o ?? '전부'}
          </button>
        ))}
      </div>
      {q.isError && <WikiError error={q.error} onRetry={() => void q.refetch()} />}
      {q.isPending && <Skeleton className="h-40" />}
      {q.isSuccess && (
        <Card padded="lg" data-testid="wiki-log-list">
          {rows.length === 0 && <p className="text-sm text-gray-500">아직 기록이 없다.</p>}
          <ol className="space-y-3">
            {rows.map((e) => (
              <li key={e.id}>
                <p className="text-sm text-gray-900 dark:text-gray-100">
                  <span className="font-mono text-xs text-gray-500">[{kst(e.at)}]</span> <Badge tone="muted">{e.op}</Badge>{' '}
                  {e.changeset_id
                    ? <Link to={`/wiki/changes/${e.changeset_id}`} className="hover:underline">{e.title}</Link>
                    : e.title}
                </p>
                {detailLine(e.detail) && <p className="mt-0.5 pl-1 text-xs text-gray-600 dark:text-gray-400">- {detailLine(e.detail)}</p>}
              </li>
            ))}
          </ol>
        </Card>
      )}
    </WikiShell>
  )
}
