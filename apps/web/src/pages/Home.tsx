import { useEffect, useMemo, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { useDocumentList } from '@/features/document/hooks/useDocumentList'
import { useAuthStore } from '@/features/auth/store'
import type { DocumentCard } from '@/features/document/api'
import { Badge, Button, Card, Skeleton, EmptyState, ErrorState, cn } from '@/components/ui'
import { RecentRail } from '@/features/recent/components/RecentRail'
import { useRecentStore } from '@/features/recent/store'
import { RailBoundary } from '@/components/blocks/BlockBoundary'
import { SlowFetchBanner, useSlowFetch } from '@/lib/api/useSlowFetch'
import { toApiError } from '@/lib/api/envelope'
import type { AppOutletContext } from '@/App'

/**
 * Landing page. Hero strip + filter chips + responsive document grid:
 *   - mobile: 1 col
 *   - tablet: 2 col
 *   - desktop: 3 col
 *
 * Cards use `<DocumentCardItem>` which presents an avatar-style initial badge,
 * the team breadcrumb, title, summary and last-updated label.
 */
export function HomePage() {
  const { data, isPending, isError, error, refetch, isFetching } = useDocumentList({ limit: 12 })
  const slowFetch = useSlowFetch(isPending || isFetching)
  const user = useAuthStore((s) => s.user)
  const role = user?.role ?? ''
  const canWrite = !!user && ['editor', 'owner', 'admin'].includes(role)
  const [activeTeam, setActiveTeam] = useState<string | null>(null)
  const { setLeftRail, setRightRail } = useOutletContext<AppOutletContext>()
  const recentItemsRaw = useRecentStore((s) => s.items)
  const recentItems = Array.isArray(recentItemsRaw) ? recentItemsRaw : []
  const [recentMobileOpen, setRecentMobileOpen] = useState(false)

  // HomePage uses the default left (OrgTree) and pushes RecentRail to right.
  useEffect(() => {
    setLeftRail(undefined)
    setRightRail(
      <RailBoundary name="최근 본 문서">
        <RecentRail />
      </RailBoundary>,
    )
    return () => {
      setRightRail(null)
    }
  }, [setLeftRail, setRightRail])

  const teams = useMemo(() => {
    const set = new Set<string>()
    const list = Array.isArray(data) ? data : []
    for (const d of list) if (d?.team) set.add(d.team)
    return Array.from(set).sort()
  }, [data])

  const filtered = useMemo(() => {
    const list = Array.isArray(data) ? data : []
    if (!activeTeam) return list
    return list.filter((d) => d?.team === activeTeam)
  }, [data, activeTeam])

  return (
    <section className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-smsg-900 sm:text-3xl">
            최근 업데이트된 문서
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            가장 최근에 갱신된 백서 12건입니다.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canWrite && (
            <Link
              to="/docs/new"
              className="inline-flex h-9 items-center gap-2 rounded-md bg-smsg-700 px-3.5 text-sm font-semibold text-white transition-all duration-base hover:-translate-y-px hover:bg-smsg-900 hover:no-underline hover:shadow-md focus-visible:outline-none focus-visible:shadow-focus"
            >
              + 새 문서 작성
            </Link>
          )}
          <Link to="/orgs" className="text-sm text-link hover:underline">
            전체 보기 →
          </Link>
        </div>
      </header>

      {teams.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">필터</span>
          <FilterChip
            active={activeTeam === null}
            onClick={() => setActiveTeam(null)}
            label="전체"
          />
          {teams.map((t) => (
            <FilterChip
              key={t}
              active={activeTeam === t}
              onClick={() => setActiveTeam(t)}
              label={t}
            />
          ))}
        </div>
      )}

      {slowFetch && <SlowFetchBanner />}

      {isPending && <DocumentGridSkeleton />}

      {isError && (
        <ErrorState
          title="문서 목록을 불러오지 못했습니다"
          description={toApiError(error).message}
          onRetry={() => void refetch()}
        />
      )}

      {!isPending && !isError && filtered.length === 0 && (
        <EmptyState
          title={activeTeam ? `${activeTeam} 팀의 문서가 없습니다` : '아직 문서가 없습니다'}
          description={canWrite ? '새 문서를 작성해 처음 백서를 채워 보세요.' : undefined}
          action={
            canWrite ? (
              <Link to="/docs/new" className="inline-block">
                <Button>+ 새 문서 작성</Button>
              </Link>
            ) : undefined
          }
        />
      )}

      {!isPending && !isError && filtered.length > 0 && (
        <ul
          data-testid="home-card-grid"
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          {filtered.map((doc) => (
            <DocumentCardItem key={doc.id} doc={doc} />
          ))}
        </ul>
      )}

      {/* Mobile/tablet: RecentRail isn't visible in the desktop right column,
          so surface it inline below the cards as a collapsible section. */}
      {recentItems.length > 0 && (
        <section className="lg:hidden" aria-label="최근 본 문서 (모바일)">
          <button
            type="button"
            onClick={() => setRecentMobileOpen((v) => !v)}
            aria-expanded={recentMobileOpen}
            className="flex w-full items-center justify-between rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-smsg-900 hover:border-smsg-300"
          >
            <span>최근 본 문서 ({Math.min(recentItems.length, 10)})</span>
            <span aria-hidden="true" className="text-gray-400">{recentMobileOpen ? '▾' : '▸'}</span>
          </button>
          {recentMobileOpen && (
            <div className="mt-2 rounded-md border border-gray-200 bg-white py-2">
              <RecentRail showSeeAll />
            </div>
          )}
        </section>
      )}
    </section>
  )
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full border px-3 py-1 text-xs font-medium transition-all duration-fast',
        active
          ? 'border-smsg-700 bg-smsg-700 text-white shadow-sm'
          : 'border-gray-300 bg-white text-gray-700 hover:border-smsg-300 hover:text-smsg-900',
      )}
    >
      {label}
    </button>
  )
}

const PALETTE = ['#1428A0', '#2E5BFF', '#5C7CFF', '#0A1F8F', '#10B981', '#F59E0B'] as const

function colorForKey(key: string): string {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]!
}

function DocumentCardItem({ doc }: { doc: DocumentCard }) {
  const initial = (doc.title || doc.slug || '?').slice(0, 1).toUpperCase()
  const path = [doc.division, doc.team, doc.group, doc.part].filter(Boolean).join(' / ')
  return (
    <li>
      <Link
        to={`/docs/${encodeURIComponent(doc.slug)}`}
        className="block h-full hover:no-underline"
      >
        <Card hover padded="md" className="flex h-full flex-col gap-3">
          <div className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-md text-base font-bold text-white shadow-sm"
              style={{ backgroundColor: colorForKey(doc.team || doc.slug) }}
            >
              {initial}
            </span>
            <div className="min-w-0 flex-1">
              {doc.team && <Badge tone="muted" size="sm">{doc.team}</Badge>}
              <h2 className="mt-1 line-clamp-2 text-base font-semibold text-smsg-900 group-hover:text-smsg-700">
                {doc.title}
              </h2>
            </div>
          </div>

          {doc.summary && (
            <p className="line-clamp-3 text-sm text-gray-600">{doc.summary}</p>
          )}

          <div className="mt-auto flex items-center justify-between text-xs text-gray-500">
            <span className="truncate">{path || doc.slug}</span>
            {doc.updated_at && (
              <time className="ml-2 shrink-0">{formatDate(doc.updated_at)}</time>
            )}
          </div>
        </Card>
      </Link>
    </li>
  )
}

function DocumentGridSkeleton() {
  return (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <li key={i}>
          <Card padded="md" className="flex h-full flex-col gap-3">
            <div className="flex items-start gap-3">
              <Skeleton className="h-10 w-10" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3 w-1/3" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            </div>
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-5/6" />
            <Skeleton className="h-3 w-1/2" />
          </Card>
        </li>
      ))}
    </ul>
  )
}

function formatDate(s: string): string {
  try {
    const d = new Date(s)
    if (Number.isNaN(d.getTime())) return ''
    const now = Date.now()
    const diff = now - d.getTime()
    const day = 24 * 3600 * 1000
    if (diff < day) return '오늘'
    if (diff < 2 * day) return '어제'
    if (diff < 7 * day) return `${Math.floor(diff / day)}일 전`
    return d.toLocaleDateString('ko-KR', { year: '2-digit', month: '2-digit', day: '2-digit' })
  } catch {
    return ''
  }
}
