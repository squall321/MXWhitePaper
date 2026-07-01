// 문서 우측 레일의 "의미 관계" 패널 — 나가는/들어오는 typed 엣지(triple)를 표시
import { Link } from 'react-router-dom'
import { useRelationships } from '@/features/graph/useRelationships'
import { Skeleton } from '@/components/ui/Skeleton'
import type { Triple } from '@/features/graph/triplesApi'
import type { Slug } from '@/types/document'

interface RelationshipsProps {
  slug: Slug
}

/** 들어오는 관계의 라벨 — inverse_predicate 가 있으면 그것, 없으면 generic fallback. */
function incomingLabel(t: Triple): string {
  return t.inverse_predicate?.trim() || '의 관련 문서'
}

function RelRow({ otherSlug, label, source }: {
  otherSlug: string
  label: string
  source: 'llm' | 'manual'
}) {
  return (
    <li className="rounded border border-gray-200 bg-white p-2 hover:border-smsg-500 dark:bg-gray-900 dark:border-gray-700">
      <span className="text-[11px] text-gray-500">{label}</span>
      <div className="flex items-center gap-1">
        <Link
          to={`/docs/${encodeURIComponent(otherSlug)}`}
          className="text-link hover:underline"
        >
          {otherSlug}
        </Link>
        {source === 'llm' && (
          <span
            title="AI 가 추출한 관계"
            className="text-[10px] text-gray-400"
            aria-label="AI 추출"
          >
            ✨
          </span>
        )}
      </div>
    </li>
  )
}

/**
 * 단순 하이퍼링크를 넘어, 문서 사이의 *의미 엣지* (triple) 를 양방향으로 보여준다.
 * 나가는 관계는 predicate("이 문서 → 상대"), 들어오는 관계는 inverse_predicate
 * ("상대 → 이 문서") 로 설명한다. 데이터 원천: `/api/v1/triples` (subject/object 필터).
 * best-effort — 관계가 없으면 패널 자체를 렌더하지 않아 레일을 어지럽히지 않는다.
 */
export function Relationships({ slug }: RelationshipsProps) {
  const { data, isPending } = useRelationships(slug)
  const outgoing = data?.outgoing ?? []
  const incoming = data?.incoming ?? []

  // 로딩 중도 아니고 관계도 없으면 패널 숨김 (레일 절약).
  if (!isPending && outgoing.length === 0 && incoming.length === 0) return null

  return (
    <section aria-label="의미 관계" className="mt-6 px-3">
      <h3 className="pb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
        관계
      </h3>

      {isPending ? (
        <div className="space-y-1.5" aria-busy="true">
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      ) : (
        <div className="space-y-3">
          {outgoing.length > 0 && (
            <div>
              <p className="pb-1 text-[11px] font-medium text-gray-400">→ 나가는 관계</p>
              <ul className="space-y-2 text-sm">
                {outgoing.map((t) => (
                  <RelRow
                    key={t.id}
                    otherSlug={t.object_slug}
                    label={t.predicate}
                    source={t.source}
                  />
                ))}
              </ul>
            </div>
          )}
          {incoming.length > 0 && (
            <div>
              <p className="pb-1 text-[11px] font-medium text-gray-400">← 들어오는 관계</p>
              <ul className="space-y-2 text-sm">
                {incoming.map((t) => (
                  <RelRow
                    key={t.id}
                    otherSlug={t.subject_slug}
                    label={incomingLabel(t)}
                    source={t.source}
                  />
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
