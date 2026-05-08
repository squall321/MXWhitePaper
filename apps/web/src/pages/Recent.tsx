import { useEffect } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { Button, Card, EmptyState } from '@/components/ui'
import { useRecentStore } from '@/features/recent/store'
import { formatRelative } from '@/features/recent/components/RecentRail'
import type { AppOutletContext } from '@/App'

/**
 * Full "최근 본 문서" page. Lists every persisted entry (cap 20). Each row
 * has its own "지우기" button; the header has a "전체 지우기" action.
 *
 * Sidebars are cleared so the list takes the full content width.
 */
export function RecentPage() {
  const items = useRecentStore((s) => s.items)
  const remove = useRecentStore((s) => s.remove)
  const clear = useRecentStore((s) => s.clear)
  const { setLeftRail, setRightRail } = useOutletContext<AppOutletContext>()

  useEffect(() => {
    setLeftRail(null)
    setRightRail(null)
    return () => {
      setLeftRail(undefined)
      setRightRail(null)
    }
  }, [setLeftRail, setRightRail])

  return (
    <section className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-smsg-900 sm:text-3xl">
            최근 본 문서
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            최근 열어본 백서 최대 20개를 기록합니다. 기록은 이 브라우저에만 저장돼요.
          </p>
        </div>
        {items.length > 0 && (
          <Button variant="ghost" onClick={() => clear()}>
            전체 지우기
          </Button>
        )}
      </header>

      {items.length === 0 ? (
        <EmptyState
          title="아직 본 문서가 없어요"
          description="메인에서 카드를 클릭해 보세요."
          action={
            <Link to="/" className="inline-block">
              <Button>홈으로</Button>
            </Link>
          }
        />
      ) : (
        <Card padded={false}>
          <ul className="divide-y divide-gray-100">
            {items.map((doc) => (
              <li
                key={doc.slug}
                className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-smsg-50"
              >
                <div className="min-w-0 flex-1">
                  <Link
                    to={`/docs/${encodeURIComponent(doc.slug)}`}
                    className="block hover:no-underline"
                  >
                    <p className="line-clamp-2 text-sm font-medium text-smsg-900">{doc.title}</p>
                    <p className="mt-0.5 truncate font-mono text-[11px] text-gray-500">{doc.slug}</p>
                  </Link>
                </div>
                <time
                  dateTime={new Date(doc.viewedAt).toISOString()}
                  className="shrink-0 pt-0.5 text-[11px] text-gray-500"
                >
                  {formatRelative(doc.viewedAt)}
                </time>
                <button
                  type="button"
                  onClick={() => remove(doc.slug)}
                  aria-label={`${doc.title} 기록 삭제`}
                  className="shrink-0 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-red-600"
                  title="지우기"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M3.7 3.7l8.6 8.6M12.3 3.7l-8.6 8.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </section>
  )
}
