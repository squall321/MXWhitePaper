/**
 * SeriesNav — inline series banner + prev/next navigation.
 *
 * Mounted twice in `<WikiArticle>` (top + bottom). Calls
 * `GET /documents/:slug/series` to find which series this doc belongs to and,
 * for each series, surfaces:
 *   1. A small banner: "📚 {series.title} — {position}/{total}편".
 *   2. A prev/next strip with the neighbouring document titles.
 *
 * If the doc is in 0 series the component renders nothing (no chrome) so
 * pages without a series stay clean.
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Slug } from '@/types/document'
import {
  listDocumentSeries,
  type DocumentSeriesEntry,
} from './api'

export interface SeriesNavProps {
  /** Slug of the document being read. */
  slug: Slug
  /** "top" renders banner + nav; "bottom" renders only the nav strip. */
  placement?: 'top' | 'bottom'
}

export function SeriesNav({ slug, placement = 'top' }: SeriesNavProps) {
  const [entries, setEntries] = useState<DocumentSeriesEntry[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    void listDocumentSeries(slug)
      .then((rows) => {
        if (!cancelled) setEntries(rows)
      })
      .catch(() => {
        if (!cancelled) setEntries([])
      })
      .finally(() => {
        if (!cancelled) setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [slug])

  if (!loaded || entries.length === 0) return null

  return (
    <div
      data-testid={`series-nav-${placement}`}
      className="space-y-2"
    >
      {entries.map((entry) => (
        <article
          key={entry.id}
          data-testid={`series-nav-entry-${entry.slug}`}
          className="rounded-md border border-smsg-100 bg-smsg-50/50 p-3 text-sm dark:border-smsg-900/40 dark:bg-smsg-900/20"
        >
          {placement === 'top' && (
            <header className="mb-1 flex items-center justify-between gap-2">
              <Link
                to={`/series/${encodeURIComponent(entry.slug)}`}
                className="font-medium text-smsg-900 hover:underline dark:text-smsg-100"
                data-testid={`series-nav-title-${entry.slug}`}
              >
                <span aria-hidden="true">📚 </span>
                {entry.title}
              </Link>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {entry.position + 1}/{entry.total}편
              </span>
            </header>
          )}
          <nav className="flex items-center justify-between gap-2 text-xs">
            {entry.prev ? (
              <Link
                to={`/docs/${encodeURIComponent(entry.prev.slug)}`}
                data-testid={`series-nav-prev-${entry.slug}`}
                className="truncate text-smsg-700 hover:underline dark:text-smsg-200"
              >
                ← 이전: {entry.prev.title}
              </Link>
            ) : (
              <span className="text-gray-400" aria-hidden="true">
                ← (시작)
              </span>
            )}
            {entry.next ? (
              <Link
                to={`/docs/${encodeURIComponent(entry.next.slug)}`}
                data-testid={`series-nav-next-${entry.slug}`}
                className="truncate text-smsg-700 hover:underline dark:text-smsg-200"
              >
                다음: {entry.next.title} →
              </Link>
            ) : (
              <span className="text-gray-400" aria-hidden="true">
                (끝) →
              </span>
            )}
          </nav>
        </article>
      ))}
    </div>
  )
}
