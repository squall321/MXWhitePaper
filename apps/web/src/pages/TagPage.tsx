import { useEffect } from 'react'
import { Link, useOutletContext, useParams } from 'react-router-dom'
import { useDocumentList } from '@/features/document/hooks/useDocumentList'
import type { DocumentCard } from '@/features/document/api'
import { Badge, Card, EmptyState, ErrorState, Skeleton } from '@/components/ui'
import { toApiError } from '@/lib/api/envelope'
import type { AppOutletContext } from '@/App'
import { BulkDocCheckbox } from '@/features/admin/bulk-docs/BulkDocCheckbox'
import { BulkDocActionsBar } from '@/features/admin/bulk-docs/BulkDocActionsBar'

/**
 * `/tags/:tag` and `/category/:cat` landing page. Filters the document list
 * via `useDocumentList({ tag })` (the BE accepts `tag` and `category` —
 * unsupported facets degrade to "all" which is fine).
 */
export function TagPage({ mode }: { mode: 'tag' | 'category' }) {
  const params = useParams<{ tag?: string; cat?: string }>()
  const raw = mode === 'tag' ? params.tag : params.cat
  const value = raw ? decodeURIComponent(raw) : ''

  // Outlet context is provided by `<App />`. Tests render the page without
  // the App shell, so we tolerate a missing context by no-op'ing the setters.
  const ctx = useOutletContext<AppOutletContext | undefined>()
  const setLeftRail = ctx?.setLeftRail ?? (() => {})
  const setRightRail = ctx?.setRightRail ?? (() => {})
  useEffect(() => {
    setLeftRail(undefined)
    setRightRail(null)
    return () => {
      setLeftRail(undefined)
      setRightRail(null)
    }
  }, [setLeftRail, setRightRail])

  const listParams = mode === 'tag' ? { tag: value, limit: 60 } : { tag: value, limit: 60 }
  const { data, isPending, isError, error, refetch } = useDocumentList(listParams)
  const items = (Array.isArray(data) ? data : []).filter((d) => filterByMode(d, mode, value))

  const heading = mode === 'tag' ? `#${value}` : value
  const subline = mode === 'tag' ? '이 태그가 달린 문서 목록' : '이 카테고리에 속한 문서 목록'

  return (
    <section className="space-y-6" data-testid={mode === 'tag' ? 'tag-page' : 'category-page'}>
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Badge tone="muted" size="sm">{mode === 'tag' ? '태그' : '카테고리'}</Badge>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-smsg-900 sm:text-3xl">
            {heading}
          </h1>
          <p className="mt-1 text-sm text-gray-500">{subline}</p>
        </div>
        <Link to="/" className="text-sm text-link hover:underline">홈으로 →</Link>
      </header>

      {isPending && (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <li key={i}>
              <Card padded="md" className="space-y-3">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-1/2" />
              </Card>
            </li>
          ))}
        </ul>
      )}

      {isError && (
        <ErrorState
          title="문서 목록을 불러오지 못했습니다"
          description={toApiError(error).message}
          onRetry={() => void refetch()}
        />
      )}

      {!isPending && !isError && items.length === 0 && (
        <EmptyState
          title={mode === 'tag' ? `#${value} 태그가 달린 문서가 없습니다` : `${value} 카테고리에 속한 문서가 없습니다`}
          description="다른 태그나 카테고리를 살펴보세요."
        />
      )}

      {!isPending && !isError && items.length > 0 && (
        <ul
          data-testid="tag-card-grid"
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          {items.map((doc) => (
            <li key={doc.id} className="relative">
              <div className="absolute left-2 top-2 z-10">
                <BulkDocCheckbox slug={doc.slug} />
              </div>
              <Link
                to={`/docs/${encodeURIComponent(doc.slug)}`}
                className="block hover:no-underline"
              >
                <Card hover padded="md" className="flex h-full flex-col gap-2">
                  <div className="flex items-start gap-2">
                    {doc.team && <Badge tone="muted" size="sm">{doc.team}</Badge>}
                  </div>
                  <h2 className="line-clamp-2 text-base font-semibold text-smsg-900">{doc.title}</h2>
                  {doc.summary && (
                    <p className="line-clamp-3 text-sm text-gray-600">{doc.summary}</p>
                  )}
                  <p className="mt-auto truncate text-xs text-gray-500">{doc.slug}</p>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <BulkDocActionsBar />
    </section>
  )
}

function filterByMode(d: DocumentCard | null, mode: 'tag' | 'category', value: string): boolean {
  // The BE may not echo `tags` / `category` on the card payload — when fields
  // are missing we trust the server-side filter (i.e. accept the row).
  if (!d) return false
  if (!value) return true
  if (mode === 'category') {
    const c = (d as DocumentCard & { category?: string }).category
    return !c || c === value
  }
  const tags = (d as DocumentCard & { tags?: string[] }).tags
  if (!Array.isArray(tags)) return true
  return tags.includes(value)
}
