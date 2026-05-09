/**
 * ReviewersPanel — sidebar/inline panel for the document reader page.
 *
 * Mounts under the article title for editor users (and reviewers) to:
 *   1. See current reviewers + their statuses (chip per row).
 *   2. Add a new reviewer via `<UserPicker>` (uses `/users/search`).
 *   3. Remove a reviewer (editor+).
 *   4. If the *current* user is in the reviewer list, render a decision
 *      form (approve / reject / changes_requested + optional comment).
 *
 * The component is fully self-contained — it owns its own `useEffect` data
 * loading and silently no-ops on transient errors. The workflow ribbon
 * shares state by polling the same endpoint when transitions complete.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  addReviewers,
  listReviewers,
  removeReviewer,
  submitDecision,
  type Reviewer,
  type ReviewStatus,
} from './api'
import { searchUsers, type UserSearchHit } from '@/features/auth/api'
import { useAuthStore } from '@/features/auth/store'
import { Badge } from '@/components/ui/Badge'
import type { Slug } from '@/types/document'

export interface ReviewersPanelProps {
  slug: Slug
  /** When the parent already knows the role gate it can pass `canEdit` to
   *  short-circuit the "+ 리뷰어 추가" button. Defaults to role-derived. */
  canEdit?: boolean
  /** Called whenever the panel mutates state — caller refreshes the ribbon. */
  onChange?: () => void
}

export function ReviewersPanel({ slug, canEdit, onChange }: ReviewersPanelProps) {
  const user = useAuthStore((s) => s.user)
  const role = user?.role ?? ''
  const isEditor =
    canEdit ?? (!!user && ['editor', 'owner', 'admin'].includes(role))

  const [items, setItems] = useState<Reviewer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showPicker, setShowPicker] = useState(false)

  const reload = async () => {
    setLoading(true)
    setError(null)
    try {
      const next = await listReviewers(slug)
      setItems(next)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug])

  const myRow = useMemo(
    () => (user ? items.find((r) => r.reviewer_user_id === user.id) : undefined),
    [items, user],
  )

  const handleAdd = async (uid: string) => {
    try {
      await addReviewers(slug, [uid])
      setShowPicker(false)
      await reload()
      onChange?.()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const handleRemove = async (uid: string) => {
    if (
      typeof window !== 'undefined' &&
      !window.confirm('이 리뷰어를 정말 제거하시겠습니까?')
    )
      return
    try {
      await removeReviewer(slug, uid)
      await reload()
      onChange?.()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const handleDecision = async (
    status: 'approved' | 'rejected' | 'changes_requested',
    comment: string,
  ) => {
    if (!user) return
    try {
      await submitDecision(slug, user.id, status, comment || undefined)
      await reload()
      onChange?.()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <section
      data-testid="reviewers-panel"
      className="rounded-md border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900"
    >
      <header className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          리뷰어 ({items.length})
        </h3>
        {isEditor && !showPicker && (
          <button
            type="button"
            data-testid="reviewers-add-button"
            onClick={() => setShowPicker(true)}
            className="rounded border border-smsg-300 bg-smsg-50 px-2 py-1 text-xs font-medium text-smsg-700 hover:bg-smsg-100"
          >
            + 리뷰어 추가
          </button>
        )}
      </header>

      {error && (
        <div className="mb-2 rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700">
          {error}
        </div>
      )}

      {showPicker && (
        <UserPicker
          onPick={handleAdd}
          onCancel={() => setShowPicker(false)}
          excludeIds={items.map((r) => r.reviewer_user_id)}
        />
      )}

      {loading && <p className="text-xs text-gray-500">불러오는 중…</p>}
      {!loading && items.length === 0 && (
        <p
          className="rounded border border-dashed border-gray-200 px-3 py-3 text-center text-xs text-gray-500"
          data-testid="reviewers-empty"
        >
          아직 지정된 리뷰어가 없습니다.
        </p>
      )}
      {!loading && items.length > 0 && (
        <ul className="space-y-2" data-testid="reviewers-list">
          {items.map((r) => (
            <li
              key={r.id}
              data-testid="reviewer-row"
              className="flex flex-wrap items-center gap-2 rounded border border-gray-200 bg-gray-50 px-3 py-2 text-xs dark:border-gray-800 dark:bg-gray-950"
            >
              <span className="flex-1 font-medium text-gray-700 dark:text-gray-300">
                {r.reviewer_name || r.reviewer_email || r.reviewer_user_id}
              </span>
              <StatusChip status={r.status} />
              {r.comment && (
                <span
                  className="basis-full break-words pl-1 text-[11px] italic text-gray-600 dark:text-gray-400"
                  data-testid="reviewer-comment"
                >
                  “{r.comment}”
                </span>
              )}
              {isEditor && (
                <button
                  type="button"
                  data-testid="reviewer-remove-button"
                  onClick={() => handleRemove(r.reviewer_user_id)}
                  className="rounded border border-red-200 bg-white px-2 py-0.5 text-[11px] text-red-700 hover:bg-red-50"
                >
                  삭제
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {myRow && (
        <DecisionForm
          current={myRow.status}
          existingComment={myRow.comment}
          onSubmit={handleDecision}
        />
      )}
    </section>
  )
}

function StatusChip({ status }: { status: ReviewStatus }) {
  const tone =
    status === 'approved'
      ? 'success'
      : status === 'rejected'
        ? 'error'
        : status === 'changes_requested'
          ? 'warn'
          : 'neutral'
  const label =
    status === 'approved'
      ? '승인'
      : status === 'rejected'
        ? '반려'
        : status === 'changes_requested'
          ? '수정 요청'
          : '대기'
  return (
    <Badge tone={tone} data-testid={`reviewer-status-${status}`}>
      {label}
    </Badge>
  )
}

interface UserPickerProps {
  onPick: (uid: string) => void
  onCancel: () => void
  excludeIds: string[]
}

function UserPicker({ onPick, onCancel, excludeIds }: UserPickerProps) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<UserSearchHit[]>([])
  const [loading, setLoading] = useState(false)
  const tokenRef = useRef(0)

  useEffect(() => {
    if (!q.trim()) {
      setHits([])
      return
    }
    const my = ++tokenRef.current
    setLoading(true)
    void searchUsers(q, 8)
      .then((res) => {
        if (my === tokenRef.current) {
          setHits(res.filter((u) => !excludeIds.includes(u.id)))
        }
      })
      .finally(() => {
        if (my === tokenRef.current) setLoading(false)
      })
  }, [q, excludeIds])

  return (
    <div
      data-testid="reviewers-user-picker"
      className="mb-3 rounded border border-gray-200 bg-gray-50 p-2 dark:border-gray-800 dark:bg-gray-950"
    >
      <div className="flex items-center gap-2">
        <input
          type="search"
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="이름 또는 이메일로 검색"
          data-testid="reviewers-search-input"
          className="h-7 flex-1 rounded border border-gray-300 bg-white px-2 text-xs"
        />
        <button
          type="button"
          onClick={onCancel}
          className="h-7 rounded border border-gray-300 bg-white px-2 text-xs text-gray-700 hover:bg-gray-100"
        >
          취소
        </button>
      </div>
      {loading && <p className="mt-2 text-[11px] text-gray-500">검색 중…</p>}
      {hits.length > 0 && (
        <ul
          data-testid="reviewers-search-results"
          className="mt-2 divide-y divide-gray-200 rounded border border-gray-200 bg-white text-xs dark:divide-gray-800 dark:border-gray-800 dark:bg-gray-900"
        >
          {hits.map((u) => (
            <li key={u.id}>
              <button
                type="button"
                data-testid={`reviewers-pick-${u.id}`}
                onClick={() => onPick(u.id)}
                className="flex w-full items-center justify-between px-2 py-1.5 text-left hover:bg-smsg-50"
              >
                <span>{u.name || u.email}</span>
                <span className="text-[10px] text-gray-500">{u.email}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {!loading && q.trim() && hits.length === 0 && (
        <p className="mt-2 text-[11px] text-gray-500">검색 결과가 없습니다.</p>
      )}
    </div>
  )
}

interface DecisionFormProps {
  current: ReviewStatus
  existingComment: string | null
  onSubmit: (
    status: 'approved' | 'rejected' | 'changes_requested',
    comment: string,
  ) => void
}

function DecisionForm({ current, existingComment, onSubmit }: DecisionFormProps) {
  const [comment, setComment] = useState(existingComment ?? '')
  return (
    <div
      data-testid="reviewer-decision-form"
      className="mt-4 rounded border border-smsg-200 bg-smsg-50 p-3 dark:border-smsg-700 dark:bg-smsg-900/20"
    >
      <p className="mb-2 text-xs font-semibold text-smsg-900 dark:text-smsg-100">
        내 결정 ({current === 'pending' ? '대기 중' : '재제출'})
      </p>
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="코멘트 (선택)"
        rows={2}
        data-testid="reviewer-decision-comment"
        className="mb-2 w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs"
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          data-testid="reviewer-decision-approve"
          onClick={() => onSubmit('approved', comment)}
          className="rounded bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-700"
        >
          승인
        </button>
        <button
          type="button"
          data-testid="reviewer-decision-reject"
          onClick={() => onSubmit('rejected', comment)}
          className="rounded bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-700"
        >
          반려
        </button>
        <button
          type="button"
          data-testid="reviewer-decision-changes"
          onClick={() => onSubmit('changes_requested', comment)}
          className="rounded bg-amber-500 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-600"
        >
          수정 요청
        </button>
      </div>
    </div>
  )
}
