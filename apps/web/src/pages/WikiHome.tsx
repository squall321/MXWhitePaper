// AI 위키 홈 `/wiki` — 목록(종류 · 유형별) · 최근 기록 · 내가 볼 검토 수 · 열린 질문 · 점검 요약(docs/llm-wiki request §5-14 · W7)
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import { getWikiIndex, getWikiLog, kst, listWikiChanges, listWikiFindings, listWikiQuestions } from '@/features/wiki/api'
import { WikiError, WikiShell } from '@/features/wiki/WikiNav'

/**
 * 목록은 서버가 읽는 사람의 범위로 거른 뒤 짓는다(범위가 다른 사람은 다른 목록). 검토 수는 검토자(표지 · admin)에게만 —
 * 아니면 403 이라 칸을 숨긴다. 열린 질문 · 점검 결함 수도 읽는 사람이 볼 수 있는 것만 센다(W7).
 */
export function WikiHomePage() {
  const index = useQuery({ queryKey: ['wiki', 'index'], queryFn: getWikiIndex, retry: false })
  const log = useQuery({ queryKey: ['wiki', 'log', 8], queryFn: () => getWikiLog(8), retry: false })
  const pending = useQuery({
    queryKey: ['wiki', 'changes', 'pending_review'],
    queryFn: () => listWikiChanges('pending_review'),
    retry: false,
  })
  const asked = useQuery({ queryKey: ['wiki', 'questions', 'open'], queryFn: () => listWikiQuestions('open'), retry: false })
  const lint = useQuery({ queryKey: ['wiki', 'lint', null, 'open'], queryFn: () => listWikiFindings({}), retry: false })

  if (index.isError) {
    return (
      <WikiShell title="AI 위키" testId="wiki-home">
        <WikiError error={index.error} onRetry={() => void index.refetch()} />
      </WikiShell>
    )
  }
  const idx = index.data
  return (
    <WikiShell
      title="AI 위키"
      testId="wiki-home"
      subtitle={idx ? `규칙서 v${idx.version} · 문서 ${idx.docs.toLocaleString()} · 원천 ${idx.sources.toLocaleString()} · ${idx.at} KST` : ' '}
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
        <div className="space-y-4" data-testid="wiki-index">
          {!idx && <Skeleton className="h-40" />}
          {idx && idx.sections.length === 0 && (
            <Card padded="lg"><p className="text-sm text-gray-600 dark:text-gray-400">아직 위키 문서가 없다 — 원천이 들어오면 AI 가 쓴다.</p></Card>
          )}
          {idx?.sections.map((sec) => (
            <Card key={sec.key} padded="lg">
              <h2 className="mb-2 flex items-center gap-2 text-base font-semibold text-smsg-900 dark:text-gray-100">
                {sec.label}
                <span className="font-mono text-xs font-normal text-gray-500">{sec.key}</span>
                <Badge tone="muted">{sec.count.toLocaleString()}</Badge>
              </h2>
              <ul className="space-y-1 text-sm">
                {sec.items.map((it) => (
                  <li key={it.slug}>
                    <Link to={`/docs/${it.slug}`} className="text-smsg-700 hover:underline dark:text-smsg-300">{it.title}</Link>
                    {it.summary && <span className="text-gray-500 dark:text-gray-400"> — {it.summary}</span>}
                  </li>
                ))}
                {sec.more > 0 && <li className="text-xs text-gray-500">… 그 밖 {sec.more.toLocaleString()}</li>}
              </ul>
            </Card>
          ))}
        </div>
        <aside className="space-y-4">
          {pending.isSuccess && (
            <Card padded="lg" data-testid="wiki-home-review">
              <h2 className="mb-1 text-sm font-semibold text-smsg-900 dark:text-gray-100">검토 기다림</h2>
              <Link to="/wiki/changes" className="text-2xl font-bold text-smsg-700 hover:underline dark:text-smsg-300">
                {pending.data.total.toLocaleString()}
              </Link>
            </Card>
          )}
          {(asked.isSuccess || lint.isSuccess) && (
            <Card padded="lg" data-testid="wiki-home-health">
              <div className="grid grid-cols-2 gap-3">
                {asked.isSuccess && (
                  <div>
                    <h2 className="mb-1 text-sm font-semibold text-smsg-900 dark:text-gray-100">열린 질문</h2>
                    <Link to="/wiki/questions" className="text-2xl font-bold text-smsg-700 hover:underline dark:text-smsg-300">
                      {asked.data.total.toLocaleString()}
                    </Link>
                  </div>
                )}
                {lint.isSuccess && (
                  <div>
                    <h2 className="mb-1 text-sm font-semibold text-smsg-900 dark:text-gray-100">점검 결함</h2>
                    <Link to="/wiki/lint" className="text-2xl font-bold text-smsg-700 hover:underline dark:text-smsg-300">
                      {lint.data.meta.total.toLocaleString()}
                    </Link>
                  </div>
                )}
              </div>
              {lint.data?.meta.last_run && (
                <p className="mt-2 text-xs text-gray-500">마지막 점검 {kst(lint.data.meta.last_run.finished_at)}</p>
              )}
            </Card>
          )}
          <Card padded="lg" data-testid="wiki-home-log">
            <h2 className="mb-2 text-sm font-semibold text-smsg-900 dark:text-gray-100">최근 기록</h2>
            <ul className="space-y-1.5 text-xs">
              {(log.data ?? []).map((e) => (
                <li key={e.id} className="text-gray-700 dark:text-gray-300">
                  <span className="font-mono text-gray-500">{kst(e.at)}</span> <Badge tone="muted">{e.op}</Badge> {e.title}
                </li>
              ))}
              {log.isSuccess && log.data.length === 0 && <li className="text-gray-500">아직 기록이 없다.</li>}
            </ul>
            <Link to="/wiki/log" className="mt-2 inline-block text-xs text-smsg-700 hover:underline dark:text-smsg-300">기록 다 보기</Link>
          </Card>
        </aside>
      </div>
    </WikiShell>
  )
}
