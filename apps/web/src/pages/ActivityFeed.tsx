import { useCallback, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  listActivity,
  listMyActivity,
  type ActivityEvent,
} from '@/features/activity/api'
import {
  CHIP_OPTIONS,
  kindsForChip,
  type ChipKey,
} from '@/features/activity/format'
import { ActivityEventCard } from '@/features/activity/components/ActivityEventCard'
import { Button, EmptyState, ErrorState, cn } from '@/components/ui'
import { toApiError } from '@/lib/api/envelope'

const PAGE_SIZE = 20

/**
 * `/activity` — full-page activity feed. Filter chips switch the active
 * `kind` filter (or the endpoint, when "내 활동" is selected). The "더 보기"
 * button bumps `limit` in PAGE_SIZE steps so we get cheap incremental
 * pagination without a backend cursor.
 */
export function ActivityFeedPage() {
  const [chip, setChip] = useState<ChipKey>('all')
  const [limit, setLimit] = useState(PAGE_SIZE)

  const kinds = useMemo(() => kindsForChip(chip) ?? undefined, [chip])
  const useMine = chip === 'mine'

  const queryKey = ['activity', 'feed', chip, limit] as const

  const { data, isPending, isError, error, refetch, isFetching } = useQuery({
    queryKey,
    queryFn: () =>
      useMine
        ? listMyActivity({ limit, kind: kinds })
        : listActivity({ limit, kind: kinds }),
    staleTime: 15_000,
  })

  const items: ActivityEvent[] = Array.isArray(data) ? data : []

  const onChip = useCallback((next: ChipKey) => {
    setChip(next)
    setLimit(PAGE_SIZE)
  }, [])

  const onMore = useCallback(() => {
    setLimit((n) => Math.min(200, n + PAGE_SIZE))
  }, [])

  const couldHaveMore = items.length >= limit && limit < 200

  return (
    <section
      className="mx-auto max-w-3xl space-y-4 px-6 py-8"
      data-testid="activity-feed-page"
    >
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-smsg-900 dark:text-gray-100">
            활동 피드
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            누가 무엇을 편집·논의·승인했는지 한 곳에서 확인할 수 있어요.
          </p>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="활동 필터">
        {CHIP_OPTIONS.map((opt) => (
          <button
            key={opt.key}
            type="button"
            role="tab"
            aria-selected={chip === opt.key}
            data-testid={`activity-chip-${opt.key}`}
            onClick={() => onChip(opt.key)}
            className={cn(
              'min-h-[32px] rounded-full border px-3 py-1 text-xs font-medium transition-all duration-fast',
              chip === opt.key
                ? 'border-smsg-700 bg-smsg-700 text-white shadow-sm'
                : 'border-gray-300 bg-white text-gray-700 hover:border-smsg-300 hover:text-smsg-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300',
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {isError && (
        <ErrorState
          title="활동을 불러오지 못했습니다"
          description={toApiError(error).message}
          onRetry={() => void refetch()}
        />
      )}

      {isPending && !isError && (
        <p className="text-sm text-gray-500">불러오는 중…</p>
      )}

      {!isPending && !isError && items.length === 0 && (
        <EmptyState
          title="표시할 활동이 없습니다"
          description="문서를 편집하거나 댓글을 남겨 보세요."
        />
      )}

      {items.length > 0 && (
        <ul className="space-y-2" data-testid="activity-feed-list">
          {items.map((ev) => (
            <li key={ev.id}>
              <ActivityEventCard event={ev} />
            </li>
          ))}
        </ul>
      )}

      {items.length > 0 && couldHaveMore && (
        <div className="flex justify-center pt-2">
          <Button
            variant="secondary"
            size="md"
            disabled={isFetching}
            onClick={onMore}
            data-testid="activity-feed-more"
          >
            {isFetching ? '불러오는 중…' : '더 보기'}
          </Button>
        </div>
      )}
    </section>
  )
}
