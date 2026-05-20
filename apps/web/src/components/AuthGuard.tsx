import { type ReactNode } from 'react'
import { Navigate, useLocation, useSearchParams } from 'react-router-dom'
import { useAuthStore } from '@/features/auth/store'

interface AuthGuardProps {
  children: ReactNode
}

/**
 * Route gate. While the auth store is `hydrating` we render a thin loading
 * line so a fast refresh round-trip doesn't blink the login page. After
 * hydration: if no user, redirect to `/login?return=<path>`. In dev, an
 * `?dev` query parameter bypasses the gate (the existing X-MXWP-User
 * mock chain still works).
 *
 * Note: components rendered under `?dev` may not have a populated user
 * (the bypass skips the cookie probe). Each consumer must null-check
 * `useAuthStore((s) => s.user)` instead of dereferencing optimistically.
 */
export function AuthGuard({ children }: AuthGuardProps) {
  const user = useAuthStore((s) => s.user)
  const hydrating = useAuthStore((s) => s.hydrating)
  const location = useLocation()
  const [params] = useSearchParams()

  const devBypass = import.meta.env.DEV && params.has('dev')
  if (devBypass) return <>{children}</>

  // 1차 hydration (앱 시작 직후) — user 없으면 짧은 "세션 확인 중" 표시.
  // 2차 hydration (silent refresh 중) — *이미 user 가 있으면* children 그대로 보여줘서
  // 화면이 깜박이지 않게. user 가 새로 들어오는 케이스 (재로그인 직후) 만 텍스트.
  if (hydrating && !user) {
    return (
      <div className="px-6 py-3 text-sm text-gray-500">세션 확인 중…</div>
    )
  }

  if (!user) {
    const here = location.pathname + location.search
    return <Navigate to={`/login?return=${encodeURIComponent(here)}`} replace />
  }

  return <>{children}</>
}
