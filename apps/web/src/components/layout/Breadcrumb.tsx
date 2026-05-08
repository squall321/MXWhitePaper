import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useDocument } from '@/features/document/hooks/useDocument'

interface Crumb {
  label: string
  to?: string
}

/**
 * Sticky breadcrumb trail rendered directly under the TopBar.
 *
 *   - Home  (/)                : "홈"
 *   - Recent (/recent)         : "홈 / 최근 본 문서"
 *   - Orgs (/orgs)             : "홈 / 조직"
 *   - Admin Orgs (/admin/orgs) : "홈 / 관리 / 조직 관리"
 *   - Doc page (/docs/:slug)   : 사업부 / 팀 / 그룹 / 파트 / <문서 제목>
 *   - New doc                  : "홈 / 새 문서"
 *   - Otherwise                : returns null (no trail).
 *
 * On narrow screens the entire trail collapses to a "‹ 뒤로" button so the
 * TopBar stays usable on phones.
 */
export function Breadcrumb() {
  const location = useLocation()
  const navigate = useNavigate()
  const path = location.pathname

  // Document pages need the metadata to fill in division/team/etc.
  // Read the slug straight from the pathname so the breadcrumb works even
  // when rendered above the matching `<Route>` (it lives in the AppShell).
  const docMatch = path.match(/^\/docs\/([^/]+)$/)
  const isDocPage = docMatch !== null && docMatch[1] !== 'new'
  const slug = isDocPage ? decodeURIComponent(docMatch![1]!) : undefined
  const docQuery = useDocument(slug)
  const md = docQuery.data?.document?.metadata

  let crumbs: Crumb[] | null = null
  if (path === '/') {
    crumbs = [{ label: '홈' }]
  } else if (path === '/recent') {
    crumbs = [{ label: '홈', to: '/' }, { label: '최근 본 문서' }]
  } else if (path === '/orgs') {
    crumbs = [{ label: '홈', to: '/' }, { label: '조직' }]
  } else if (path === '/admin/orgs') {
    crumbs = [{ label: '홈', to: '/' }, { label: '관리', to: '/admin/orgs' }, { label: '조직 관리' }]
  } else if (path === '/settings') {
    crumbs = [{ label: '홈', to: '/' }, { label: '환경설정' }]
  } else if (path === '/docs/new') {
    crumbs = [{ label: '홈', to: '/' }, { label: '새 문서' }]
  } else if (isDocPage && slug) {
    if (!md) {
      // Still loading — render a stub so layout doesn't jump.
      crumbs = [
        { label: '홈', to: '/' },
        { label: docQuery.data?.document?.title ?? slug },
      ]
    } else {
      const segments: Crumb[] = [{ label: '홈', to: '/' }]
      if (md.division) segments.push({ label: md.division })
      if (md.team) segments.push({ label: md.team })
      if (md.group) segments.push({ label: md.group })
      if (md.part) segments.push({ label: md.part })
      segments.push({ label: docQuery.data?.document?.title ?? slug })
      crumbs = segments
    }
  }

  if (!crumbs) return null

  return (
    <nav
      data-testid="breadcrumb"
      aria-label="현재 위치"
      className="border-b border-gray-200 bg-white"
    >
      {/* Mobile: collapsed back button */}
      <div className="flex items-center px-3 py-1.5 sm:hidden">
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label="뒤로 가기"
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-smsg-700 hover:bg-smsg-50"
        >
          <span aria-hidden="true">‹</span>
          뒤로
        </button>
        <span className="ml-2 truncate text-xs text-gray-500">
          {crumbs[crumbs.length - 1]?.label}
        </span>
      </div>

      {/* Tablet+: full trail */}
      <ol className="hidden items-center gap-1 overflow-hidden whitespace-nowrap px-4 py-1.5 text-xs text-gray-500 sm:flex sm:px-6">
        {crumbs.map((c, i) => {
          const last = i === crumbs!.length - 1
          return (
            <li key={`${i}-${c.label}`} className="flex items-center gap-1 truncate">
              {i > 0 && (
                <span aria-hidden="true" className="text-gray-300">
                  /
                </span>
              )}
              {c.to && !last ? (
                <Link
                  to={c.to}
                  className="rounded px-1 text-smsg-700 hover:bg-smsg-50 hover:underline"
                >
                  {c.label}
                </Link>
              ) : (
                <span
                  className={
                    last
                      ? 'truncate font-medium text-smsg-900'
                      : 'truncate text-gray-500'
                  }
                  aria-current={last ? 'page' : undefined}
                >
                  {c.label}
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
