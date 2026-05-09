import { useSavedViewResults } from './hooks'

interface Props {
  id: string
}

/**
 * Live (throttled) count badge — fetches `total` from the BE and re-uses the
 * same query key as the page so it cache-hits. staleTime = 60s in the hook
 * keeps it from hammering the BE per render.
 */
export function SavedViewCountBadge({ id }: Props) {
  const { data } = useSavedViewResults(id, { limit: 1, offset: 0 })
  const total = data?.total
  if (typeof total !== 'number') return null
  return (
    <span
      data-testid="saved-view-count"
      className="ml-auto rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-mono text-gray-600"
      title={`결과 ${total}개`}
    >
      {total}
    </span>
  )
}
