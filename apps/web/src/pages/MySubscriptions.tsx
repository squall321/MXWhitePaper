import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/Badge'
import {
  useMySubscriptions,
  usePatchSubscription,
  useUnsubscribeDoc,
} from '@/features/subscriptions/hooks'
import type {
  DigestCadence,
  MySubscription,
  SubscriptionEvent,
} from '@/features/subscriptions/api'

const CADENCE_LABEL: Record<DigestCadence, string> = {
  instant: '즉시',
  daily: '매일',
  weekly: '매주',
}

const EVENT_LABEL: Record<SubscriptionEvent, string> = {
  doc_edited: '수정',
  comment_added: '댓글',
  review_decided: '리뷰',
  doc_published: '발행',
}

const CADENCES: DigestCadence[] = ['instant', 'daily', 'weekly']

/**
 * "내 팔로잉" page (`/subscriptions`).
 *
 * 내가 팔로우 중인 문서 목록 + per row [제목, 마지막 편집, 이벤트 배지, 빈도,
 * 풀기 버튼]. 빈도 변경은 미니 select 로 즉시 PATCH.
 */
export function MySubscriptionsPage() {
  const all = useMySubscriptions()
  const unsub = useUnsubscribeDoc()
  const patch = usePatchSubscription()
  const items = all.data ?? []

  return (
    <div className="space-y-4" data-testid="my-subscriptions-page">
      <header>
        <h1 className="text-xl font-semibold text-smsg-900">내 팔로잉</h1>
        <p className="mt-1 text-xs text-gray-600">
          내가 변경 알림을 받기로 한 문서 목록입니다.
        </p>
      </header>

      {all.isError && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          목록을 불러오지 못했습니다.
        </div>
      )}

      {all.isLoading && (
        <p className="text-xs text-gray-500">불러오는 중…</p>
      )}

      {!all.isLoading && items.length === 0 && (
        <p
          className="rounded border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-500"
          data-testid="my-subscriptions-empty"
        >
          아직 팔로우 중인 문서가 없어요.
        </p>
      )}

      {items.length > 0 && (
        <ul className="space-y-2" data-testid="my-subscriptions-list">
          {items.map((it) => (
            <SubscriptionRow
              key={it.subscription_id}
              it={it}
              onUnsub={() => unsub.mutate(it.slug)}
              onChangeCadence={(c) =>
                patch.mutate({
                  id: it.subscription_id,
                  body: { digest_cadence: c },
                })
              }
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function SubscriptionRow({
  it,
  onUnsub,
  onChangeCadence,
}: {
  it: MySubscription
  onUnsub: () => void
  onChangeCadence: (c: DigestCadence) => void
}) {
  return (
    <li
      data-testid="my-subscription-row"
      data-slug={it.slug}
      className="rounded border border-gray-200 bg-white px-4 py-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Link
          to={`/docs/${encodeURIComponent(it.slug)}`}
          className="text-sm font-semibold text-smsg-700 hover:underline"
        >
          {it.title}
        </Link>
        <Badge tone="muted" size="sm">
          {CADENCE_LABEL[it.digest_cadence]}
        </Badge>
        {(it.events ?? []).map((e) => (
          <Badge key={e} tone="brand" size="sm">
            {EVENT_LABEL[e] ?? e}
          </Badge>
        ))}
        <span className="ml-auto flex items-center gap-2">
          <label className="text-[11px] text-gray-500">
            빈도
            <select
              value={it.digest_cadence}
              data-testid="my-subscription-cadence"
              onChange={(e) => onChangeCadence(e.target.value as DigestCadence)}
              className="ml-1 rounded border border-gray-200 bg-white px-1 py-0.5 text-xs"
            >
              {CADENCES.map((c) => (
                <option key={c} value={c}>
                  {CADENCE_LABEL[c]}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={onUnsub}
            data-testid="my-subscription-unfollow"
            className="rounded border border-gray-200 bg-white px-2 py-1 text-xs font-semibold text-gray-700 hover:border-red-300 hover:text-red-700"
          >
            풀기
          </button>
        </span>
      </div>
      <p className="mt-1 text-xs text-gray-500">
        {it.last_edited_at && (
          <span>마지막 편집: {it.last_edited_at.slice(0, 10)}</span>
        )}
      </p>
    </li>
  )
}
