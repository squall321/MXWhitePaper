import { useEffect, useRef, useState } from 'react'
import {
  useIsFollowing,
  usePatchSubscription,
  useSubscribeDoc,
  useUnsubscribeDoc,
} from './hooks'
import type { DigestCadence, SubscriptionEvent } from './api'

interface FollowButtonProps {
  slug: string
  className?: string
}

const ALL_EVENTS: { id: SubscriptionEvent; label: string }[] = [
  { id: 'doc_edited', label: '문서 수정' },
  { id: 'comment_added', label: '댓글' },
  { id: 'review_decided', label: '리뷰 결정' },
  { id: 'doc_published', label: '발행' },
]

const CADENCES: { id: DigestCadence; label: string }[] = [
  { id: 'instant', label: '즉시' },
  { id: 'daily', label: '매일' },
  { id: 'weekly', label: '매주' },
]

/**
 * 문서 팔로우 토글 + 이벤트/주기 picker.
 *
 *   - 좌클릭 = 팔로우/언팔로우 토글
 *   - 우클릭 또는 ⋯ 호버 메뉴 = 이벤트 체크박스 + 주기 라디오 picker
 *
 * BookmarkButton 옆에 자리잡도록 같은 비주얼 톤. 책갈피 = 즐겨찾기 (개인용),
 * 팔로우 = 변경 알림 받기 (수신함). 두 개념을 의도적으로 분리.
 */
export function FollowButton({ slug, className }: FollowButtonProps) {
  const { subscription, isFollowing } = useIsFollowing(slug)
  const subscribe = useSubscribeDoc()
  const unsubscribe = useUnsubscribeDoc()
  const patch = usePatchSubscription()
  const [pickerOpen, setPickerOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!pickerOpen) return
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setPickerOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPickerOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [pickerOpen])

  const onToggle = () => {
    if (isFollowing) {
      unsubscribe.mutate(slug)
    } else {
      subscribe.mutate({ slug })
    }
  }

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    if (!isFollowing) {
      subscribe.mutate({ slug }, { onSuccess: () => setPickerOpen(true) })
    } else {
      setPickerOpen((v) => !v)
    }
  }

  return (
    <div
      ref={wrapRef}
      data-testid="follow-button"
      data-slug={slug}
      data-following={isFollowing ? 'true' : 'false'}
      className={`relative inline-flex items-center ${className ?? ''}`}
    >
      <button
        type="button"
        aria-pressed={isFollowing}
        aria-label={isFollowing ? '팔로우 해제' : '팔로우'}
        data-testid="follow-toggle"
        onClick={onToggle}
        onContextMenu={onContextMenu}
        title={isFollowing ? '팔로잉 (우클릭: 이벤트/주기)' : '팔로우'}
        className={[
          'inline-flex items-center gap-1 rounded border px-2 py-1 text-xs font-semibold transition-colors duration-fast',
          isFollowing
            ? 'border-smsg-700 bg-smsg-700 text-white hover:bg-smsg-900'
            : 'border-gray-300 bg-white text-gray-700 hover:border-smsg-700 hover:text-smsg-700',
        ].join(' ')}
      >
        <span aria-hidden="true">{isFollowing ? '✓' : '+'}</span>
        <span>{isFollowing ? '팔로잉' : '팔로우'}</span>
      </button>
      <button
        type="button"
        aria-label="팔로우 옵션"
        data-testid="follow-options"
        onClick={(e) => {
          e.preventDefault()
          if (!isFollowing) {
            subscribe.mutate({ slug }, { onSuccess: () => setPickerOpen(true) })
          } else {
            setPickerOpen((v) => !v)
          }
        }}
        className="ml-0.5 grid h-7 w-5 place-items-center rounded text-gray-400 hover:bg-gray-50 hover:text-smsg-700"
      >
        <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="3.5" cy="8" r="1.2" fill="currentColor" />
          <circle cx="8" cy="8" r="1.2" fill="currentColor" />
          <circle cx="12.5" cy="8" r="1.2" fill="currentColor" />
        </svg>
      </button>

      {pickerOpen && subscription && (
        <FollowOptionsPicker
          subscriptionId={subscription.subscription_id}
          currentEvents={subscription.events}
          currentCadence={subscription.digest_cadence}
          onClose={() => setPickerOpen(false)}
          onPatch={(body) =>
            patch.mutate({ id: subscription.subscription_id, body })
          }
        />
      )}
    </div>
  )
}

interface FollowOptionsPickerProps {
  subscriptionId: string
  currentEvents: SubscriptionEvent[]
  currentCadence: DigestCadence
  onClose: () => void
  onPatch: (body: {
    events?: SubscriptionEvent[]
    digest_cadence?: DigestCadence
  }) => void
}

function FollowOptionsPicker({
  subscriptionId: _id,
  currentEvents,
  currentCadence,
  onClose,
  onPatch,
}: FollowOptionsPickerProps) {
  const eventSet = new Set(currentEvents)
  const toggleEvent = (e: SubscriptionEvent) => {
    const next = new Set(eventSet)
    if (next.has(e)) next.delete(e)
    else next.add(e)
    onPatch({ events: Array.from(next) })
  }
  return (
    <div
      role="dialog"
      aria-label="팔로우 옵션"
      data-testid="follow-options-picker"
      className="absolute right-0 top-full z-popover mt-1 w-64 rounded-md border border-gray-200 bg-white p-2 shadow-md"
    >
      <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
        어떤 이벤트로 알림 받기
      </p>
      <ul className="py-1">
        {ALL_EVENTS.map((ev) => (
          <li key={ev.id}>
            <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm text-gray-700 hover:bg-smsg-50">
              <input
                type="checkbox"
                checked={eventSet.has(ev.id)}
                onChange={() => toggleEvent(ev.id)}
                data-testid={`follow-event-${ev.id}`}
              />
              <span>{ev.label}</span>
            </label>
          </li>
        ))}
      </ul>
      <div className="border-t border-gray-100 pt-1.5">
        <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          알림 빈도
        </p>
        <ul className="py-1">
          {CADENCES.map((c) => (
            <li key={c.id}>
              <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm text-gray-700 hover:bg-smsg-50">
                <input
                  type="radio"
                  name="follow-cadence"
                  checked={currentCadence === c.id}
                  onChange={() => onPatch({ digest_cadence: c.id })}
                  data-testid={`follow-cadence-${c.id}`}
                />
                <span>{c.label}</span>
              </label>
            </li>
          ))}
        </ul>
      </div>
      <div className="mt-1 flex justify-end pt-1">
        <button
          type="button"
          onClick={onClose}
          className="rounded px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
        >
          닫기
        </button>
      </div>
    </div>
  )
}
