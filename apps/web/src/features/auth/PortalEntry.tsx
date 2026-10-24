// 포털로 들어가기 — SSO 전용이면 로그인 · 가입 화면의 단추 하나, 보호 경로의 저절로 다녀오기, 착지 뒤 되돌리기
import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui'
import { goToPortalEntry, recentlyTried, takeReturnPath } from './portalEntry'
import { useAuthStore } from './store'

/** 로그인 · 가입 화면의 판 — 사람이 누르면 1분 막기와 상관없이 다녀온다. */
export function PortalEntryPanel({ returnTo }: { returnTo: string }) {
  const launchUrl = useAuthStore((s) => s.launchUrl)
  return (
    <div className="space-y-3" data-testid="portal-entry">
      <p className="text-sm text-gray-700 dark:text-gray-200">
        MX 백서는 HWAX 포털로 들어옵니다 — 따로 가입하지 않습니다. 포털에 로그인한 그대로, 포털의 소속과 함께 들어옵니다.
      </p>
      {recentlyTried() && (
        <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          방금 포털로 다녀왔는데 이어지지 않았습니다. 다시 눌러 보고, 계속되면 관리자에게 알려 주세요.
        </p>
      )}
      {launchUrl ? (
        <Button type="button" fullWidth size="md" data-testid="portal-entry-button" onClick={() => goToPortalEntry(returnTo, { force: true })}>
          포털로 들어가기
        </Button>
      ) : (
        <p role="alert" className="text-xs text-red-700 dark:text-red-300">
          포털 진입 링크가 설정되지 않았습니다 — 관리자에게 알려 주세요.
        </p>
      )}
    </div>
  )
}

/** 보호 경로에서 세션이 없을 때 — 진입 링크로 저절로 다녀온다. 1분 안에 다시 왔으면 로그인 화면(단추)으로. */
export function PortalReentry({ here }: { here: string }) {
  const navigate = useNavigate()
  useEffect(() => {
    if (!goToPortalEntry(here)) navigate(`/login?return=${encodeURIComponent(here)}`, { replace: true })
  }, [here, navigate])
  return <div className="px-6 py-3 text-sm text-gray-500">포털로 들어가는 중…</div>
}

/** 포털이 착지시킨 뒤 사용자가 생기면 남겨 둔 자리로 되돌린다(한 번). */
export function ReturnAfterPortalEntry() {
  const user = useAuthStore((s) => s.user)
  const navigate = useNavigate()
  const { pathname, search } = useLocation()
  useEffect(() => {
    if (!user) return
    const to = takeReturnPath()
    if (to && to !== pathname + search) navigate(to, { replace: true })
  }, [user, navigate, pathname, search])
  return null
}
