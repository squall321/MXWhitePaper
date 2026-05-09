import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { listMyReviews, type MyReviewItem } from '@/features/approvals/api'
import { Badge } from '@/components/ui/Badge'

/**
 * "내 리뷰 요청" page (`/reviews`).
 *
 * Shows every doc where the current user is a reviewer with status
 * `pending` or `changes_requested`. The link routes to `/docs/:slug` where
 * the reviewer can submit a decision via the ReviewersPanel.
 */
export function MyReviewsPage() {
  const [items, setItems] = useState<MyReviewItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void listMyReviews()
      .then((rows) => {
        if (!cancelled) setItems(rows)
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="space-y-4" data-testid="my-reviews-page">
      <header>
        <h1 className="text-xl font-semibold text-smsg-900">내 리뷰 요청</h1>
        <p className="mt-1 text-xs text-gray-600">
          내가 리뷰어로 지정된 문서 중 아직 결정하지 않은 항목입니다.
        </p>
      </header>

      {error && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {loading && <p className="text-xs text-gray-500">불러오는 중…</p>}

      {!loading && items.length === 0 && (
        <p
          className="rounded border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-500"
          data-testid="my-reviews-empty"
        >
          현재 처리할 리뷰 요청이 없습니다.
        </p>
      )}

      {!loading && items.length > 0 && (
        <ul className="space-y-2" data-testid="my-reviews-list">
          {items.map((it) => (
            <li
              key={it.slug}
              data-testid="my-review-row"
              className="rounded border border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  to={`/docs/${encodeURIComponent(it.slug)}`}
                  className="text-sm font-semibold text-smsg-700 hover:underline"
                >
                  {it.title}
                </Link>
                <Badge
                  tone={
                    it.review_status === 'changes_requested' ? 'warn' : 'neutral'
                  }
                >
                  {it.review_status === 'changes_requested'
                    ? '수정 요청 후 대기'
                    : '리뷰 대기'}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-gray-600">
                작성자: {it.author_name || it.author_email || '—'}
                {it.added_at && (
                  <span className="ml-2 text-gray-400">
                    요청일: {it.added_at.slice(0, 10)}
                  </span>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
