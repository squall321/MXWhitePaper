import { Link, useLocation } from 'react-router-dom'

/**
 * 404 — 일반 라우트 미스매치. 위키 링크의 미작성 페이지는 별도(빨강 링크)
 * 처리 흐름이며 여기와 무관.
 */
export function NotFoundPage() {
  const location = useLocation()
  return (
    <div className="mx-auto max-w-prose px-6 py-20 text-center">
      <p className="text-6xl font-bold text-smsg-700">404</p>
      <h1 className="mt-3 text-2xl font-semibold text-smsg-900">
        페이지를 찾을 수 없습니다
      </h1>
      <p className="mt-2 text-sm text-gray-500">
        주소 <code className="rounded bg-gray-100 px-1">{location.pathname}</code> 에 해당하는 페이지가 없습니다.
      </p>
      <div className="mt-6 flex justify-center gap-2">
        <Link
          to="/"
          className="rounded bg-smsg-700 px-4 py-1.5 text-sm font-semibold text-white hover:bg-smsg-900"
        >
          홈으로
        </Link>
        <Link
          to="/orgs"
          className="rounded border border-gray-300 bg-white px-4 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
        >
          조직 트리
        </Link>
      </div>
    </div>
  )
}
