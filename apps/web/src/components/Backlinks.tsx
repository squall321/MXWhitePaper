import { Link } from 'react-router-dom'
import { useBacklinks } from '@/features/document/hooks/useBacklinks'
import { Skeleton } from '@/components/ui/Skeleton'
import { ErrorState } from '@/components/ui/ErrorState'
import { toApiError } from '@/lib/api/envelope'
import type { Slug } from '@/types/document'

interface BacklinksProps {
  slug: Slug
}

/**
 * Right-rail "이 문서를 참조하는 문서" panel. Backed by
 * `GET /api/v1/documents/:slug/backlinks` (Sprint 3 BE, polished Sprint 6).
 *
 * The BE returns `{ items, meta: { target_exists } }`; when the target slug
 * doesn't yet correspond to a real document, we surface a "작성하기" CTA at
 * the top so authors can fill the gap in one click. Each backlink row
 * resolves to a clickable `/docs/<slug>` Link.
 */
export function Backlinks({ slug }: BacklinksProps) {
  const { data, isPending, isError, error, refetch } = useBacklinks(slug)
  const items = data?.items ?? []
  const showCreateCta = data ? data.targetExists === false : false

  return (
    <section aria-label="백링크" className="mt-6 px-3">
      <h3 className="pb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
        백링크
      </h3>

      {showCreateCta && (
        <div className="mb-2 rounded border border-dashed border-smsg-500 bg-smsg-100/40 p-2 text-xs text-smsg-900">
          <p>이 문서는 아직 작성되지 않았어요.</p>
          <Link
            to={`/docs/new?slug=${encodeURIComponent(slug)}`}
            className="mt-1 inline-block rounded bg-smsg-700 px-2 py-1 text-[11px] font-semibold text-white hover:bg-smsg-900"
          >
            작성하기
          </Link>
        </div>
      )}

      {isPending ? (
        <div className="space-y-1.5" aria-busy="true">
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      ) : isError ? (
        <ErrorState
          title="백링크를 불러오지 못했습니다"
          description={toApiError(error).message}
          onRetry={() => void refetch()}
          className="px-3 py-3"
        />
      ) : items.length === 0 ? (
        <p className="text-xs text-gray-400">백링크 없음</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {items.map((bl) => (
            <li
              key={bl.slug + (bl.anchor ?? '')}
              className="rounded border border-gray-200 bg-white p-2 hover:border-smsg-500"
            >
              <Link
                to={`/docs/${encodeURIComponent(bl.slug)}${bl.anchor ? `#section-${bl.anchor}` : ''}`}
                className="text-link hover:underline"
              >
                {bl.title}
              </Link>
              {bl.sections_referenced > 0 && (
                <p className="mt-1 text-[11px] text-gray-500">
                  {bl.sections_referenced}개 섹션에서 참조
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
