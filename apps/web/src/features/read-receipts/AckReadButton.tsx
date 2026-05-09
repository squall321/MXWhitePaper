/**
 * AckReadButton — explicit "✅ 확인했어요" button for the doc reader.
 *
 * Visibility rules (per spec):
 *   - Doc has ≥1 reviewer AND current user is one of those reviewers, OR
 *   - Doc status is `published`.
 *
 * On click: POST /documents/:slug/ack-read. After ack the button switches to
 * the disabled "✅ 확인됨 (X시간 전)" pill — the API is idempotent so users
 * can re-ack later (e.g. after a doc revision); we still freeze the UI to
 * keep the surface tidy. Visit the panel to bump the comment if needed.
 */
import { useEffect, useState } from 'react'
import { ackRead } from './api'
import { listReviewers, type Reviewer } from '@/features/approvals/api'
import { useAuthStore } from '@/features/auth/store'
import { toast } from '@/components/ui/Toast'
import { formatRelative } from '@/features/activity/format'
import type { DocStatus } from '@/features/approvals/api'
import type { Slug } from '@/types/document'
import { toApiError } from '@/lib/api/envelope'

export interface AckReadButtonProps {
  slug: Slug
  /** Current document status (from the document row). */
  docStatus?: DocStatus
}

export function AckReadButton({ slug, docStatus }: AckReadButtonProps) {
  const user = useAuthStore((s) => s.user)
  const [reviewers, setReviewers] = useState<Reviewer[]>([])
  const [ackedAt, setAckedAt] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Reviewers are fetched lazily — we don't want to gate render on it. If
  // the call fails we fall back to "no reviewers" which still lets published
  // docs show the button.
  useEffect(() => {
    let alive = true
    void listReviewers(slug)
      .then((rs) => {
        if (alive) setReviewers(rs)
      })
      .catch(() => {
        if (alive) setReviewers([])
      })
    return () => {
      alive = false
    }
  }, [slug])

  if (!user) return null
  const isReviewer = reviewers.some((r) => r.reviewer_user_id === user.id)
  const isPublished = docStatus === 'published'
  const hasReviewers = reviewers.length > 0
  const visible = (hasReviewers && isReviewer) || isPublished
  if (!visible) return null

  const onClick = async () => {
    if (submitting) return
    setSubmitting(true)
    try {
      const res = await ackRead(slug)
      setAckedAt(res.acknowledged_at)
      toast.success('읽음 확인 완료')
    } catch (err) {
      toast.error(toApiError(err).message)
    } finally {
      setSubmitting(false)
    }
  }

  if (ackedAt) {
    return (
      <button
        type="button"
        disabled
        data-testid="ack-read-acked"
        className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-800 disabled:cursor-default"
      >
        ✅ 확인됨 ({formatRelative(ackedAt)})
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={() => void onClick()}
      disabled={submitting}
      data-testid="ack-read-button"
      className="rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
    >
      ✅ 확인했어요
    </button>
  )
}
