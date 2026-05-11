/**
 * WorkflowRibbon — sticky pill near the doc title showing the current
 * status and exposing role-gated transition actions.
 *
 *   draft        → editor 가 보이는 "리뷰 요청" (in_review 로 전이 + 최소 1명 리뷰어 보장).
 *   in_review    → editor 가 보이는 "초안으로 되돌리기" + (전 리뷰어 승인 시) "게시 (승인)".
 *   approved     → editor 의 "게시" 버튼.
 *   published    → admin 의 "보관" 버튼.
 *   archived     → admin 의 "보관 해제 (초안)" 버튼.
 */
import { useEffect, useState } from 'react'
import { Badge, type BadgeTone } from '@/components/ui/Badge'
import { useAuthStore } from '@/features/auth/store'
import {
  listReviewers,
  transitionStatus,
  type DocStatus,
  type Reviewer,
} from './api'
import type { Slug } from '@/types/document'

export interface WorkflowRibbonProps {
  slug: Slug
  status: DocStatus
  /** Bumped externally when reviewers change so we re-fetch the gate. */
  reloadKey?: number
  onTransitioned?: (next: DocStatus) => void
}

const STATUS_LABEL: Record<DocStatus, string> = {
  draft: '초안',
  in_review: '리뷰 중',
  approved: '승인됨',
  published: '게시됨',
  archived: '보관됨',
}

const STATUS_TONE: Record<DocStatus, BadgeTone> = {
  draft: 'neutral',
  in_review: 'info',
  approved: 'success',
  published: 'brand',
  archived: 'muted',
}

export function WorkflowRibbon({
  slug,
  status,
  reloadKey = 0,
  onTransitioned,
}: WorkflowRibbonProps) {
  const user = useAuthStore((s) => s.user)
  const role = user?.role ?? ''
  const isEditor = !!user && ['editor', 'owner', 'admin'].includes(role)
  const isAdmin = !!user && role === 'admin'

  const [reviewers, setReviewers] = useState<Reviewer[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const allApproved =
    reviewers.length > 0 && reviewers.every((r) => r.status === 'approved')

  useEffect(() => {
    let cancelled = false
    void listReviewers(slug)
      .then((rows) => {
        if (!cancelled) setReviewers(rows)
      })
      .catch(() => {
        if (!cancelled) setReviewers([])
      })
    return () => {
      cancelled = true
    }
  }, [slug, reloadKey, status])

  const run = async (next: DocStatus) => {
    if (busy) return
    if (next === 'in_review' && reviewers.length === 0) {
      setError('최소 1명의 리뷰어를 먼저 추가해 주세요.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await transitionStatus(slug, next)
      onTransitioned?.(res.status)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      data-testid="workflow-ribbon"
      data-status={status}
      className="sticky top-[var(--header-h,3rem)] z-10 -mx-4 mb-3 flex flex-wrap items-center gap-2 rounded-md border border-gray-200 bg-white/95 px-3 py-2 backdrop-blur-sm dark:border-gray-800 dark:bg-gray-900/95"
    >
      <Badge
        tone={STATUS_TONE[status]}
        size="md"
        data-testid={`workflow-status-${status}`}
      >
        {STATUS_LABEL[status]}
      </Badge>

      {error && (
        <span
          className="rounded border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] text-red-700"
          data-testid="workflow-error"
        >
          {error}
        </span>
      )}

      <div className="ml-auto flex flex-wrap gap-2">
        {status === 'draft' && isEditor && (
          <>
            <button
              type="button"
              data-testid="workflow-action-request-review"
              disabled={busy}
              onClick={() => run('in_review')}
              className="rounded border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              title="리뷰어 승인을 거쳐 게시하기"
            >
              리뷰 요청
            </button>
            {/* Single-step publish shortcut. The full draft → in_review →
               approved → published flow is useful for reviewed docs, but
               most operational wikis (imported PPT/Word, internal SOPs)
               just need to flip the visibility bit. We trust the editor
               role here — the audit log keeps the actor on record. */}
            <button
              type="button"
              data-testid="workflow-action-publish-direct"
              disabled={busy}
              onClick={() => run('published')}
              className="rounded bg-smsg-700 px-3 py-1 text-xs font-semibold text-white hover:bg-smsg-900 disabled:opacity-50"
              title="리뷰 단계 생략하고 바로 게시 (검색에 즉시 노출)"
            >
              바로 게시
            </button>
          </>
        )}

        {status === 'in_review' && isEditor && (
          <>
            <button
              type="button"
              data-testid="workflow-action-back-to-draft"
              disabled={busy}
              onClick={() => run('draft')}
              className="rounded border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              초안으로 되돌리기
            </button>
            <button
              type="button"
              data-testid="workflow-action-approve"
              disabled={busy || !allApproved}
              title={
                allApproved
                  ? '모든 리뷰어가 승인했습니다 — 다음 단계로 진행'
                  : '모든 리뷰어가 승인해야 진행할 수 있습니다'
              }
              onClick={() => run('approved')}
              className="rounded bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              승인 처리
            </button>
          </>
        )}

        {status === 'approved' && isEditor && (
          <button
            type="button"
            data-testid="workflow-action-publish"
            disabled={busy}
            onClick={() => run('published')}
            className="rounded bg-smsg-700 px-3 py-1 text-xs font-semibold text-white hover:bg-smsg-900 disabled:opacity-50"
          >
            게시
          </button>
        )}

        {status === 'published' && isAdmin && (
          <button
            type="button"
            data-testid="workflow-action-archive"
            disabled={busy}
            onClick={() => run('archived')}
            className="rounded border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            보관
          </button>
        )}

        {status === 'archived' && isAdmin && (
          <button
            type="button"
            data-testid="workflow-action-unarchive"
            disabled={busy}
            onClick={() => run('draft')}
            className="rounded border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            보관 해제 (초안)
          </button>
        )}
      </div>
    </div>
  )
}
